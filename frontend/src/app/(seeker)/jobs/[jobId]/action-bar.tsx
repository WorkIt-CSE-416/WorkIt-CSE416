"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

import { SEEKER_BLEED, SEEKER_GUTTER } from "../../gutter";
import { BackToJobs } from "./page-actions";

/**
 * The job posting page's top bar: Back on the left, the job's actions on the
 * right (Auto Apply, Tailor My Resume, Apply Now), held at the top of the page from md while the description scrolls
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
 * `back` replaces Back to the Jobs page: the application's own page
 * (/applications/[jobId], KAN-256) draws this bar too, and goes back to
 * Applications.
 *
 * BELOW md IT SCROLLS AWAY. On a phone the actions wrap to rows beside Back,
 * a lot to hold over a 812px screen; the Jobs page stopped
 * holding its heading on a phone for the same reason. A job's own actions
 * (`data-phone-first`, ./job-view.tsx) take a row of their own there, Apply
 * Now first and across it (KAN-569).
 */
export function JobActionBar({
  back,
  tabs,
  children,
}: {
  back?: ReactNode;
  /** The job's Overview and Company (./job-tabs), after Back. */
  tabs?: ReactNode;
  children: ReactNode;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const bar = barRef.current;
    const scroller = bar?.closest("[data-job-scroller], main");
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
        "bg-app in-data-split:@4xl/main:bg-panel relative z-10 -mt-6 mb-3 flex flex-wrap items-center justify-between gap-2 pt-6 pb-3 md:sticky md:top-0",
        "after:bg-border-subtle after:absolute after:inset-x-0 after:bottom-0 after:h-px after:opacity-0 after:transition-opacity after:duration-200 data-stuck:after:opacity-100",
        SEEKER_BLEED,
        SEEKER_GUTTER,
        // In the split view's panel: 60px, the list heading's height, with a
        // rule that always shows, running across the pane. It is the panel's
        // dark edge (`border-control`), as the list's edge beside it is: a
        // light rule inside the dark-edged panel read as a different line
        // (2026-11-03). A narrow window wraps it taller.
        "in-data-split:@4xl/main:after:bg-border-control in-data-split:@4xl/main:-mx-4! in-data-split:@4xl/main:mb-5 in-data-split:@4xl/main:px-4! in-data-split:@4xl/main:pt-3 in-data-split:@4xl/main:after:opacity-100",
      )}
    >
      {/* The split view's list is Back's list, already on screen. */}
      {back ?? <BackToJobs className="group/back in-data-split:@4xl/main:hidden" />}
      {tabs}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2 max-md:has-data-phone-first:basis-full">
        {children}
      </div>
    </div>
  );
}
