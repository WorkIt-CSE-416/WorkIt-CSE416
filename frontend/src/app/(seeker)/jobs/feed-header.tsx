import type { ReactNode } from "react";

/**
 * The top of a feed page (/jobs, /search): its heading and the filter row,
 * held at the top of the page while the cards scroll under it, so the
 * filters are in reach from anywhere in a long list. It sticks to the shell's
 * <main>, the one thing that scrolls (../layout.tsx).
 *
 * It takes over the page's own top padding (-mt-6 pt-6), so the heading sits
 * as far from the panel's edge stuck as it does at rest, and the feed's
 * 16px gap below the filters (pb-4 -mb-4: the feed's own mt-4 lands on it),
 * so the cards slide under white rather than up against the filters. Its
 * white is the panel's, so the cards vanish under it rather than through it. Above
 * the cards' own layers (a card's link and actions are z-2), below every
 * popup, which is portaled.
 */
export function FeedHeader({ children }: { children: ReactNode }) {
  return <div className="bg-panel sticky top-0 z-10 -mt-6 -mb-4 pt-6 pb-4">{children}</div>;
}
