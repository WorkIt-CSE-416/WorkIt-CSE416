"use client";

import type { ComponentType } from "react";

import { BriefcaseIcon, CalendarIcon, ClockIcon, UserIcon } from "@/components/icons";
import { StatTile } from "@/components/stat-tile";

import { STATS, type Stat } from "./data";
import { rangeLength, useRange } from "./range";

/**
 * The glyph each stat carries, resolved from the key its fixture carries.
 *
 * The plain tiles this row draws show none, but StatTile takes one for its
 * card variant, and the seeker Dashboard passes its own the same way. All four
 * come from src/components/icons.tsx, which is where a glyph lives once more
 * than one route wants it.
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
 * OPEN ON THE PAGE, the seeker Dashboard's `plain` tiles: a label on a
 * hairline, the number, and the change under it. Four white cards were four of
 * the eleven identical boxes this page used to be.
 *
 * TWO ACROSS UNTIL EACH TILE HAS ROOM FOR ITS LABEL. Beside the hero the
 * column is about 540px, which four across cuts to 116px a tile, and
 * "Awaiting Your Review" with its direction marker needs about 140: it wrapped,
 * and its number dropped below the other three. So the row goes four across
 * only at @2xl/kpis (672px of column), which happens when the hero stacks
 * under it. Keyed to the column, not the page, for the reason the seeker
 * Dashboard's docblock gives.
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
 * just a shorter window. ./range.tsx does that check. The tile keeps its line
 * either way (it prints the window instead), so the row holds its height when
 * the range changes.
 */
export function StatsRow() {
  const { range, days, previousDays } = useRange();
  const span = rangeLength(range);

  return (
    <div className="mt-auto grid grid-cols-2 gap-x-6 gap-y-6 pt-8 @2xl/kpis:grid-cols-4">
      {STATS.map((stat) => {
        if (stat.scope === "today") {
          return (
            <StatTile
              key={stat.label}
              plain
              label={stat.label}
              Icon={ICONS[stat.icon]}
              value={stat.value}
              delta={stat.delta}
            />
          );
        }

        const total = days.reduce((sum, day) => sum + day.count, 0);
        const previous = previousDays.reduce((sum, day) => sum + day.count, 0);

        return (
          <StatTile
            key={stat.label}
            plain
            label={stat.label}
            Icon={ICONS[stat.icon]}
            value={total}
            note={`Over ${span} ${span === 1 ? "day" : "days"}`}
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
