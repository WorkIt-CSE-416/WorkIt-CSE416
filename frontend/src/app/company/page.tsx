import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { SectionLink } from "@/components/ui/section-link";

import { ApplicantsPreview } from "./applicants-preview";
import { AttentionHero, NeedsAttention } from "./attention";
import { NEEDS_ATTENTION } from "./data";
import { COMPANY_PAGE } from "./frame";
import { DownloadIcon } from "./icons";
import { Rail } from "./rail";
import { RangePicker } from "./range-picker";
import { RangeProvider } from "./range";
import { StageAge } from "./stage-age";
import { StatsRow } from "./stats-row";
import { StatusByRole } from "./status-by-role";
import { StatusRing } from "./status-ring";
import { Trend } from "./trend";

export const metadata: Metadata = {
  title: "Hiring Overview",
  description: "Hiring activity across every open role.",
};

/**
 * The landing screen for a signed-in company, at /company.
 *
 * It exists as its own page rather than redirecting to /company/jobs because
 * the bar's logo has to point somewhere, and a redirect would make the two
 * shells behave differently for the same click.
 *
 * ---------------------------------------------------------------------------
 * ONE PRODUCT WITH THE SEEKER HOME. This page was eleven identical white
 * cards, four of them numbers, and a page of equal boxes has no first place to
 * look. It now follows the seeker shell (KAN-582): its title is in the bar,
 * and every section is a white card on the grey ground, as on Home:
 *
 *   the numbers      one card, the stat tiles' plain variant, with the date
 *                    picker and Export at its top right
 *   Most Urgent      the one solid colour: the longest wait on the company,
 *                    on a violet card where the eye lands first
 *   section cards    the chart, the highlights, the pipeline, the rest of what
 *                    is waiting and the stage ages, each under a plain heading
 *                    with a short link at the top right where it has one
 *   the table        the applicants table, its heading on the ground over its
 *                    own white card, as the Job Postings and Applicants
 *                    tables are
 *
 * It was open sections on white with a grey band for the pipeline until
 * KAN-582, the reverse of the seeker's grey ground and white cards. No card
 * nests a bordered box inside another.
 *
 * THE ORDER IS WHAT A RECRUITER DOES WITH THE SCREEN, and each row answers the
 * question the one above it raises:
 *
 *   1  numbers and hero    did anything change, and what do I do first
 *   2  intake over time    is the top of the funnel healthy
 *   3  the pipeline        where do people stall: overall, and per posting
 *   4  what is stuck       what else is waiting on me, and how long things sit
 *   5  who arrived         the feed, last because it is the least actionable
 *
 * Every row splits at the seeker Dashboard's 3:2, the wider half carrying the
 * chart or the list, and breaks on @container/main, the page's own width,
 * since the panel takes 256px of the window when open. Inside the pipeline the
 * two charts split evenly, from 960px of page, the width at which each half
 * holds the ring beside its legend.
 *
 * WHY THERE ARE NO TABS. The layout this was modelled on puts an
 * Overview / Reports / Activities row under the page title. This shell already
 * has that navigation in the sidebar, where it also covers Job Postings and
 * Applicants, and a second row of tabs would be a second answer to "where am
 * I" sitting six pixels from the first.
 *
 * PAIRS THAT LOOK REDUNDANT AND ARE NOT. The pipeline draws the stage split twice
 * on purpose: the ring is the aggregate shape, and the stacked bars are that
 * same shape per posting, which is the comparison an aggregate cannot make,
 * since a healthy-looking total is usually one posting stalling. The ring owns the
 * stage totals so the bars beside it need not repeat them. Row 4 pairs named
 * items with four medians for the same reason: a list cannot show that
 * interviews take twice as long as screens, and a chart of medians cannot tell
 * you whose feedback is missing. Both pairings are argued where the data is
 * defined, in ./data.ts.
 *
 * WHAT THE DATE PICKER GOVERNS. Only the two FLOW blocks: the Applications
 * chart and the New Applicants tile. Everything else on the page is a
 * snapshot — open roles, the review queue, which stage each application is in,
 * how long it has waited — and scoping a snapshot to a window produces a
 * confident number that answers no question. Each of those sections says
 * "today" or "right now" in its own subtitle instead of carrying a badge, so
 * the distinction is in the reading rather than in more chrome. The reasoning,
 * and the third category this app cannot serve yet, are in ./range.tsx.
 *
 * NOTHING MOVES WHEN THE WINDOW DOES. The picker's button is one width for
 * every window, the tiles always draw the line under their number, and the
 * chart's summary is a row of chips rather than a sentence that wraps
 * differently per range.
 *
 * No <main> here, and no h1: the shell's SidebarInset is the landmark for
 * every screen under /company, and the bar's title is this page's h1
 * (./bar-title.tsx).
 */
