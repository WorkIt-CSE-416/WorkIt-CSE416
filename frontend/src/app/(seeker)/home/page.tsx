import type { Metadata } from "next";
import { Suspense } from "react";

import { getCurrentAccount } from "@/lib/session";

import { Greeting } from "../greeting";
import { getAppliedTimes, getHeadline } from "./data";
import { HomeFrame } from "./frame";
import { Headline, HeadlineSkeleton } from "./headline";
import { Streak, StreakSkeleton } from "./streak";
import { loadTopMatches, TopMatches, TopMatchesSkeleton } from "./top-matches";

export const metadata: Metadata = {
  title: "Home",
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
 * streams in its own <Suspense>, so the numbers never wait on its scoring,
 * and its reads start with the page (loadTopMatches), so it never waits on
 * the numbers' reads either.
 *
 * ONLY THE GREETING WAITS (KAN-368). The page awaits the account alone, one
 * plain read the bar makes too (cached per render), and draws the header;
 * the numbers, Top Matches and Activity each stream in a <Suspense> of their
 * own over a skeleton of their own shape (HeadlineSkeleton, TopMatches-
 * Skeleton, StreakSkeleton). Every read is started before that one await,
 * so none waits on another. The page awaited the numbers too, and the
 * Strong Matches count is a full scoring pass, so sign-in's landing page,
 * and every visit to it, showed nothing until that pass was done; on a hard
 * load not even the shell's first byte left before it. ./loading.tsx draws
 * the same frame with those skeletons, for the moment before the account
 * arrives, so the page that replaces it moves nothing.
 */

/**
 * /home — the seeker's home, first in the panel and where sign-in lands.
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
export default async function HomePage() {
  // Every read starts here, before the one await below, so none waits on
  // another: Top Matches' two scoring calls run beside the Strong Matches
  // one, not after it. None of these promises rejects (each answers null or
  // "empty" on a failure; ./top-matches.tsx, loadTopMatches, says why that
  // matters). getTracker caches the one tracker read the numbers and
  // Activity share.
  const topMatches = loadTopMatches();
  const stats = getHeadline();
  const applied = getAppliedTimes();

  // Only the greeting waits: one plain read, which the bar makes too.
  const account = await getCurrentAccount();
  const firstName = account?.full_name.split(" ")[0];

  return (
    <HomeFrame
      heading={
        firstName ? (
          <Greeting as="h1" firstName={firstName} className="text-heading text-ink font-semibold" />
        ) : (
          <h1 className="text-heading text-ink font-semibold">Home</h1>
        )
      }
      tiles={
        <Suspense fallback={<HeadlineSkeleton />}>
          <HeadlineTiles stats={stats} />
        </Suspense>
      }
      topMatches={
        <Suspense fallback={<TopMatchesSkeleton className="mt-4" />}>
          <TopMatches data={topMatches} className="mt-4" />
        </Suspense>
      }
      activity={
        <Suspense fallback={<StreakSkeleton className="mt-4" />}>
          <Activity applied={applied} className="mt-4" />
        </Suspense>
      }
    />
  );
}

/** The four numbers once the scores and the tracker are in. The range
 *  switch still moves them in place: Headline is handed every range's
 *  figures and reads ?range= itself (./range-switch.tsx). */
async function HeadlineTiles({ stats }: { stats: ReturnType<typeof getHeadline> }) {
  return <Headline stats={await stats} />;
}

/** Activity once the tracker is in, which it alone waits on: never on the
 *  scores the numbers need. */
async function Activity({
  applied,
  className,
}: {
  applied: ReturnType<typeof getAppliedTimes>;
  className?: string;
}) {
  return <Streak applied={await applied} className={className} />;
}
