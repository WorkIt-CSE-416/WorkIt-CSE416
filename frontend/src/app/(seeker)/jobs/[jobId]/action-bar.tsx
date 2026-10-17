"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

import { SEEKER_BLEED, SEEKER_GUTTER } from "../../gutter";
import { BackToJobs } from "./page-actions";

/**
 * The job posting page's top bar: Back on the left, the job's actions on the
 * right (Save, the "…" menu, Ask Scout, Auto Apply, Tailor My Resume, Apply
 * Now), held at the top of the page from md while the description scrolls
 * under it, so a seeker can apply or tailor from anywhere in a long posting
 * (2026-10-17). The actions used to sit under the title in the header card and
 * scrolled away with it.
 *
 * Drawn the way the Jobs page's own header is (`../feed-header.tsx`): the
 * panel's white so the text vanishes under it, across the page's side gutters
 * (SEEKER_BLEED), taking over the page's top padding (-mt-6 pt-6) so Back
 * sits where it did, and a hairline that fades in once something is under it.
 * Above the page's layers, below every popup, which is portaled.
 *
 * BELOW md IT SCROLLS AWAY. On a phone the six actions wrap to three rows
 * beside Back, about 150px held over a 812px screen; the Jobs page stopped
 * holding its heading on a phone for the same reason.
 */
export function JobActionBar({ children }: { children: ReactNode }) {
  const barRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const bar = barRef.current;
    const scroller = bar?.closest("main");
    if (!bar || !scroller) return;
    // Stuck once the page has scrolled and the bar sits at its sticky top,
    // counted from inside the <main>'s border (clientTop), as the feed's is.
    const check = () => {
      const offset =
        bar.getBoundingClientRect().top -
        (scroller.getBoundingClientRect().top + scroller.clientTop);
      setStuck(
        scroller.scrollTop > 0 && getComputedStyle(bar).position === "sticky" && offset <= 0.5,
      );
    };
    check();
    scroller.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      scroller.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  return (
    <div
      ref={barRef}
      data-stuck={stuck || undefined}
      className={cn(
        "bg-panel relative z-10 -mt-6 mb-3 flex flex-wrap items-center justify-between gap-2 pt-6 pb-3 md:sticky md:top-0",
        "after:bg-border-subtle after:absolute after:inset-x-0 after:bottom-0 after:h-px after:opacity-0 after:transition-opacity after:duration-200 data-stuck:after:opacity-100",
        SEEKER_BLEED,
        SEEKER_GUTTER,
      )}
    >
      <BackToJobs className="group/back" />
      <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}
