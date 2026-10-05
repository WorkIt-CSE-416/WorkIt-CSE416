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
 * At a glance it answers two questions — is my search working (the numbers),
 * and what do I do next (Up next, and what is new in the feed) — and below
 * that, why.
 *
 * TWO TIERS. The top is the glance: the headline numbers, then Up next
 * beside New matches — everything a visit needs, on the first screen. Under
 * an Insights heading sit the charts for when the numbers raise a question:
 * the funnel (where applications drop off), activity (whether the pace is
 * holding) and what is waiting (who to follow up with). They draw the same
 * figures as the tiles, through stages and over time, which is why they sit
 * below them rather than among them: on top they read as the same number
 * three times, down here as the answer to "why".
 *
 * The range above scopes the numbers, the funnel and the activity; Up next,
 * New matches and Waiting are about now. The stat tile is the company
 * dashboard's, shared.
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

      {/* Two across even on a phone: one a row, the four tiles were the whole
          first screen, and Up next — the reason to open the page — sat
          below the fold. */}
      <div className="mt-5 grid grid-cols-2 gap-3 @4xl/main:grid-cols-4">
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

      <div className="mt-6 grid grid-cols-1 items-stretch gap-3 @4xl/main:grid-cols-[3fr_2fr]">
        <UpNext />
        <Suspense fallback={<Card padding="md" className="min-h-64" />}>
          <NewMatches />
        </Suspense>
      </div>

      <section aria-labelledby="insights" className="mt-10">
        <h2 id="insights" className="text-title text-ink">
          Insights
        </h2>
        <p className="text-body text-ink-meta mt-1">
          Where your applications drop off, and whether your pace is holding.
        </p>

        <div className="mt-4">
          <Pipeline stages={PIPELINE[range]} />
        </div>

        <div className="mt-3 grid grid-cols-1 items-stretch gap-3 @4xl/main:grid-cols-[3fr_2fr]">
          <Activity points={ACTIVITY[range].points} goal={ACTIVITY[range].goal} />
          <Waiting />
        </div>
      </section>
    </div>
  );
}
