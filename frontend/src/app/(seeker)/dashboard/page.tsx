import type { Metadata } from "next";
import { Suspense } from "react";

import { cn } from "@/lib/cn";
import { getCurrentAccount } from "@/lib/session";

import { Greeting } from "../greeting";
import { SEEKER_GUTTER } from "../gutter";
import { appliedDays, getHeadline } from "./data";
import { Headline } from "./headline";
import { NewMatches, NewMatchesSkeleton } from "./new-matches";
import { RangeSwitch } from "./range-switch";
import { Streak } from "./streak";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Where your job search stands.",
};

/**
 * Where each tile under the numbers sits: one column at every width, New
 * Matches across the page and Activity under it.
 *
 * NEW MATCHES GETS ITS OWN HEIGHT FROM @4xl/main. The tile is built to add no
 * height of its own there (`h-0 min-h-full`, ./new-matches.tsx) and fill a
 * row its neighbours sized; alone on a row it would collapse to nothing. So
 * the page sets a fixed height (24rem, about six rows) and lets its list
 * scroll inside it, as it did beside Next Up. Below @4xl/main it shows five
 * rows and sets no height.
 *
 * NEXT UP, UP NEXT AND WAITING ARE ARCHIVED FOR NOW (KAN-261), their code
 * kept. Next Up and Up Next went with the Calendar: the tracker stores no
 * dated events yet, so both only ever said "nothing scheduled". Waiting's
 * buckets were a fixture with no tracker data behind them. They stood in a
 * third column (Next Up over Up Next, Waiting under them), New Matches
 * spanning the first two columns and two rows, Activity across two beside
 * Waiting. To bring them back, render <NextUpHero> and <UpNext> from
 * getUpNext(), and <Waiting>, again, and restore that grid from git.
 */
const PLACE = {
  matches: "@4xl/main:h-96 @4xl/main:min-h-0",
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
 *   New Matches, the full width
 *   Activity, the full width
 *
 * Next Up, Up Next and Waiting are archived for now (PLACE above says why
 * and how to bring them back); the notes below still describe them, for that
 * day.
 *
 * The first number is the one filled tile. Next Up is a reminder: its
 * commitment in violet over one filled button. The tiles are placed by row and
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
 * at its right.
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
 * Most of it is fixtures (./data.ts) until the application tracker stores
 * stages past applied; New Roles and New Matches are the live feed, and
 * Saved the live tracker (KAN-261).
 *
 * The grid breaks on @container/main, the page's own width, since the panel
 * takes 256px of the window when open. Up Next moves its dates at
 * @md/upnext, keyed to its own tile.
 */
export default async function DashboardPage() {
  // New Roles and Saved read the API; asked for alongside the account, not
  // after.
  const [account, stats] = await Promise.all([getCurrentAccount(), getHeadline()]);
  const firstName = account?.full_name.split(" ")[0];

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

        {/* Find Jobs sat beside it until KAN-261: the sidebar's Jobs row and
            New Matches' All Jobs already lead there. */}
        <RangeSwitch />
      </header>

      {/* The numbers, in a grid of their own: four across, while the tiles
          under them are one column. */}
      <div className="mt-6 grid grid-cols-2 gap-4 @4xl/main:grid-cols-4">
        <Headline stats={stats} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4">
        <Suspense fallback={<NewMatchesSkeleton className={PLACE.matches} />}>
          <NewMatches className={PLACE.matches} />
        </Suspense>
        <Streak days={appliedDays()} />
      </div>
    </div>
  );
}
