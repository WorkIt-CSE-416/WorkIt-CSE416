import Link from "next/link";
import type { ReactNode } from "react";

import { CompanyLogo } from "@/components/company-logo";
import {
  AwardIcon,
  BriefcaseIcon,
  CalendarIcon,
  CoinIcon,
  MonitorIcon,
  PinIcon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Fact } from "@/components/ui/fact";
import { cn } from "@/lib/cn";

/**
 * The job posting card a seeker sees on their Jobs feed: the employer's logo
 * (or its initials) in a square tile, a posted/closes badge, title,
 * company name, and a six-fact grid (location, job type, salary, work style,
 * experience level, years required). Moved here from (seeker)/jobs/page.tsx
 * so the company composer's Publish-step preview can show a recruiter the
 * same card a seeker will actually see, rather than a second card that only
 * resembles it.
 *
 * THE TILE IS <CompanyLogo>: the logo the employer uploaded to its job board,
 * falling back to <Avatar> initials when there is none or it fails to load.
 * <Avatar> is circular everywhere else it is used; a company mark reads as a
 * square, so the className override wins — `rounded-card` beats `<Avatar>`'s
 * own `rounded-full` under tailwind-merge's conflict resolution, since both
 * set the same CSS property. Not `<CompanyTile>`: that draws an icon glyph,
 * not an image.
 *
 * THE BADGE ABOVE THE TITLE IS TIMING, NOT ROLE TAGS. An earlier version put
 * role-tag badges there ("Frontend Engineer", "Software Engineer"), but the
 * title already states the role — "Staff Frontend Engineer" restating
 * "Frontend Engineer" above it is the card repeating itself, not adding
 * information. Timing is the thing that slot was missing: it used to live as
 * a seventh grid fact under a calendar icon, buried at the same weight as
 * salary and job type, when "posted 3 hours ago" is closer to a headline than
 * a fact — recency is often what a seeker scans for first. It reads as a badge
 * (`variant="status"`) rather than plain text for the same reason a status
 * chip does anywhere else in the app: it is a small, discrete state, not a
 * sentence.
 *
 * EXPERIENCE IS TWO FACTS, NOT ONE. `experienceLevel` and `minYearsExperience`
 * used to print as a single joined string ("Experienced · 8+ yrs") under one
 * icon. Splitting them back into their own facts is what fills the grid back
 * out to six now that timing moved to the badge above, and gives level and
 * years their own icon each rather than asking one glyph to stand for both.
 *
 * Every field is a pre-formatted string, not a raw `job_postings` value: the
 * seeker feed formats real schema enums (see (seeker)/jobs/format.ts) while the
 * company composer's draft already stores its select fields as the display
 * label itself (see company/jobs/new/data.ts). A shared card that took either
 * raw shape would have to know about both — formatting once at each call site
 * and handing this the strings it prints keeps the card itself audience-blind.
 *
 * THE TITLE AND COMPANY NAME ARE INK, NOT BRAND, turning brand only on
 * hover/focus — the same call RowLink makes for the company table's title
 * cell. A feed where every card's title and employer are the same blue has no
 * contrast left to draw attention with, and a blue company name under a black
 * title reads as a mistake rather than an affordance.
 *
 * `headerAction`, `actions` and `rail` are slots because what surrounds the
 * card differs by audience. A seeker's card carries a more-options menu, a
 * Save / Ask WorkIt / Apply row, and the match rail; the composer's preview
 * carries none of that — the role is not live, so there is nothing to save,
 * match against, or apply to yet.
 */
