import { CalendarIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import { DayLink, When } from "../local-time";
import type { UpNextItem } from "./data";
import { SectionCard } from "./section-card";

/**
 * The one thing that most needs the seeker: the top of Up Next, lifted out of
 * the list into its own tile beside it.
 *
 * A reminder, the way Home's reference draws one: a white tile whose
 * commitment is set large in brand violet, its date under it, and one filled
 * button at the foot, View Details (a pill until KAN-251). It used to be a violet gradient card with
 * arcs; once the first headline number became the row's filled tile, two
 * violet blocks side by side competed, so the colour moved into the title and
 * the button.
 *
 * It draws no company tile: the tracker's stand-in glyphs went with its
 * fixture (KAN-261), and an Up Next item carries no logo yet.
 *
 * The button opens this application's detail panel on /applications, so the
 * one thing that most needs the seeker is one click from its whole timeline.
 * The date is the viewer's own clock (<When>), "Tomorrow, 2:00 PM", and a link
 * to that week on the Calendar.
 *
 * With nothing coming up it says so and points at the feed, rather than
 * disappearing and leaving a hole in the row.
 */
export function NextUpHero({
  item,
  className,
}: {
  item: UpNextItem | undefined;
  /** Where the page puts it on the grid. */
  className?: string;
}) {
  return (
    <SectionCard aria-labelledby="next-up" className={cn("flex min-h-52 flex-col", className)}>
      <h2 id="next-up" className="text-subtitle text-ink font-medium">
        Next Up
      </h2>

      {item ? (
        <div className="mt-3 flex items-start gap-3">
          <div className="min-w-0">
            <p className="text-title text-brand-ink font-semibold">{item.title}</p>
            <p className="text-body text-ink-meta mt-0.5">
              {item.role} · {item.company}
            </p>
            {/* The date in a pill, like every date on Home, and a
                link to that week on the Calendar: its words underline under
                the pointer. In the text's column, not under the tile, as Up
                Next's rows set theirs. */}
            <DayLink
              at={item.at}
              view="week"
              className="group/when focus-visible:ring-brand-ring mt-2.5 flex w-fit rounded-full focus-visible:ring-2 focus-visible:outline-none"
            >
              <Badge variant="tag" pill>
                <span className="flex items-center gap-1.5 underline-offset-2 group-hover/when:underline">
                  <CalendarIcon className="size-3.5 shrink-0" />
                  <When at={item.at} />
                </span>
              </Badge>
            </DayLink>
          </div>
        </div>
      ) : (
        <>
          <p className="text-title text-brand-ink mt-3 font-semibold">You&apos;re All Caught Up</p>
          <p className="text-body text-ink-meta mt-1">Nothing scheduled. A good day to apply.</p>
        </>
      )}

      <div className="mt-auto pt-5">
        {/* "View Details", not "Open Application": the longer label wrapped
            onto two lines in the narrowest four-column layout. The link's
            name still says whose details. */}
        <ButtonLink
          href={item ? `/applications?app=${item.applicationId}` : "/jobs"}
          aria-label={item ? `View ${item.role} at ${item.company}` : undefined}
          size="lg"
          className="w-full"
        >
          {item ? "View Details" : "Browse Jobs"}
        </ButtonLink>
      </div>
    </SectionCard>
  );
}
