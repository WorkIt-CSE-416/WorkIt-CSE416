"use client";

import * as React from "react";

/**
 * A section heading that comes into focus as it arrives: wrapped around
 * `SectionHeading`, its eyebrow, title and subtitle each rise out of a blur,
 * a little apart (`.focus-in` in landing.css). An observer marks it
 * `data-focus="wait"` while it is below the screen and `"in"` once it is
 * well inside, so it plays again after the visitor scrolls back above it.
 * The server's HTML has no mark, so the heading shows before the script
 * runs; below lg and with reduced motion it is never marked, like every
 * scene on the page.
 *
 * Not a scroll-driven CSS animation (`view()`): under a pin, Chrome placed
 * the heading's view timeline hundreds of pixels from where the heading
 * stood, and it stayed blurred for most of the pinned stretch.
 */
export function FocusIn({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (
      !el ||
      !window.matchMedia("(min-width: 64rem)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) el.dataset.focus = "in";
        else if (entry.boundingClientRect.top > 0) el.dataset.focus = "wait";
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    // Already on screen: show it as it is.
    if (el.getBoundingClientRect().top > window.innerHeight * 0.88) el.dataset.focus = "wait";
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="focus-in">
      {children}
    </div>
  );
}
