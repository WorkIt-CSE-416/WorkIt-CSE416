import type { Metadata } from "next";
import { Suspense } from "react";

import { AwardIcon, BriefcaseIcon, CalendarIcon, MailIcon } from "@/components/icons";
import { StatTile } from "@/components/stat-tile";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { getCurrentAccount } from "@/lib/session";

import { Greeting } from "../greeting";
import { SEEKER_GUTTER } from "../gutter";
import { Activity } from "./activity";
import { ACTIVITY, PIPELINE, RANGES, STATS, parseRange } from "./data";
import { NewMatches } from "./new-matches";
import { Pipeline } from "./pipeline";
import { RangeSwitch } from "./range-switch";
import { UpNext } from "./up-next";
import { Waiting } from "./waiting";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Where your job search stands.",
};

/**
 * /dashboard — the seeker's home, first in the panel and where sign-in lands.
 * Built from the company dashboard's parts (the stat tile is shared; Up next,
 * Waiting and Pipeline are the seeker's versions of Needs your attention, Time
 * in stage and Application Status) around one question: what should I do
 * today, and is my search working?
 *
 * ORDER IS PRIORITY. Up next leads, because a student's next commitment is
 * worth more than any total, with what is waiting beside it. Then the numbers
 * for the window, the funnel they come from, the pace behind them, and what is
 * new in the feed.
 *
 * Most of it is fixtures (./data.ts) until the application tracker has a
 * backend; New matches is the live feed.
 *
 * Columns break on @container/main, the page's own width, since the panel
 * takes 256px of the window when open.
 */
const STAT_ICONS = [BriefcaseIcon, MailIcon, CalendarIcon, AwardIcon];

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const range = parseRange((await searchParams).range);
  const { period } = RANGES.find((option) => option.key === range)!;
  const account = await getCurrentAccount();
  const firstName = account?.full_name.split(" ")[0];

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {firstName ? (
            <Greeting as="h1" firstName={firstName} className="text-heading text-ink" />
          ) : (
            <h1 className="text-heading text-ink">Dashboard</h1>
          )}
          <p className="text-body text-ink-meta mt-1">Here&apos;s where your search stands.</p>
        </div>

        <RangeSwitch current={range} />
      </header>

      <div className="mt-5 grid grid-cols-1 items-stretch gap-3 @4xl/main:grid-cols-[3fr_2fr]">
        <UpNext />
        <Waiting />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 @xl/main:grid-cols-2 @4xl/main:grid-cols-4">
        {STATS[range].map((stat, i) => (
          <StatTile
            key={stat.label}
            label={stat.label}
            Icon={STAT_ICONS[i]}
            value={stat.value}
            suffix={stat.suffix}
            delta={
              stat.previous !== null && period
                ? { value: stat.value - stat.previous, period, upIsGood: true }
                : undefined
            }
          />
        ))}
      </div>

      <div className="mt-6">
        <Pipeline stages={PIPELINE[range]} />
      </div>

      <div className="mt-6 grid grid-cols-1 items-stretch gap-3 @4xl/main:grid-cols-[3fr_2fr]">
        <Activity points={ACTIVITY[range].points} goal={ACTIVITY[range].goal} />
        <Suspense fallback={<Card padding="md" className="min-h-64" />}>
          <NewMatches />
        </Suspense>
      </div>
    </div>
  );
}
