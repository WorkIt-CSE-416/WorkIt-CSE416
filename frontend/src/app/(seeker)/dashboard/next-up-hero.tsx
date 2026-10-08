import Link from "next/link";

import { HeroArcs } from "@/components/hero-arcs";
import { ArrowRightIcon, CalendarIcon } from "@/components/icons";

import { DayLink, When } from "../local-time";
import type { UpNextItem } from "./data";

/**
 * The one thing that most needs the seeker, as the page's only solid colour.
 *
 * A dashboard where every block is the same white card gives the eye nowhere
 * to land first. This is where it lands: the top of Up Next, lifted out of
 * the list onto a violet card beside the headline numbers. Everything else
 * on the page stays quiet so this can be loud.
 *
 * THE ARCS are decoration, nothing more — concentric strokes in the corner,
 * white at low opacity, so the card reads as a designed object rather than a
 * filled rectangle. aria-hidden, and drawn behind the text (the text sits in
 * a relative layer above them).
 *
 * White on the gradient is 6.26:1 at the light end (#6d3fd8) and higher as it
 * deepens; the secondary lines use white at 85%, which stays above 4.5:1 on
 * the lightest stop.
 *
 * The arrow opens this application's detail panel on /applications, so the
 * one thing that most needs the seeker is one click from its whole timeline.
 * The date is the viewer's own clock (<When>), "Tomorrow, 2:00 PM", and a link
 * to that week on the Calendar.
 *
 * With nothing coming up it says so and points at the feed, rather than
 * disappearing and leaving a hole beside the numbers.
 */
export function NextUpHero({ item }: { item: UpNextItem | undefined }) {
  return (
    <section
      aria-labelledby="next-up"
      className="from-brand to-brand-active text-on-brand shadow-card rounded-shell relative flex min-h-52 flex-col overflow-hidden bg-linear-to-br p-6"
    >
      <HeroArcs />

      <div className="relative flex flex-1 flex-col">
        <p className="text-caption text-white/85 uppercase">Next Up</p>

        {item ? (
          <>
            <h2 id="next-up" className="text-title mt-2 max-w-[75%]">
              {item.title}
            </h2>
            <p className="text-body mt-1 text-white/85">
              {item.role} · {item.company}
            </p>
          </>
        ) : (
          <>
            <h2 id="next-up" className="text-title mt-2 max-w-[75%]">
              You&apos;re All Caught Up
            </h2>
            <p className="text-body mt-1 text-white/85">Nothing scheduled. A good day to apply.</p>
          </>
        )}

        <div className="mt-auto flex items-end justify-between gap-4 pt-6">
          {item && (
            <DayLink
              at={item.at}
              view="week"
              // Its underline fades in under the pointer rather than
              // snapping on.
              className="text-label flex items-center gap-1.5 rounded-xs font-semibold underline decoration-transparent underline-offset-4 transition-[text-decoration-color] duration-150 hover:decoration-current focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            >
              <CalendarIcon className="size-4 shrink-0" />
              <When at={item.at} />
            </DayLink>
          )}

          <Link
            href={item ? `/applications?app=${item.applicationId}` : "/jobs"}
            aria-label={item ? `Open ${item.role} at ${item.company}` : "Browse Jobs"}
            // Swells a little under the pointer, its arrow leaning on, and
            // presses in on the click, all on the glide.
            className="group/next text-brand-ink ease-glide ml-auto flex size-12 shrink-0 items-center justify-center rounded-full bg-white shadow-[0_8px_20px_rgb(18_26_40/0.25)] transition-transform duration-200 hover:scale-105 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent focus-visible:outline-none active:scale-95"
          >
            <ArrowRightIcon className="ease-glide size-5 transition-transform duration-200 group-hover/next:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
