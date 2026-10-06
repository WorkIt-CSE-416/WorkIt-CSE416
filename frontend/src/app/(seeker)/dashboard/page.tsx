import type { Metadata } from "next";
import { Suspense } from "react";

import { AwardIcon, BriefcaseIcon, CalendarIcon, MailIcon } from "@/components/icons";
import { StatTile } from "@/components/stat-tile";
import { cn } from "@/lib/cn";
import { getCurrentAccount } from "@/lib/session";

import { Greeting } from "../greeting";
import { SEEKER_GUTTER } from "../gutter";
import { Activity } from "./activity";
import { ACTIVITY, PIPELINE, RANGES, STATS, UP_NEXT, parseRange } from "./data";
import { NewMatches } from "./new-matches";
import { NextUpHero } from "./next-up-hero";
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
 * and what do I do next (the violet card, then Up next) — and below that,
 * why, and what is new.
 *
 * NOT EVERYTHING IN A WHITE CARD. It used to be eight identical white boxes,
 * and a page of equal boxes has no first place to look. Now each kind of
 * thing has its own surface:
 *
 *   the numbers     open on the page under the greeting, on hairlines
 *   Next up         the one solid colour: a violet card with the single most
 *                   pressing commitment, where the eye lands first
 *   Activity, lists open sections under plain headings
 *   the pipeline    a lavender band of small white cards with coloured
 *                   badges and a violet "Full board" tile
 *
 * so the page reads as a layout rather than a grid of containers. Whitespace
 * separates the open sections; only the hero and the band are filled.
 *
 * The range scopes the numbers, the activity and the pipeline; Next up, Up
 * next, New matches and Waiting are about now.
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
  const { period, scope, note } = RANGES.find((option) => option.key === range)!;
  const account = await getCurrentAccount();
  const firstName = account?.full_name.split(" ")[0];
  const [next, ...later] = UP_NEXT;

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <div className="grid grid-cols-1 items-stretch gap-8 @4xl/main:grid-cols-[3fr_2fr]">
        <div className="flex flex-col">
          <header className="flex flex-wrap items-start justify-between gap-3">
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

          <div className="mt-auto grid grid-cols-2 gap-x-6 gap-y-6 pt-8 @xl/main:grid-cols-4">
            {STATS[range].map((stat, i) => (
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
        </div>

        <NextUpHero item={next} />
      </div>

      <div className="mt-12 grid grid-cols-1 gap-10 @4xl/main:grid-cols-[3fr_2fr]">
        <Activity points={ACTIVITY[range].points} goal={ACTIVITY[range].goal} />
        <UpNext items={later} />
      </div>

      <div className="mt-12">
        <Pipeline stages={PIPELINE[range]} scope={scope} />
      </div>

      <div className="mt-12 grid grid-cols-1 gap-10 @4xl/main:grid-cols-[3fr_2fr]">
        <Suspense fallback={<div className="min-h-64" />}>
          <NewMatches />
        </Suspense>
        <Waiting />
      </div>
    </div>
  );
}
