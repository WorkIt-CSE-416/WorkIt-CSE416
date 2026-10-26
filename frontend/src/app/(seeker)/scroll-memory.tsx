"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";

import { forgetFeedPages } from "./jobs/feed-pages";

/**
 * Puts a seeker page back where it was scrolled when the seeker comes back to
 * it: by the browser's Back or Forward, or by a link that means "back"
 * (restoreScrollOn, which a job page's "Back" calls). A browser does this by
 * itself for a page that scrolls the window, but the seeker shell scrolls its
 * page panel instead (the <main>, ./layout.tsx), so without this every return
 * landed at the top: a seeker forty roles down the feed who opened one and
 * came back started over (asked for 2026-10-10). A page reached any other way,
 * a sidebar link or a fresh link, starts at the top, as a browser's would.
 *
 * Positions are kept per address (path and query, so /jobs under one set of
 * filters is its own place) for the tab's session, the last KEEP of them.
 * Restoring waits for the page to be tall enough, since a page's content
 * streams in behind its placeholders after it arrives, and gives up after
 * SETTLE_MS or as soon as the seeker scrolls, clicks or types themselves.
 * The feed's own Load More pages come back with it on a return
 * (jobs/feed-pages.ts), so the place it returns to exists; on any other
 * arrival they are dropped here, so the list starts at its first page.
 *
 * Rendered once, in the seeker layout; draws nothing. sessionStorage can be
 * off (a private window): then nothing is remembered and nothing breaks.
 */

const POSITIONS = "workit:scroll";
const RESTORE = "workit:restore-scroll";
const OPENERS = "workit:opened-from";
const KEEP = 50;
const SETTLE_MS = 3000;

const here = () => window.location.pathname + window.location.search;

