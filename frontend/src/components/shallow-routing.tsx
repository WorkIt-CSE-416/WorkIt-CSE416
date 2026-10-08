"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  addTransitionType,
  createContext,
  startTransition,
  use,
  useEffect,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";

/**
 * Shallow routing: changing a page's query in place, for a choice whose
 * content the browser already holds (a Dashboard range, an Applications
 * layout, a Calendar view or span), without asking the server for the page.
 *
 * WHY NOT A NAVIGATION. A <Link> asks the server for the page again, and the
 * new content waits on that round trip (about 150ms locally, more once the
 * proxy has a session to check) while a segmented control's thumb has
 * already moved, so the content reads as late. A shallow move draws the new
 * content in the next frame and never fetches, which is only right because
 * nothing the server renders depends on these choices.
 *
 * WHY THE QUERY IS HELD HERE, not read from useSearchParams. Next's router
 * hears a native pushState, but it applies the new URL in a microtask after
 * the caller's transition has ended (its reducer is async), so the redraw is
 * an ordinary update and no <ViewTransition> runs: the Calendar would not
 * slide and a new layout would not crossfade. So the query the page shows
 * lives in this provider's state, a move sets it inside a transition (tagged
 * with `type` the way <Link transitionTypes> tags one), and once that has
 * drawn, the address bar follows with a pushState. Anything else that moves
 * the address bar (back, forward, a real link) is adopted as it comes.
 *
 * The URL stays the state that matters: a reload, a shared link and the back
 * button all land where they did. One provider wraps the seeker pages
 * ((seeker)/layout.tsx); read the query with useShallowParams and move it with
 * <ShallowLink> or useShallowPush.
 */
type Shallow = {
  /** The query the page is showing. After a shallow move it is a frame
   *  ahead of the address bar. */
  search: string;
  push: (href: string, type?: string) => void;
};

const ShallowContext = createContext<Shallow | null>(null);

export function ShallowRouting({ children }: { children: ReactNode }) {
  const path = usePathname();
  const search = useSearchParams().toString();
  const [state, setState] = useState({ shown: search, seen: search, path });

  // The address bar moved. To what the page already shows: a shallow move
  // catching up. Anywhere else: show it now.
  if (search !== state.seen || path !== state.path) {
    setState({
      shown: path === state.path && search === state.shown ? state.shown : search,
      seen: search,
      path,
    });
  }

  // A shallow move has drawn; the address bar follows.
  useEffect(() => {
    if (state.shown === state.seen) return;
    window.history.pushState(null, "", state.shown ? `${state.path}?${state.shown}` : state.path);
  }, [state]);

  const push = (href: string, type?: string) => {
    const shown = new URL(href, window.location.href).searchParams.toString();
    startTransition(() => {
      if (type) addTransitionType(type);
      setState((current) => ({ ...current, shown }));
    });
  };

  return <ShallowContext value={{ search: state.shown, push }}>{children}</ShallowContext>;
}

/** The query the page is showing: a shallow move's, the moment it is made.
 *  Outside <ShallowRouting>, the address bar's. */
export function useShallowParams() {
  const shallow = use(ShallowContext);
  const url = useSearchParams();
  return shallow ? new URLSearchParams(shallow.search) : url;
}

/** Moves the query in place, within this page (`href` keeps its path). */
export function useShallowPush() {
  return use(ShallowContext)?.push ?? pushWithoutProvider;
}

function pushWithoutProvider(href: string) {
  window.history.pushState(null, "", href);
}

/** A plain left click; a modified one opens a tab and leaves this page. */
export function isPlainClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * A link that moves the query in place on a plain click and is an ordinary
 * link otherwise, so a new tab or a copied address still works. Never
 * prefetched: its click never fetches.
 */
export function ShallowLink({
  href,
  transitionType,
  onClick,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
  /** Tags the transition, as <Link transitionTypes> does: "nav-back". */
  transitionType?: string;
}) {
  const push = useShallowPush();

  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !isPlainClick(event)) return;
        event.preventDefault();
        push(href, transitionType);
      }}
    />
  );
}
