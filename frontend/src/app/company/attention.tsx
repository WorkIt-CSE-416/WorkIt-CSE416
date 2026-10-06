import Link from "next/link";
import type { ComponentType } from "react";

import {
  ArrowRightIcon,
  AwardIcon,
  CalendarIcon,
  ClockIcon,
  MailIcon,
  UserIcon,
} from "@/components/icons";
import { HeroArcs } from "@/components/hero-arcs";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "@/components/ui/section-heading";
import { SectionLink } from "@/components/ui/section-link";
import { cn } from "@/lib/cn";

import type { Attention } from "./data";

/**
 * What is waiting on the company, in two halves: the longest wait as the
 * page's one solid colour, and the rest as an open list further down. The
 * company's version of the seeker Dashboard's Next up and Up next
 * ((seeker)/dashboard/next-up-hero.tsx and up-next.tsx), and the same shape:
 * what is needed first, whose it is second, how long last.
 */

/** "1 day", "4 days", for the hero's "Waiting 4 days" line. */
function waited(days: number) {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** "1 Day", "4 Days", for the list's wait badge, which is Title Case. */
function waitBadge(days: number) {
  return `${days} ${days === 1 ? "Day" : "Days"}`;
}

/**
 * The single most urgent thing, on a violet card beside the headline numbers.
 *
 * A dashboard of equal white boxes gives the eye nowhere to land first. This is
 * where it lands, so everything else on the page stays quiet: it is the only
 * solid fill. The arrow goes to Applicants, where every item on this list is
 * cleared.
 *
 * Drawn exactly as the seeker hero, gradient, arcs and arrow alike, so the two
 * dashboards read as one product. White on the gradient is 6.26:1 at its light
 * end (#6d3fd8); the secondary lines are white at 85%, still above 4.5:1 there.
 *
 * With nothing waiting it says so, rather than disappearing and leaving a hole
 * beside the numbers.
 */
export function AttentionHero({ item }: { item: Attention | undefined }) {
  return (
    <section
      aria-labelledby="most-urgent"
      className="from-brand to-brand-active text-on-brand shadow-card rounded-shell relative flex min-h-52 flex-col overflow-hidden bg-linear-to-br p-6"
    >
      <HeroArcs />

      <div className="relative flex flex-1 flex-col">
        <p className="text-caption text-white/85 uppercase">Most Urgent</p>

        {item ? (
          <>
            <h2 id="most-urgent" className="text-title mt-2 max-w-[75%]">
              {item.need}
            </h2>
            <p className="text-body mt-1 text-white/85">{item.role}</p>
          </>
        ) : (
          <>
            <h2 id="most-urgent" className="text-title mt-2 max-w-[75%]">
              You&apos;re All Caught Up
            </h2>
            <p className="text-body mt-1 text-white/85">Nothing is waiting on you right now.</p>
          </>
        )}

        <div className="mt-auto flex items-end justify-between gap-4 pt-6">
          {item && (
            <p className="text-label flex items-center gap-1.5 font-semibold">
              <ClockIcon className="size-4 shrink-0" />
              Waiting {waited(item.waitingDays)}
            </p>
          )}

          <Link
            href="/company/applicants"
            aria-label={item ? "Review in Applicants" : "Open Applicants"}
            className="text-brand-ink ml-auto flex size-12 shrink-0 items-center justify-center rounded-full bg-white shadow-[0_8px_20px_rgb(18_26_40/0.25)] transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent focus-visible:outline-none"
          >
            <ArrowRightIcon className="size-5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * Each row wears the stage its applicants are stuck in, so the colour says the
 * same thing as that stage's badge in the applicants table and its slice of
 * the ring: grey Applied, violet Screening, blue Interview, green Offer.
 *
 * The fills are the dark end of each hue rather than ./data.ts's chart slots,
 * because a white glyph sits on them: white on the chart grey (#94969d) is
 * 2.95:1 and on the chart green (#17b076) 2.80:1, both under 3:1.
 * --color-ink-meta and --color-positive-ink clear it, as they do for the
 * seeker's stage glyphs.
 * Interview and Offer take the seeker's calendar and award, so a stage keeps
 * its glyph on both sides of the app.
 */
const STAGE_GLYPH: Record<
  Attention["stage"],
  { fill: string; Icon: ComponentType<{ className?: string }> }
> = {
  Applied: { fill: "bg-ink-meta", Icon: UserIcon },
  Screening: { fill: "bg-brand", Icon: MailIcon },
  Interview: { fill: "bg-advanced", Icon: CalendarIcon },
  Offer: { fill: "bg-positive-ink", Icon: AwardIcon },
};

/**
 * The rest of what is waiting on the company, under the hero's item. Open on
 * the page, not in a card: a short list of rows with round glyphs reads as a
 * list without a box around it.
 *
 * Its "View All" at the top right goes to Applicants, where every item here is
 * cleared, as the seeker's Up next links to Applications. Without it the only
 * way to act on the list was the hero's arrow, a screen or more above it on a
 * phone.
 *
 * The wait is a badge, amber from four days, which is when an item has sat
 * long enough to be late rather than merely queued.
 */
export function NeedsAttention({ items }: { items: Attention[] }) {
  return (
    <section aria-labelledby="needs-attention">
      <SectionHeading
        id="needs-attention"
        action={
          <SectionLink href="/company/applicants" label="View All Applicants">
            View All
          </SectionLink>
        }
      >
        Needs Your Attention
      </SectionHeading>
      <p className="text-body text-ink-meta mt-1">Also waiting on you, not on the applicant.</p>

      {items.length === 0 ? (
        <p className="text-body text-ink-meta mt-4">Nothing else is waiting on you.</p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {items.map(({ id, role, need, stage, waitingDays }) => {
            const { fill, Icon } = STAGE_GLYPH[stage];

            return (
              <li
                key={id}
                className="border-border-subtle flex items-center gap-3 border-b py-3 last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full text-white",
                    fill,
                  )}
                >
                  <Icon className="size-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-label text-ink truncate font-semibold">{need}</p>
                  <p className="text-note text-ink-meta truncate">
                    {role} · {stage}
                  </p>
                </div>

                <Badge variant="status" tone={waitingDays >= 4 ? "warning" : "inert"}>
                  {waitBadge(waitingDays)}
                  <span className="sr-only"> waiting</span>
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
