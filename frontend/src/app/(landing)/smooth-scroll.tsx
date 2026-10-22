"use client";

import * as React from "react";
import Lenis from "lenis";
import { usePathname } from "next/navigation";
import { cancelFrame, frame, useReducedMotion } from "motion/react";

/**
 * Smooth scrolling for the marketing pages, with Lenis on the window: a
 * wheel or trackpad glides to rest instead of stepping, so the pinned,
 * scroll-driven scenes play as one motion. It ticks on motion's own frame
 * loop rather than its own `requestAnimationFrame`, in the first step
 * (`setup`), before motion reads the scroll: ticked in `update`, as Lenis's
 * docs show, every scroll-linked value read the page one step behind, and
 * the flying cards and pills trailed their ends. Touch scrolling stays
 * native (Lenis's default), and with reduced motion it does not run at
 * all. Its styles are in landing.css, not lenis.css, whose
 * `html.lenis { height: auto }` undid `h-full` on <html>.
 *
 * Its anchors honour `scroll-padding-top`, so an in-page link still clears
 * the floating header. A scroll area inside the page needs
 * `data-lenis-prevent`, or the wheel scrolls the page behind it.
 *
 * It also keeps the page's place across navigations (below): a new page
 * opens at its top, and Back or Forward returns to where the reader was.
 */

let lenis: Lenis | null = null;

export function SmoothScroll() {
  const reduceMotion = useReducedMotion();
  const pathname = usePathname();

  React.useEffect(() => {
    if (reduceMotion) return;
    const instance = new Lenis({
      autoRaf: false,
      anchors: true,
      // A click on a link stops the glide, so a new page starts still.
      stopInertiaOnNavigate: true,
    });
    lenis = instance;
    const tick = ({ timestamp }: { timestamp: number }) => instance.raf(timestamp);
    frame.setup(tick, true);
    return () => {
      cancelFrame(tick);
      instance.destroy();
      lenis = null;
    };
  }, [reduceMotion]);

  // The browser's own restoration is off while these pages show; the
  // positions are kept here instead.
  React.useEffect(() => {
    const before = history.scrollRestoration;
    history.scrollRestoration = "manual";
    const save = () => {
      if (!holding) remember();
    };
    // Also saved as a click lands and as the page is left: a scroll's own
    // event waits for the next frame, so a link clicked right after a
    // scroll could leave before its place was kept.
    const leave = () => {
      save();
      persist();
    };
    window.addEventListener("scroll", save, { passive: true });
    document.addEventListener("click", save, { capture: true });
    window.addEventListener("pagehide", leave);
    return () => {
      history.scrollRestoration = before;
      window.removeEventListener("scroll", save);
      document.removeEventListener("click", save, { capture: true });
      window.removeEventListener("pagehide", leave);
      release();
      persist();
    };
  }, []);

  React.useEffect(() => {
    shownPath = pathname;
    const key = entryKey();
    const first = !loaded;
    loaded = true;
    if (first) {
      const how = (
        performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
      )?.type;
      const saved = positions.get(key);
      // Back or Forward from another site loads this document again: back
      // to the reader's place. A reload starts at the top (or at its
      // #section, below), where the hero's intro and the pinned scenes
      // start; it restored the reader's place at first, which the team
      // found wrong for these pages.
      if (saved !== undefined && how === "back_forward") returning = { key, top: saved };
      else if (how === "reload" && !location.hash) jump(0);
    }
    if (returning?.key === key) {
      const { top } = returning;
      // Cleared only once held: an effect run again (React's strict mode)
      // starts the hold again.
      hold(
        () => top,
        () => (returning = null),
      );
    } else if (location.hash) hold(hashTop);
    // A first load is already at the top, and a reader may have scrolled.
    else if (!first) jump(0);
    return () => {
      shownPath = null;
    };
  }, [pathname]);

  return null;
}

/**
 * Scrolls the window to `top`, through Lenis while it runs, so a script's
 * scroll and the wheel's never fight; a native smooth scroll otherwise.
 * `instant` jumps (reduced motion, and a new page's top).
 */
export function scrollPageTo(top: number, { instant = false } = {}) {
  if (lenis) {
    // The page may have changed height since Lenis last measured it (it
    // waits 250 ms after a change), and it clamps a scroll to that height.
    lenis.resize();
    lenis.scrollTo(top, { immediate: instant, force: true });
  } else window.scrollTo({ top, behavior: instant ? "instant" : "smooth" });
}

