"use client";

import type { ComponentType } from "react";

import { BriefcaseIcon, CalendarIcon, UserIcon } from "@/components/icons";
import { StatTile } from "@/components/stat-tile";

import { STATS, type Stat } from "./data";
import { ClockIcon } from "./icons";
import { rangeLength, useRange } from "./range";

/**
 * The glyph each stat wears, resolved from the key its fixture carries.
 *
 * Three of the four come from src/components/icons.tsx, which is where a glyph
 * lives once more than one route wants it — a briefcase is also the company
 * nav's Job Postings and a calendar is also an applicant's date. ClockIcon is
 * the company shell's own, and moves over the day a second route needs it.
 * The map lives with the row rather than in the tile, which is shared with
 * the seeker Dashboard and takes the glyph itself.
 *
 * The map is here rather than in ./data.ts so the fixtures stay free of
 * components; see the note on Stat.icon.
 */
const ICONS: Record<Stat["icon"], ComponentType<{ className?: string }>> = {
  roles: BriefcaseIcon,
  applicants: UserIcon,
  review: ClockIcon,
  interviews: CalendarIcon,
};

/**
 * The headline row, with each tile resolved against its own scope.
 *
 * WHY THIS EXISTS AS A CLIENT COMPONENT and the tiles do not: exactly one of
 * the four numbers is measured over the selected window, and it is the reason
 * the row cannot be static. Splitting the tile into a presentational box and
 * this resolver keeps the reactive surface to one file rather than making every
 * tile a client component that happens not to use the range.
 *
 * A "today" tile reads its value straight from the fixture. A "range" tile has
 * no value in the fixture at all — see the note on Stat in ./data.ts — so it is
 * summed here, and compared against the equally long span immediately before
 * the window rather than against a fixed "last week". That comparison is the
 * only honest one once the window is adjustable: at a 7-day window "+12 vs last
 * week" is a week-on-week change, and at 30 days the same phrase would be
 * comparing a month against a week.
 *
 * The delta disappears when the series does not reach back far enough for a
 * whole preceding span — at the full ninety days there is no earlier ninety to
 * measure against, and inventing a partial one would draw a fall that is really
 * just a shorter window. ./range.tsx does that check.
 */
export function StatsRow() {
  const { days, previousDays } = useRange();

  return (
    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {STATS.map((stat) => {
        if (stat.scope === "today") {
          return (
            <StatTile
              key={stat.label}
              label={stat.label}
              Icon={ICONS[stat.icon]}
              value={stat.value}
              delta={stat.delta}
            />
          );
        }

        const total = days.reduce((sum, day) => sum + day.count, 0);
        const previous = previousDays.reduce((sum, day) => sum + day.count, 0);
        const span = rangeLength({
          from: days[0]?.date ?? "",
          to: days[days.length - 1]?.date ?? "",
        });

        return (
          <StatTile
            key={stat.label}
            label={stat.label}
            Icon={ICONS[stat.icon]}
            value={total}
            delta={
              previousDays.length
                ? {
                    value: total - previous,
                    /* Today and Yesterday are one-day windows, and
                     * "vs previous 1 days" is not a sentence. */
                    period: `previous ${span} ${span === 1 ? "day" : "days"}`,
                    upIsGood: true,
                  }
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
