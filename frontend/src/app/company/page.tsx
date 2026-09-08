import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";

import { ApplicantsPreview } from "./applicants-preview";
import { NEEDS_ATTENTION } from "./data";
import { DownloadIcon } from "./icons";
import { StatusRing } from "./status-ring";
import { Rail } from "./rail";
import { StatusByRole } from "./status-by-role";
import { StageAge } from "./stage-age";
import { RangePicker } from "./range-picker";
import { RangeProvider } from "./range";
import { StatsRow } from "./stats-row";
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
 * THE ORDER IS WHAT A RECRUITER DOES WITH THE SCREEN, and each band answers the
 * question the one above it raises:
 *
 *   1  four numbers        did anything change since I was last here
 *   2  intake over time    is the top of the funnel healthy, and what is in it
 *   3  the funnel, twice   where do people stall — on average, and per posting
 *   4  what is stuck       what is waiting on me, and how long things sit
 *   5  who arrived         the feed, last because it is the least actionable
 *
 * The split ratios alternate on purpose — 2:1, then 1:2, then 1:1 — so five
 * bands of cards read as a page with a rhythm rather than as a grid of boxes.
 * Every band's wider half is the one carrying the chart.
 *
 * WHY THERE ARE NO TABS. The layout this was modelled on puts an
 * Overview / Reports / Activities row under the page title. This shell already
 * has that navigation in the sidebar, where it also covers Job Postings and
 * Applicants, and a second row of tabs would be a second answer to "where am
 * I" sitting six pixels from the first.
 *
 * PAIRS OF CARDS THAT LOOK REDUNDANT AND ARE NOT. Band 3 draws the stage split
 * twice on purpose: the ring is the aggregate shape, and the stacked bars are
 * that same shape per posting, which is the comparison an aggregate cannot make
 * — a healthy-looking total is usually one posting stalling. The ring owns the
 * stage totals so the bars beside it need not repeat them. Band 4 pairs three
 * named items with four medians for the same reason: a list cannot show that
 * interviews take twice as long as screens, and a chart of medians cannot tell
 * you whose feedback is missing. Both pairings are argued where the data is
 * defined, in ./data.ts.
 *
 * WHAT THE DATE PICKER GOVERNS. Only the two FLOW blocks: the Applications
 * chart and the New applicants tile. Everything else on the page is a
 * snapshot — open roles, the review queue, which stage each application is in,
 * how long it has waited — and scoping a snapshot to a window produces a
 * confident number that answers no question. Each of those cards says "today"
 * or "right now" in its own subtitle instead of carrying a badge, so the
 * distinction is in the reading rather than in more chrome. The reasoning, and
 * the third category this app cannot serve yet, are in ./range.tsx.
 *
 * EVERY BAND IS items-stretch, so two cards side by side always end on the same
 * line. Left to itself a grid row sizes each cell to its own content, and the
 * shorter card leaves a notch in the page. Stretching moves that leftover
 * INSIDE the card, and each card below then spends it — a list distributes its
 * rows, a chart pins its footnote to the bottom — so the space reads as
 * breathing room rather than as something that failed to load.
 *
 * No <main> here. The shell's SidebarInset is the landmark for every screen
 * under /company; see the note in ./placeholder.tsx.
 */
export default function CompanyHomePage() {
  return (
    /* The provider is a client component wrapping server-rendered children,
     * which is what keeps this page a server component with its own metadata
     * while the range still reaches the three consumers that need it. Only
     * those consumers re-render when the window changes; every snapshot card
     * below was rendered on the server and stays exactly as it was. */
    <RangeProvider>
      <div className="max-w-app mx-auto w-full flex-1 px-6 py-6 sm:px-12">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-heading text-ink">Hiring Overview</h1>
            <p className="text-body text-ink-meta mt-1">
              What moved across your open roles since you were last here.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <RangePicker />

            <Button variant="secondary" size="sm">
              <DownloadIcon className="size-3.5" />
              Export
            </Button>
          </div>
        </header>

        {/* 1 — the headline row. Four current values with no shared unit are a
             KPI row of tiles, not a grouped bar; ./stat-tile.tsx argues it.
             Three are snapshots and one is measured over the selected window,
             which is what ./stats-row.tsx sorts out. */}
        <StatsRow />

        {/* 2 — intake, wide, beside the numbers that do not need a chart. */}
        <div className="mt-6 grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[2fr_1fr]">
          <Card padding="md">
            <Trend />
          </Card>

          <Rail />
        </div>

        {/* 3 — every application by stage, and the same split by posting. */}
        <div className="mt-6 grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[1fr_2fr]">
          <Card padding="md" className="flex flex-col">
            <SectionHeading as="h2">Application Status</SectionHeading>
            <p className="text-note text-ink-meta mt-1">
              Where all of them stand today, across every open posting.
            </p>

            <div className="mt-4 flex flex-1 flex-col">
              <StatusRing />
            </div>
          </Card>

          <Card padding="md" className="flex flex-col">
            <SectionHeading
              as="h2"
              action={<ButtonLink href="/company/applicants">View all</ButtonLink>}
            >
              Status by Role
            </SectionHeading>
            <p className="text-note text-ink-meta mt-1">
              Which stage each posting&rsquo;s applicants are in right now.
            </p>

            <div className="mt-4 flex flex-1 flex-col">
              <StatusByRole />
            </div>
          </Card>
        </div>

        {/* 4 — the two halves of "what is holding this up". */}
        <div className="mt-6 grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2">
          <Card padding="md" className="flex flex-col">
            <SectionHeading as="h2">Needs your attention</SectionHeading>
            <p className="text-note text-ink-meta mt-1">
              Waiting on you today, not on the applicant.
            </p>

            <ul className="mt-4 flex flex-1 flex-col justify-between gap-2.5">
              {NEEDS_ATTENTION.map(({ id, role, need, waitingDays }) => (
                <li
                  key={id}
                  className="border-border-subtle bg-well rounded-control flex items-start gap-3 border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-label text-ink truncate">{role}</p>
                    <p className="text-note text-ink-meta mt-0.5">{need}</p>
                  </div>

                  <Badge variant="status" tone={waitingDays >= 4 ? "brand" : "neutral"}>
                    {waitingDays}d
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>

          <Card padding="md" className="flex flex-col">
            <SectionHeading as="h2">Time in stage</SectionHeading>
            <p className="text-note text-ink-meta mt-1">
              How long they have been sitting there, as of today.
            </p>

            <div className="mt-4 flex flex-1 flex-col">
              <StageAge />
            </div>
          </Card>
        </div>

        {/* 5 — the feed. */}
        <Card padding="md" className="mt-6">
          <SectionHeading
            as="h2"
            action={<ButtonLink href="/company/applicants">Review queue</ButtonLink>}
          >
            Recent applicants
          </SectionHeading>

          <ApplicantsPreview />
        </Card>
      </div>
    </RangeProvider>
  );
}
