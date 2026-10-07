"use client";

import { AwardIcon, BriefcaseIcon, CalendarIcon, MailIcon } from "@/components/icons";
import { StatTile } from "@/components/stat-tile";

import type { DashboardStat } from "./data";
import { RANGES, type RangeKey } from "./range";
import { useRange } from "./range-switch";

const STAT_ICONS = [BriefcaseIcon, MailIcon, CalendarIcon, AwardIcon];

/**
 * The headline numbers for the range in the URL. It is handed every range's
 * figures and picks one in the browser, so moving the range switch counts
 * each figure to its new value at once (StatTile's figure is an
 * AnimatedNumber) rather than after the server has drawn the page again.
 */
export function Headline({ stats }: { stats: Record<RangeKey, DashboardStat[]> }) {
  const range = useRange();
  const { period, note } = RANGES.find((option) => option.key === range)!;

  return (
    <div className="mt-auto grid grid-cols-2 gap-x-6 gap-y-6 pt-8 @lg/kpis:grid-cols-4">
      {stats[range].map((stat, i) => (
        <StatTile
          key={stat.label}
          plain
          label={stat.label}
          Icon={STAT_ICONS[i]}
          value={stat.value}
          suffix={stat.suffix}
          note={note}
          delta={
            stat.previous !== null && period
              ? { value: stat.value - stat.previous, period, upIsGood: true }
              : undefined
          }
        />
      ))}
    </div>
  );
}
