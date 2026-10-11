import type { Metadata } from "next";
import { Suspense } from "react";

import { SearchIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { getCurrentAccount } from "@/lib/session";

import { Greeting } from "../greeting";
import { SEEKER_GUTTER } from "../gutter";
import { appliedDays, companyIconOf, getHeadline, getUpNext } from "./data";
import { Headline } from "./headline";
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
 * Where each tile under the numbers sits. Stacked, every tile is the full
 * width. From @3xl/main the grid is two columns and Next Up and Waiting pair
 * up, packed by grid-flow-dense. From @4xl/main it is three: New Matches
 * across two of them and two rows, Next Up over Up Next in the third, then
 * Activity across two beside Waiting.
 */
const PLACE = {
  matches: "@3xl/main:col-span-2 @4xl/main:col-start-1 @4xl/main:row-span-2 @4xl/main:row-start-1",
  nextUp: "@4xl/main:col-start-3 @4xl/main:row-start-1",
  upNext: "@3xl/main:col-span-2 @4xl/main:col-span-1 @4xl/main:col-start-3 @4xl/main:row-start-2",
  activity: "@3xl/main:col-span-2 @4xl/main:col-start-1 @4xl/main:row-start-3",
  waiting: "@4xl/main:col-start-3 @4xl/main:row-start-3",
};

/**
 * /dashboard — the seeker's home, first in the panel and where sign-in lands.
 * At a glance it answers two questions: is my search working (the numbers),
 * and what do I do next (Next Up, then Up Next). Below that, it shows
 * why, and what is new.
 *
 * A BENTO OF TILES (KAN-173), modelled on a reference the user picked: white
 * tiles with no outline, set apart from the white page by a soft shadow
 * (./section-card.tsx), headings and figures at medium weight, actions as
 * pills. An outline on every tile read as a grid of grey boxes, a lavender
 * ground under them read as muted beside the shell's white panels, and open
 * sections separated only by whitespace read as cluttered and fit little.
 *
 * From @4xl/main, left to right is apply, then manage. The numbers run four
 * across the top in their own grid; under them is a grid of three columns:
 *
 *   Applications (violet)   New Roles       Interviews   Saved
 *   New Matches, two columns wide, scrolling      Next Up
 *   inside its tile to end level with them        Up Next
 *   Activity, two columns wide                    Waiting (a column per verdict)
 *
 * The first number is the one filled tile. Next Up is a reminder: its
 * commitment in violet over one filled pill. The tiles are placed by row and
 * column (PLACE above). From @3xl/main they pair up two by two; stacked, the
 * numbers come first, then Next Up.
 *
 * THREE COLUMNS UNDER THE NUMBERS, NOT FOUR. Four put Next Up, Up Next and
 * Waiting in columns 184px wide on a 13-inch laptop: Up Next cut off every
 * row, and New Matches, held to the height of its row, showed three jobs.
 * A third of the width gives the narrow tiles about 264px, and New Matches
 * the height of Next Up and Up Next together.
 *
 * FOUR COLUMNS OF NUMBERS FROM @4xl/main (896px), not 1024px. A 13-inch
 * laptop at 100% zoom gives the page about 1010px, just under 1024, and fell
 * back to two columns of oversized tiles; it only looked right at 90% zoom.
 *
 * DENSE ON PURPOSE. The page is capped at --container-dashboard (1440px)
 * rather than the 1024px reading pages use, which on a laptop left a fifth of
 * the page empty. The greeting sits open above the grid with the range switch
 * and Find Jobs at its right.
 *
 * There is no pipeline section. A funnel of Applied, Heard Back,
 * Interviewing and Offer counts sat between the lists and New Matches, and
 * it restated the headline numbers at the top in a second shape; the board
 * at /applications is where stages are worked.
 *
 * The range scopes the numbers only. Activity is a daily streak over the past
 * year, since a streak is about every day rather than a window of them; it
 * used to be a weekly pace chart, which said less about the habit than a
 * year of days does. The range is read in the browser (./range-switch.tsx):
 * this page hands the headline every range's figures, and a switch redraws
 * them in place without asking the server for the page again. Next Up, Up
 * Next, New Matches and Waiting are about now.
 *
 * Most of it is fixtures (./data.ts) until the application tracker has a
 * backend; New Roles and New Matches are the live feed.
 *
 * The grid breaks on @container/main, the page's own width, since the panel
 * takes 256px of the window when open. Up Next moves its dates at
 * @md/upnext, keyed to its own tile.
 */
export default async function DashboardPage() {
  // New Roles reads the live feed; asked for alongside the account, not after.
  const [account, stats] = await Promise.all([getCurrentAccount(), getHeadline()]);
  const firstName = account?.full_name.split(" ")[0];
  const [next, ...later] = getUpNext();

  return (
    <div className={cn("max-w-dashboard mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {firstName ? (
            <Greeting
              as="h1"
              firstName={firstName}
              className="text-heading text-ink font-semibold"
            />
          ) : (
            <h1 className="text-heading text-ink font-semibold">Dashboard</h1>
          )}
          <p className="text-body text-ink-meta mt-1">Here&apos;s where your search stands.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <RangeSwitch />
          <ButtonLink href="/jobs" size="lg" shape="pill">
            <SearchIcon className="size-4" />
            Find Jobs
          </ButtonLink>
        </div>
      </header>

      {/* The numbers, in a grid of their own: four across, while the tiles
          under them are in thirds. */}
      <div className="mt-6 grid grid-cols-2 gap-4 @4xl/main:grid-cols-4">
        <Headline stats={stats} />
      </div>

      <div className="mt-4 grid grid-flow-row-dense grid-cols-1 gap-4 @3xl/main:grid-cols-2 @4xl/main:grid-cols-3">
        <NextUpHero item={next} Icon={next && companyIconOf(next)} className={PLACE.nextUp} />
        <UpNext items={later} className={PLACE.upNext} />
        <Suspense fallback={<NewMatchesSkeleton className={PLACE.matches} />}>
          <NewMatches className={PLACE.matches} />
        </Suspense>
        <Waiting className={PLACE.waiting} />
        <Streak days={appliedDays()} className={PLACE.activity} />
      </div>
    </div>
  );
}
