import { cn } from "@/lib/cn";

/**
 * Top Matches' scrolling frame, shared by its rows (./top-matches-list.tsx)
 * and its skeleton (./top-matches.tsx). A plain module, since a server
 * component cannot read a value out of a "use client" file.
 *
 * THE LIST SCROLLS INSIDE ITS TILE from @4xl/main, at a fixed height
 * (`h-80`, about four and a half rows, so the cut row says there is more),
 * with a quiet bar along the tile's edge (-mr-5, pr-5) and a fade at its
 * foot. Below @4xl/main it does not scroll: it shows the first five rows and
 * the page scrolls past them, since a box that scrolls inside a scrolling
 * page traps the swipe that reaches its end. This is New Matches' frame,
 * the newest postings in posting order, which Top Matches replaced.
 */
export const LIST = cn(
  "mt-4 flex flex-col gap-2",
  "@4xl/main:-mr-5 @4xl/main:h-80 @4xl/main:overflow-y-auto @4xl/main:overscroll-contain @4xl/main:pr-5 @4xl/main:pb-6",
  "@max-4xl/main:[&>li:nth-child(n+6)]:hidden",
);