function positions(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(POSITIONS) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function remember(key: string, top: number) {
  try {
    const all = positions();
    // Re-added at the end, so the oldest addresses are the ones let go.
    delete all[key];
    all[key] = Math.round(top);
    const keys = Object.keys(all);
    for (const old of keys.slice(0, Math.max(0, keys.length - KEEP))) delete all[old];
    sessionStorage.setItem(POSITIONS, JSON.stringify(all));
  } catch {
    /* storage off: nothing remembered */
  }
}

/** Has the next arrival at `href` scroll back to where it was: for a link
 *  that goes back by navigating forward (a job page's "Back"), which the browser
 *  doesn't count as Back. */
export function restoreScrollOn(href: string) {
  try {
    sessionStorage.setItem(RESTORE, href);
  } catch {
    /* storage off: the page opens at the top */
  }
}

/** This page's address and the one before it, as RememberFeed writes an
 *  address (path, then the query if there is one), for cameFrom. Module
 *  variables, not storage: a reload starts the record over, and so does the
 *  router's cache that cameFrom stands for. */
let current: string | null = null;
let previous: string | null = null;

/** The seeker page this one was reached from in this tab, or null on the
 *  first page drawn. A job page's "Back" goes back in history when this is
 *  the list it would link to (BackToJobs). */
export function cameFrom(): string | null {
  return previous;
}

/** Each page's path and the address it was last opened from, for the tab's
 *  session, so a reload keeps it. A return (the browser's Back or Forward,
 *  or a "back" link) records nothing: an application opened from the
 *  Calendar, then a job page and Back, was opened from the Calendar still. */
function openers(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(OPENERS) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

/** Kept as positions are: the last KEEP pages, the oldest let go. */
function rememberOpener(pathname: string, from: string) {
  try {
    const all = openers();
    delete all[pathname];
    all[pathname] = from;
    const keys = Object.keys(all);
    for (const old of keys.slice(0, Math.max(0, keys.length - KEEP))) delete all[old];
    sessionStorage.setItem(OPENERS, JSON.stringify(all));
  } catch {
    /* storage off: a Back link goes to its page's parent */
  }
}

const pathOf = (address: string) => address.split("?")[0];

const listeners = new Set<() => void>();

/** For useSyncExternalStore: a new opener recorded. */
export function subscribeOpener(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The address the page at `pathname` was opened from in this tab, or null
 * when nothing opened it (a direct visit): what a Back link goes to
 * (../back-link.tsx). While that page draws for the first time, ScrollMemory
 * has not moved on yet, so the page still on record is its opener; after,
 * the record says so. The two agree, so a Back link never flashes another
 * page's name.
 */
export function openerOf(pathname: string): string | null {
  if (current && pathOf(current) !== pathname) return current;
  return openers()[pathname] ?? null;
}

export function ScrollMemory() {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  // Set by the browser's Back or Forward, read by the next arrival.
  const popped = useRef<string | null>(null);
  // While a restore is under way its own scrolling isn't the seeker's.
  const restoring = useRef(false);

  useEffect(() => {
    const main = document.getElementById("content");
    if (!main) return;
    // Every scroll is kept, at most every 100ms plus the last one, under the
    // address it happened at: a navigation can change the address before a
    // late save would run.
    let last = 0;
    let trailing: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (restoring.current) return;
      const key = here();
      clearTimeout(trailing);
      if (Date.now() - last > 100) {
        last = Date.now();
        remember(key, main.scrollTop);
      } else {
        trailing = setTimeout(() => remember(key, main.scrollTop), 100);
      }
    };
    const onPop = () => {
      // The address it went to, not just that it happened: a fragment link
      // ("Skip to Content") fires popstate too, with no route change after
      // it, and must not make the next unrelated arrival a return.
      popped.current = here();
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("popstate", onPop);
    return () => {
      clearTimeout(trailing);
      main.removeEventListener("scroll", onScroll);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  // A layout effect: a fresh arrival drops the feed's kept pages before the
  // page is drawn, so they never flash.
  useLayoutEffect(() => {
    // Checked against the last one, so Strict Mode's second run (development
    // only) doesn't record a page as reached from itself.
    const address = query ? `${pathname}?${query}` : pathname;
    const key = here();
    let asked = false;
    try {
      asked = sessionStorage.getItem(RESTORE) === key;
      if (asked) sessionStorage.removeItem(RESTORE);
    } catch {
      /* storage off */
    }
    const back = popped.current === key || asked;
    if (address !== current) {
      // A new page, reached forward: the one on screen before opened it. A
      // query change on the same page (a tab, a filter) opens nothing.
      if (!back && current && pathOf(current) !== pathname) rememberOpener(pathname, current);
      previous = current;
      current = address;
      for (const listener of listeners) listener();
    }
    popped.current = null;
    if (!back) forgetFeedPages(window.location.pathname);
    const wanted = back ? positions()[key] : undefined;
    const main = document.getElementById("content");
    const content = main?.firstElementChild;
    if (!wanted || !main || !content) return;

    restoring.current = true;
    const attempt = () => {
      main.scrollTop = wanted;
      if (Math.abs(main.scrollTop - wanted) < 2) stop();
    };
    // The page grows as its content streams in; try again each time it does.
    const grows = new ResizeObserver(attempt);
    const timer = setTimeout(stop, SETTLE_MS);
    function stop() {
      if (!restoring.current) return;
      restoring.current = false;
      grows.disconnect();
      clearTimeout(timer);
      for (const event of ["wheel", "touchstart", "pointerdown"] as const) {
        main?.removeEventListener(event, stop);
      }
      window.removeEventListener("keydown", stop);
      if (main) remember(key, main.scrollTop);
    }
    // The seeker taking over ends it.
    for (const event of ["wheel", "touchstart", "pointerdown"] as const) {
      main.addEventListener(event, stop, { passive: true });
    }
    window.addEventListener("keydown", stop);
    grows.observe(content);
    attempt();
    return stop;
  }, [pathname, query]);

  return null;
}
