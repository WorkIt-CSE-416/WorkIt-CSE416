"use client";

import { useEffect, useRef, useState } from "react";

import { formatCount } from "@/lib/format-count";

/**
 * A count that runs to its new value when it changes instead of snapping:
 * the Dashboards' headline figures as their range moves. 500ms on an ease-out
 * that matches --ease-glide, so a figure moves like everything else that
 * travels.
 *
 * ONLY A CHANGE MOVES. The first render prints the value itself, on the
 * server and in the browser alike, so a page load never counts up from zero:
 * that would flash the real figure, reset it at hydration, and make the
 * reader wait for a number the server already had. Under reduced motion a
 * change lands in one frame.
 *
 * A change mid-count starts from the figure on screen, not the old target, so
 * flicking through ranges never jumps backwards. Formatted by
 * lib/format-count.ts, and whole numbers only.
 */
export function AnimatedNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  // The figure on screen, read when a new value arrives mid-count.
  const onScreen = useRef(value);

  useEffect(() => {
    const from = onScreen.current;
    if (from === value) return;

    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500;
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = duration === 0 ? 1 : Math.min((now - start) / duration, 1);
      // easeOutQuart: quick off the mark, a long soft landing.
      const current = from + (value - from) * (1 - (1 - t) ** 4);
      onScreen.current = current;
      setShown(current);
      if (t < 1) frame = requestAnimationFrame(tick);
    });

    return () => cancelAnimationFrame(frame);
  }, [value]);

  return formatCount(Math.round(shown));
}
