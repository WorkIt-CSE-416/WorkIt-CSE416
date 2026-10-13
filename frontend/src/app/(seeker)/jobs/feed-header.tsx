"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/cn";

import { SEEKER_BLEED, SEEKER_GUTTER } from "../gutter";

/** How far below the panel's top edge the filter row sits once a phone has
 *  scrolled the heading away. */
const ROW_GAP = 16;

/**
 * The top of a feed page (/jobs, /search): its heading and the filter row,
 * held at the top of the page while the cards scroll under it, so the
 * filters are in reach from anywhere in a long list. It sticks to the shell's
 * <main>, the one thing that scrolls (../layout.tsx).
 *
 * BELOW md ONLY THE FILTERS STAY. On a phone the heading, subtitle and
 * filters took about 170px, near a third of what the page shows. There the
 * header sticks with a negative top as tall as everything above the filter
 * row (less ROW_GAP, the same 16px as below it), so the heading scrolls
 * away and the row stops just under the panel's edge; the height is
 * measured, since the heading wraps.
 * From md the whole header stays (top 0).
 *
 * A HAIRLINE MARKS IT ONCE THE LIST IS UNDER IT, fading in when the header
 * has stuck and the page has scrolled, and gone at rest, where the list
 * starts below it anyway. Without it the cards were cut off by a plain white
 * edge with nothing saying the header stood apart from them.
 *
 * It takes over the page's own top padding (-mt-6 pt-6), so the heading sits
 * as far from the panel's edge stuck as it does at rest, and the feed's
 * 16px gap below the filters (pb-4 -mb-4: the feed's own mt-4 lands on it),
 * so the cards slide under white rather than up against the filters. Its
 * white is the panel's, so the cards vanish under it rather than through it,
 * and it spans the page's side gutters (SEEKER_BLEED), with the content kept
 * in the column: only as wide as the cards, it let their shadow, which
 * reaches a couple of pixels past their sides, show beside it as two thin
 * vertical lines while they scrolled under.
 *
 * Above the cards' own layers (a card's link and actions are z-2), below
 * every popup, which is portaled.
 */
export function FeedHeader({ heading, children }: { heading: ReactNode; children: ReactNode }) {
  const headerRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  // Everything above the filter row, less ROW_GAP: the phone's negative top.
  const [lift, setLift] = useState(0);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const header = headerRef.current;
    const row = rowRef.current;
    const scroller = header?.closest("main");
    if (!header || !row || !scroller) return;

    // Stuck once the page has scrolled and the header sits at its sticky
    // top, which is negative on a phone, 0 from md. Measured from inside
    // the <main>'s border (clientTop), where a sticky top counts from.
    const check = () => {
      const offset =
        header.getBoundingClientRect().top -
        (scroller.getBoundingClientRect().top + scroller.clientTop);
      setStuck(scroller.scrollTop > 0 && offset <= parseFloat(getComputedStyle(header).top) + 0.5);
    };
    // Fires once on observe too, so this is also the first measure.
    const resize = new ResizeObserver(() => {
      setLift(row.offsetTop - ROW_GAP);
      check();
    });
    resize.observe(header);
    scroller.addEventListener("scroll", check, { passive: true });
    return () => {
      resize.disconnect();
      scroller.removeEventListener("scroll", check);
    };
  }, []);

  return (
    <div
      ref={headerRef}
      data-stuck={stuck || undefined}
      style={{ "--feed-lift": `${lift}px` } as CSSProperties}
      className={cn(
        "bg-panel sticky top-[calc(var(--feed-lift)*-1)] z-10 -mt-6 -mb-4 pt-6 pb-4 md:top-0",
        "after:bg-border-subtle after:absolute after:inset-x-0 after:bottom-0 after:h-px after:opacity-0 after:transition-opacity after:duration-200 data-stuck:after:opacity-100",
        SEEKER_BLEED,
        SEEKER_GUTTER,
      )}
    >
      {heading}

      {/* A container, so the facets switch on the row's own width (see
          ./filters), which an open sidebar narrows, not on the window's. */}
      <div ref={rowRef} className="@container mt-4 flex flex-wrap items-center gap-2">
        {children}
      </div>
    </div>
  );
}
