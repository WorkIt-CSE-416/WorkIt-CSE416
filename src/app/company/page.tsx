import type { Metadata } from "next";

import { Avatar } from "@/components/avatar";
import { AwardIcon, BriefcaseIcon, CalendarIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Fact } from "@/components/ui/fact";
import { SectionHeading } from "@/components/ui/section-heading";

import { NEEDS_ATTENTION, PIPELINE, RECENT_APPLICANTS, STATS } from "./data";
import { Pipeline } from "./pipeline";
import { StatTile } from "./stat-tile";

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
 * The order is what a recruiter actually does with the screen: four numbers
 * that say whether anything changed, then the two questions those numbers
 * raise — where is everyone stuck, and what is stuck on me — and only then the
 * feed of who arrived. Recent applicants sit last on purpose: it is the most
 * tempting block and the least actionable, and a dashboard that opens with a
 * feed turns into a place you scroll rather than a place you clear.
 *
 * No <main> here. The shell's SidebarInset is the landmark for every screen
 * under /company; see the note in ./placeholder.tsx.
 */
export default function CompanyHomePage() {
  return (
    <div className="max-w-app mx-auto w-full flex-1 px-6 py-6 sm:px-12">
      <header>
        <h1 className="text-heading text-ink">Hiring Overview</h1>
        <p className="text-body text-ink-meta mt-1">
          What moved across your open roles since you were last here.
        </p>
      </header>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {STATS.map((stat) => (
          <StatTile key={stat.label} {...stat} />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-3 lg:grid-cols-[1fr_1fr]">
        <Card padding="md">
          <SectionHeading
            as="h2"
            action={<ButtonLink href="/company/candidates">View all</ButtonLink>}
          >
            Pipeline
          </SectionHeading>
          <p className="text-note text-ink-meta mt-1">Across all open postings.</p>

          <div className="mt-4">
            <Pipeline stages={PIPELINE} />
          </div>
        </Card>

        <Card padding="md">
          <SectionHeading as="h2">Needs your attention</SectionHeading>
          <p className="text-note text-ink-meta mt-1">Waiting on you, not on the applicant.</p>

          <ul className="mt-4 flex flex-col gap-2.5">
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
      </div>

      <Card padding="md" className="mt-6">
        <SectionHeading as="h2" action={<Button variant="ghost">Review queue</Button>}>
          Recent applicants
        </SectionHeading>

        <ul className="mt-4 flex flex-col">
          {RECENT_APPLICANTS.map(({ id, name, role, hoursAgo, match }) => (
            <li
              key={id}
              className="border-border-subtle flex items-center gap-3 border-b py-3 first:pt-0 last:border-b-0 last:pb-0"
            >
              <Avatar name={name} className="size-8 shrink-0 text-[0.6875rem]" />

              <div className="min-w-0 flex-1">
                <p className="text-label text-ink truncate">{name}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <Fact Icon={BriefcaseIcon}>{role}</Fact>
                  <Fact Icon={CalendarIcon}>{relative(hoursAgo)}</Fact>
                </div>
              </div>

              <Fact Icon={AwardIcon} className="shrink-0">
                {match}% match
              </Fact>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/** Hours are what the fixture carries; days are what a reader wants past one. */
function relative(hoursAgo: number) {
  if (hoursAgo < 1) return "Just now";
  if (hoursAgo < 24) return `${hoursAgo}h ago`;

  const days = Math.round(hoursAgo / 24);

  return days === 1 ? "Yesterday" : `${days}d ago`;
}
