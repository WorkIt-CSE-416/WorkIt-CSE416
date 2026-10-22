"use client";

import * as React from "react";

/**
 * Lets the Pricing board's feature rows rise in as they reach the screen.
 * Each row (`[data-row]`) plays its rise once on load (landing.css,
 * `.price-cell`); a row still below the screen when this runs is marked
 * `wait` instead, which holds it hidden, and `in` once it arrives, which
 * plays the rise again. A row goes back to `wait` only once it is wholly
 * below the screen, as `FocusIn` does, so it never vanishes in view. Rows
 * already on screen keep their load rise untouched: marking them would
 * restart it half way.
 *
 * Draws a hidden span inside the board, which takes no grid cell, to find
 * the board. From lg up only, like FocusIn, and not with reduced motion.
 */
export function RowArrival() {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    const board = ref.current?.parentElement;
    if (
      !board ||
      !window.matchMedia("(min-width: 64rem)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const rows = Array.from(board.querySelectorAll<HTMLElement>("[data-row]"));
    const show = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const row = entry.target as HTMLElement;
          if (entry.isIntersecting && row.dataset.row === "wait") row.dataset.row = "in";
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    const hide = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting && entry.boundingClientRect.top > 0) {
          (entry.target as HTMLElement).dataset.row = "wait";
        }
      }
    });
    for (const row of rows) {
      if (row.getBoundingClientRect().top > window.innerHeight * 0.92) row.dataset.row = "wait";
      show.observe(row);
      hide.observe(row);
    }
    return () => {
      show.disconnect();
      hide.disconnect();
    };
  }, []);
  return <span ref={ref} hidden />;
}
