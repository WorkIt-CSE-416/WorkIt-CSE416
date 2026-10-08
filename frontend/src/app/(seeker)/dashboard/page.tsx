import type { Metadata } from "next";
import { Suspense } from "react";

import { AwardIcon, BriefcaseIcon, CalendarIcon, MailIcon } from "@/components/icons";
import { StatTile } from "@/components/stat-tile";
import { cn } from "@/lib/cn";
import { getCurrentAccount } from "@/lib/session";

import { Greeting } from "../greeting";
import { SEEKER_GUTTER } from "../gutter";
import { RANGES, STATS, UP_NEXT, appliedDays, parseRange } from "./data";
import { NewMatches, NewMatchesSkeleton } from "./new-matches";
import { NextUpHero } from "./next-up-hero";
import { RangeSwitch } from "./range-switch";
import { Streak } from "./streak";
import { UpNext } from "./up-next";
import { Waiting } from "./waiting";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Where your job search stands.",
};

/**
 * /dashboard — the seeker's home, first in the panel and where sign-in lands.
 * At a glance it answers two questions: is my search working (the numbers),
 * and what do I do next (the violet card, then Up Next). Below that, it shows
 * why, and what is new.
 *
 * NOT EVERYTHING IN A WHITE CARD. It used to be eight identical white boxes,
 * and a page of equal boxes has no first place to look. Now each kind of
 * thing has its own surface:
 *
 *   the numbers     open on the page under the greeting, on hairlines
 *   Next Up         the one solid colour: a violet card with the single most
 *                   pressing commitment, where the eye lands first
 *   Activity, lists open sections under plain headings
 *
 * so the page reads as a layout rather than a grid of containers. Whitespace
 * separates the open sections; only the hero is filled.
 *
 * There is no pipeline section. A funnel of Applied, Heard Back,
 * Interviewing and Offer counts sat between the lists and New Matches, and
 * it restated the headline numbers at the top in a second shape; the board
 * at /applications is where stages are worked.
 *
 * The range scopes the numbers only. Activity is a daily streak over the past
 * year, since a streak is about every day rather than a window of them; it
 * used to be a weekly pace chart, which said less about the habit than a
 * year of days does. Next Up, Up Next, New Matches and Waiting are about now.
 *
 * Most of it is fixtures (./data.ts) until the application tracker has a
 * backend; New Matches is the live feed.
 *
 * Columns break on @container/main, the page's own width, since the panel
 * takes 256px of the window when open. What lives inside one of those columns
 * breaks on the column instead: the headline numbers go four across at
 * @lg/kpis and Up Next moves its dates at @md/upnext. Keyed to the page, the
 * numbers went four across in a 3fr column too narrow for them, and "Response
 * Rate" wrapped and dropped its value below the other three.
 */
const STAT_ICONS = [BriefcaseIcon, MailIcon, CalendarIcon, AwardIcon];

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const range = parseRange((await searchParams).range);
  const { period, note } = RANGES.find((option) => option.key === range)!;
  const account = await getCurrentAccount();
  const firstName = account?.full_name.split(" ")[0];
  const [next, ...later] = UP_NEXT;

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <div className="grid grid-cols-1 items-stretch gap-8 @4xl/main:grid-cols-[3fr_2fr]">
        <div className="@container/kpis flex flex-col">
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

          <div className="mt-auto grid grid-cols-2 gap-x-6 gap-y-6 pt-8 @lg/kpis:grid-cols-4">
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
        <Streak days={appliedDays()} />
        <UpNext items={later} />
      </div>

      <div className="mt-12 grid grid-cols-1 gap-10 @4xl/main:grid-cols-[3fr_2fr]">
        <Suspense fallback={<NewMatchesSkeleton />}>
          <NewMatches />
        </Suspense>
        <Waiting />
      </div>
    </div>
  );
}