export default function CompanyHomePage() {
  /* The longest wait goes on the hero; the list below carries the rest. Sorted
   * here rather than trusted from the fixture's order, so a real queue in any
   * order still puts its oldest item first. */
  const [first, ...rest] = [...NEEDS_ATTENTION].sort((a, b) => b.waitingDays - a.waitingDays);

  return (
    /* The provider is a client component wrapping server-rendered children,
     * which is what keeps this page a server component with its own metadata
     * while the range still reaches the three consumers that need it. Only
     * those consumers re-render when the window changes; every snapshot
     * section below was rendered on the server and stays exactly as it was. */
    <RangeProvider>
      <div className={COMPANY_PAGE}>
        {/* 1. The numbers, with the hero beside them. */}
        <div className="grid grid-cols-1 items-stretch gap-5 @4xl/main:grid-cols-[3fr_2fr]">
          <Card
            as="section"
            padding="lg"
            aria-label="Hiring Numbers"
            className="@container/kpis flex flex-col"
          >
            <div className="flex justify-end gap-2">
              <RangePicker />

              <Button variant="secondary" size="sm">
                <DownloadIcon className="size-3.5" />
                Export
              </Button>
            </div>

            {/* Four current values with no shared unit are a KPI row, not a
                grouped bar; components/stat-tile.tsx argues it. Three are
                snapshots and one is measured over the selected window, which
                is what ./stats-row.tsx sorts out. */}
            <StatsRow />
          </Card>

          <AttentionHero item={first} />
        </div>

        {/* 2. Intake, wide, beside the numbers that do not need a chart. */}
        <div className="mt-5 grid grid-cols-1 gap-5 @4xl/main:grid-cols-[3fr_2fr]">
          <Card padding="lg">
            <Trend />
          </Card>
          <Card padding="lg">
            <Rail />
          </Card>
        </div>

        {/* 3. Every application by stage, and the same split by posting, in
             one card. The two halves sit straight in it, not in cards of
             their own, and split evenly from 960px of page rather than at the
             rows' 896px: (960 - 64 page padding - 40 card padding - 40 gap) /
             2 is 408px a half, past the 384px at which the ring lays its
             legend beside itself. Split any earlier and the ring stacks over
             its legend in half a card, which stretches both halves and
             spreads the role bars apart. */}
        <Card as="section" padding="lg" aria-labelledby="pipeline" className="mt-5">
          <SectionHeading
            id="pipeline"
            action={
              <SectionLink href="/company/applicants" label="View All Applicants">
                View All
              </SectionLink>
            }
          >
            Hiring Pipeline
          </SectionHeading>
          <p className="text-body text-ink-meta mt-1">
            Where every application on an open posting stands today.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-x-10 gap-y-8 @min-[60rem]/main:grid-cols-2">
            <div className="flex flex-col">
              <h3 className="text-subtitle text-ink">Application Status</h3>
              <p className="text-note text-ink-meta mt-0.5">All of them, by current stage.</p>

              <div className="mt-4 flex flex-1 flex-col">
                <StatusRing />
              </div>
            </div>

            <div className="flex flex-col">
              <h3 className="text-subtitle text-ink">Status by Role</h3>
              <p className="text-note text-ink-meta mt-0.5">
                Which stage each posting&rsquo;s applicants are in right now.
              </p>

              <div className="mt-4 flex flex-1 flex-col">
                <StatusByRole />
              </div>
            </div>
          </div>
        </Card>

        {/* 4. The two halves of "what is holding this up". */}
        <div className="mt-5 grid grid-cols-1 gap-5 @4xl/main:grid-cols-[3fr_2fr]">
          <Card padding="lg">
            <NeedsAttention items={rest} />
          </Card>

          <Card as="section" padding="lg" aria-labelledby="time-in-stage" className="flex flex-col">
            <SectionHeading id="time-in-stage">Time in Stage</SectionHeading>
            <p className="text-body text-ink-meta mt-1">How long they have waited, as of today.</p>

            <div className="mt-4 flex flex-1 flex-col">
              <StageAge />
            </div>
          </Card>
        </div>

        {/* 5. The feed: its heading on the ground, the table in its card. */}
        <section aria-labelledby="recent-applicants" className="mt-8">
          <SectionHeading
            id="recent-applicants"
            action={
              <SectionLink href="/company/applicants" label="View All Applicants">
                View All
              </SectionLink>
            }
          >
            Recent Applicants
          </SectionHeading>
          <p className="text-body text-ink-meta mt-1">
            The newest arrivals across your open roles.
          </p>

          <ApplicantsPreview />
        </section>
      </div>
    </RangeProvider>
  );
}
