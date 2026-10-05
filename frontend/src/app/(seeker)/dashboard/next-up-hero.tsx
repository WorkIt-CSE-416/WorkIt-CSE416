import Link from "next/link";

import { ArrowRightIcon, CalendarIcon } from "@/components/icons";

import type { UpNextItem } from "./data";

/**
 * The one thing that most needs the seeker, as the page's only solid colour.
 *
 * A dashboard where every block is the same white card gives the eye nowhere
 * to land first. This is where it lands: the top of Up next, lifted out of
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
 * With nothing coming up it says so and points at the feed, rather than
 * disappearing and leaving a hole beside the numbers.
 */
export function NextUpHero({ item }: { item: UpNextItem | undefined }) {
  return (
    <section
      aria-labelledby="next-up"
      className="from-brand to-brand-active text-on-brand shadow-card relative flex min-h-52 flex-col overflow-hidden rounded-[1.25rem] bg-linear-to-br p-6"
    >
      <Arcs />

      <div className="relative flex flex-1 flex-col">
        <p className="text-caption text-white/85 uppercase">Next up</p>

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
              You&apos;re all caught up
            </h2>
            <p className="text-body mt-1 text-white/85">Nothing scheduled. A good day to apply.</p>
          </>
        )}

        <div className="mt-auto flex items-end justify-between gap-4 pt-6">
          {item && (
            <p className="text-label flex items-center gap-1.5 font-semibold">
              <CalendarIcon className="size-4 shrink-0" />
              {item.when}
            </p>
          )}

          <Link
            href={item ? "/applications" : "/jobs"}
            aria-label={item ? "Open in Applications" : "Browse jobs"}
            className="text-brand-ink ml-auto flex size-12 shrink-0 items-center justify-center rounded-full bg-white shadow-[0_8px_20px_rgb(18_26_40/0.25)] transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent focus-visible:outline-none"
          >
            <ArrowRightIcon className="size-5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function Arcs() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 200 200"
      className="pointer-events-none absolute -top-10 -right-10 size-56"
      fill="none"
      strokeLinecap="round"
    >
      <circle cx="200" cy="0" r="150" stroke="white" strokeOpacity="0.08" strokeWidth="18" />
      <circle cx="200" cy="0" r="118" stroke="white" strokeOpacity="0.14" strokeWidth="14" />
      <circle
        cx="200"
        cy="0"
        r="90"
        stroke="var(--color-brand-pale)"
        strokeOpacity="0.35"
        strokeWidth="12"
      />
      <circle cx="200" cy="0" r="64" stroke="white" strokeOpacity="0.2" strokeWidth="10" />
    </svg>
  );
}