/*
 * The page's place across navigations. A link to another page opens it at
 * its top; a link with a #section lands on that section; Back and Forward
 * return to where the reader was on that history entry, kept for the tab's
 * life (sessionStorage), so a return from another site does too; a reload
 * starts at the top. Next only moved a new page
 * when its start was off screen, so a short page opened from the footer
 * stayed at the bottom, and the browser's own restoration ran before the
 * home page had grown (its pinned scenes take their full height only once
 * the window's width is known), so Back stopped short of the reader's
 * place. Each return is held while the page grows (`hold`).
 */

/** Its own key: the seeker shell's scroll memory ((seeker)/scroll-memory.tsx)
 * keeps its places under "workit:scroll" in another shape, and one shared key
 * left each side reading the other's data, which broke the Jobs feed's
 * return to its place after a visit here. */
const STORE = "workit:landing-scroll";
/** Where the page was on each history entry. */
const positions = new Map<string, number>();
/** A Back or Forward on its way to an entry, and where that entry was. */
let returning: { key: string; top: number } | null = null;
/** The path these pages show, or null while none is mounted. */
let shownPath: string | null = null;
/** Whether this document has shown one of these pages yet. */
let loaded = false;
/** A position being held while the page grows. */
let holding: { frame: number; stop: AbortController } | null = null;

if (typeof window !== "undefined") {
  try {
    for (const [key, top] of JSON.parse(sessionStorage.getItem(STORE) ?? "[]")) {
      positions.set(key, top);
    }
  } catch {
    // Storage blocked or unreadable: positions last as long as the page.
  }
  // Read where the entry was before anything scrolls: the new page renders
  // after this, and its first scroll would overwrite the entry's place.
  window.addEventListener("popstate", () => {
    release();
    const key = entryKey();
    const top = positions.get(key) ?? 0;
    // Back to another place on the page already shown (a #section entry):
    // nothing new renders, so return now. Otherwise the new page's mount
    // returns there.
    if (shownPath === location.pathname) hold(() => top);
    else returning = { key, top };
  });
}

/** The current history entry. The Navigation API names each one, so two
 * visits to one page keep two places; without it, the URL stands in. */
function entryKey() {
  const { navigation } = window as Window & {
    navigation?: { currentEntry?: { key: string } | null };
  };
  return navigation?.currentEntry?.key ?? `${location.pathname}${location.search}`;
}

function remember() {
  positions.set(entryKey(), window.scrollY);
}

function persist() {
  try {
    sessionStorage.setItem(STORE, JSON.stringify([...positions].slice(-100)));
  } catch {
    // Storage blocked or full: positions last as long as the page.
  }
}

function jump(top: number) {
  scrollPageTo(top, { instant: true });
}

/** Where the URL's #section starts, under the floating header. */
function hashTop() {
  const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (!target) return window.scrollY;
  const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  return target.getBoundingClientRect().top + window.scrollY - padding;
}

/**
 * Holds the page at `target()` each frame until the page can reach it and
 * has stopped changing height (a second and a half at most), so a place
 * further down than the page first reaches is not cut short: held only
 * until the height stood still for a few frames, a return to the foot of
 * the home page stopped 280px short. The reader's own scroll, tap or key
 * ends it early. `done` runs once it ends either way, not when a new hold or a
 * navigation cuts it off.
 */
function hold(target: () => number, done?: () => void) {
  release();
  const stop = new AbortController();
  const state = { frame: 0, stop };
  holding = state;
  const finish = () => {
    release();
    remember();
    done?.();
  };
  const start = performance.now();
  let height = -1;
  let steady = 0;
  const step = () => {
    const page = document.documentElement;
    const next = page.scrollHeight;
    const top = target();
    jump(top);
    steady = next === height ? steady + 1 : 0;
    height = next;
    const reached = top <= next - page.clientHeight;
    if ((reached && steady >= 3) || performance.now() - start > 1500) finish();
    else state.frame = requestAnimationFrame(step);
  };
  for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
    window.addEventListener(type, finish, { passive: true, signal: stop.signal });
  }
  step();
}

function release() {
  if (!holding) return;
  cancelAnimationFrame(holding.frame);
  holding.stop.abort();
  holding = null;
}
