import type { Metadata } from "next";
import { Suspense } from "react";

import { cn } from "@/lib/cn";
import { getCurrentAccount } from "@/lib/session";

import { Greeting } from "../greeting";
import { SEEKER_GUTTER } from "../gutter";
import { getAppliedTimes, getHeadline } from "./data";
import { Headline } from "./headline";
import { RangeSwitch } from "./range-switch";
import { Streak } from "./streak";
import { TopMatches, TopMatchesSkeleton } from "./top-matches";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Where your job search stands.",
};

/*
 * NEXT UP, UP NEXT AND WAITING ARE ARCHIVED FOR NOW (KAN-261), their code
 * kept. Next Up and Up Next went with the Calendar: the tracker stores no
 * dated events yet, so both only ever said "nothing scheduled". Waiting's
 * buckets are a fixture with no tracker data behind them. They stood in a
 * third column (Next Up over Up Next, Waiting under them), with a list of
 * the newest jobs spanning the first two columns and two rows, Activity
 * across two beside Waiting. To bring them back, render <NextUpHero> and
 * <UpNext> from getUpNext(), and <Waiting>, again, and restore that grid
 * from git.
 *
 * TOP MATCHES UNDER THE NUMBERS (KAN-342, ./top-matches.tsx): the
 * seeker's twelve best-scoring jobs as flat rows that scroll inside one
 * tile, with no score floor. New Matches, the
 * newest postings in posting order, sat there until Strong Matches replaced
 * New Roles; the user asked for a list back, ordered by fit, since a new
 * seeker can have only weak matches and still needs their best ones. It
 * streams in its own <Suspense>, so the numbers never wait on scoring.
 */

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
 * From @4xl/main the numbers run four across the top in their own grid,
 * and Activity runs the full width under them:
 *
 *   Strong Matches (violet)   Saved   Applied   Interviewing
 *   Top Matches, a scrolling list of rows, See More Matches at its right
 *   Activity, the full width
 *
 * Next Up, Up Next and Waiting are archived for now (the note above says
 * why and how to bring them back); the notes below still describe them, for
 * that day.
 *
 * Strong Matches is the one filled tile (./data.ts says why). Next Up is a reminder: its
 * commitment in violet over one filled button. Below @4xl/main the numbers
 * pair up two by two.
 *
 * THREE COLUMNS UNDER THE NUMBERS, NOT FOUR. Four put Next Up, Up Next and
 * Waiting in columns 184px wide on a 13-inch laptop: Up Next cut off every
 * row, and the jobs list then beside them, held to the height of its row,
 * showed three jobs. A third of the width gave the narrow tiles about 264px.
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
 * Interviewing and Offer counts sat between the lists and the jobs list, and
 * it restated the headline numbers at the top in a second shape; the board
 * at /applications is where stages are worked.
 *
 * The range scopes the numbers only. Activity is a daily streak over the past
 * year, since a streak is about every day rather than a window of them; it
 * used to be a weekly pace chart, which said less about the habit than a
 * year of days does. The range is read in the browser (./range-switch.tsx):
 * this page hands the headline every range's figures, and a switch redraws
 * them in place without asking the server for the page again. Next Up, Up
 * Next and Waiting are about now.
 *
 * Nothing shown is a fixture (KAN-342): Strong Matches is the seeker's Best
 * Match scores, and Saved, Applied and Activity the live tracker.
 * Interviewing is a dash, "Not tracked yet", until the tracker stores stages
 * past applied (./data.ts).
 *
 * The grid breaks on @container/main, the page's own width, since the panel
 * takes 256px of the window when open. Up Next moves its dates at
 * @md/upnext, keyed to its own tile.
 */
export default async function DashboardPage() {
  // The numbers and Activity read the API; asked for alongside the account,
  // not after. getTracker caches the one tracker read both make.
  const [account, stats, applied] = await Promise.all([
    getCurrentAccount(),
    getHeadline(),
    getAppliedTimes(),
  ]);
  const firstName = account?.full_name.split(" ")[0];

  return (
    <div className={cn("max-w-dashboard mx-auto w-full flex-1 py-5", SEEKER_GUTTER)}>
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
            the Strong Matches tile already lead there. */}
        <RangeSwitch />
      </header>

      {/* The numbers, in a grid of their own: four across, with Activity
          the full width under them. */}
      <div className="mt-5 grid grid-cols-2 gap-4 @4xl/main:grid-cols-4">
        <Headline stats={stats} />
      </div>

      <Suspense fallback={<TopMatchesSkeleton className="mt-4" />}>
        <TopMatches className="mt-4" />
      </Suspense>

      <Streak applied={applied} className="mt-4" />
    </div>
  );
}