export type JobPostingCardData = {
  company: string;
  /** The company's logo; omit (or null) for its initials instead. */
  logoUrl?: string | null;
  /** Omit to render the company name in the same ink without a real `<a>`
   *  under it — the composer's preview has nowhere to send a click that
   *  wouldn't abandon the draft being edited. */
  companyHref?: string;
  title: string;
  /** The posting's expanded view. Omit for a plain heading, for the same
   *  reason `companyHref` is optional. */
  titleHref?: string;
  /** "Posted 3 hours ago" — see (seeker)/jobs/format.ts's `formatPosted`.
   *  Printed as a badge above the title, not as a grid fact. Null drops the
   *  badge: a scraped role whose board never dated it. */
  timing: string | null;
  /** Null omits the fact entirely rather than printing it empty — the rule for
   *  every nullable fact below. A fully remote posting has no location —
   *  `workStyle` already says "Remote", and repeating it under the pin icon
   *  reads as two different facts agreeing by coincidence rather than as one
   *  fact. */
  location: string | null;
  /** Null for a scraped role: job boards rarely state salary, job type or work
   *  style, and a guessed "Full-time" would be a fact no employer stated. */
  jobType: string | null;
  salary: string | null;
  workStyle: string | null;
  experienceLevel: string;
  /** "3+ yrs exp" — null when the role has no minimum (an internship, a new
   *  grad role). */
  minYearsExperience: string | null;
};

/** Ink at rest, brand on hover — see the note on the title and company name. */
const INK_LINK =
  "text-ink hover:text-brand focus-visible:ring-brand-ring rounded-xs focus-visible:ring-2 focus-visible:outline-none";

export function JobPostingCard({
  job,
  headerAction,
  actions,
  rail,
}: {
  job: JobPostingCardData;
  headerAction?: ReactNode;
  actions?: ReactNode;
  rail?: ReactNode;
}) {
  // Grid order, with a null dropped rather than printed empty.
  const facts = (
    [
      ["location", PinIcon, job.location],
      ["jobType", BriefcaseIcon, job.jobType],
      ["salary", CoinIcon, job.salary],
      ["workStyle", MonitorIcon, job.workStyle],
      ["experienceLevel", AwardIcon, job.experienceLevel],
      ["minYearsExperience", CalendarIcon, job.minYearsExperience],
    ] as const
  ).filter(([, , text]) => text != null);

  return (
    <Card as="article" padding="none" className="flex flex-col overflow-hidden md:flex-row">
      <div className="min-w-0 flex-1 p-4">
        <div className="flex items-start gap-3">
          {/* self-stretch rather than a fixed size: the tile should read as
              tall as the badge/title/company block beside it, whatever that
              block's height turns out to be (a wrapped title, say), not a
              guessed pixel value that happens to match today's content. Only
              the width is fixed, so there is a cross-axis size for stretch to
              fill. */}
          <CompanyLogo
            name={job.company}
            src={job.logoUrl}
            className="text-heading rounded-card w-20 shrink-0 self-stretch"
          />

          <div className="min-w-0 flex-1">
            {job.timing != null && (
              <Badge variant="status" tone="positive">
                {job.timing}
              </Badge>
            )}

            <h3 className={cn("text-title text-ink", job.timing != null && "mt-1.5")}>
              {job.titleHref ? (
                <Link href={job.titleHref} className={INK_LINK}>
                  {job.title}
                </Link>
              ) : (
                job.title
              )}
            </h3>

            <p className="text-note text-ink mt-0.5 font-semibold">
              {job.companyHref ? (
                <Link href={job.companyHref} className={INK_LINK}>
                  {job.company}
                </Link>
              ) : (
                job.company
              )}
            </p>
          </div>

          {headerAction}
        </div>

        {/* Facts on a grid rather than a wrapping row: fixed columns keep the
            salary under the salary of the card above it, which is what makes
            a stack of these scannable. Timing lives in the badge above the
            title now, not here — see the note on <JobPostingCardData>. */}
        <div className="border-border-subtle mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-3 sm:grid-cols-3">
          {facts.map(([name, Icon, text]) => (
            <Fact key={name} Icon={Icon}>
              {text}
            </Fact>
          ))}
        </div>

        {actions && (
          <div className="border-border-subtle mt-3 flex flex-wrap items-center justify-end gap-2 border-t pt-3">
            {actions}
          </div>
        )}
      </div>

      {rail}
    </Card>
  );
}
