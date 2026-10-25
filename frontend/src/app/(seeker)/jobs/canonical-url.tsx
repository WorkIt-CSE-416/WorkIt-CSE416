"use client";

import { useEffect, useEffectEvent } from "react";

import { useShallowPush } from "@/components/shallow-routing";

/**
 * Writes the address a fresh visit stands for into the address bar, in place
 * of bare /jobs: `href` is Best Match with the seeker's saved preferences, the
 * view the page has just drawn (see "SAVED PREFERENCES APPLY ON A FRESH
 * VISIT ONLY" in ./page). Draws nothing.
 *
 * WHY NOT redirect(). The page used to redirect there, which cost a second
 * server round trip on the sidebar's most used link: the first answer
 * carried only the redirect, so the old page faded out to an empty panel,
 * and the router then asked for the new address and drew the page with no
 * page-enter at all. Now the first answer is the page itself, which rises
 * in like any other section's, and only the address moves.
 *
 * The address moves when the page-enter has ended, not at once: the move is
 * a transition, and React holds a transition's commit while a view
 * transition runs (about 0.4s here). Nothing reads the bare address in that
 * time but RememberFeed, which writes again when it changes, and the filter
 * row, which already treats a bare /jobs as Best Match (./filters).
 *
 * WHY useShallowPush, not history.replaceState. <ShallowRouting> holds the
 * query the seeker pages show, and catches up with a bare history call only
 * a microtask after Next's router hears it (frontend/docs/motion.md); a
 * shallow move sets that query and then replaces the address itself. With
 * `replace` the bare /jobs entry is swapped, not added to, so Back skips it
 * as it skipped the redirect, and nothing is fetched: the content already
 * is what this address draws.
 *
 * The address must be exactly the one redirect() produced. RememberFeed,
 * the scroll memory and Load More's kept pages (./feed-pages) all key on
 * it, and the page draws the list under that same query, so a reload, a
 * Back from a job or a Clear All lands where it always did.
 */
export function CanonicalUrl({ href }: { href: string }) {
  const push = useShallowPush();
  // An effect event, so the move runs once for each address and not again
  // on every render of <ShallowRouting>, whose `push` is new each time.
  const settle = useEffectEvent(() => push(href, undefined, { replace: true }));
  useEffect(() => {
    settle();
  }, [href]);
  return null;
}
