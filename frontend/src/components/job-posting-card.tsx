import type { ReactNode } from "react";

import { Avatar } from "@/components/avatar";
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
import { TextLink } from "@/components/ui/text-link";

/**
 * The job posting card a seeker sees on their Jobs feed: a square initials
 * tile standing in for the employer's logo, a posted/closes badge, title,
 * company name, and a six-fact grid (location, job type, salary, work style,
 * experience level, years required). Moved here from (seeker)/jobs/page.tsx
 * so the company composer's Publish-step preview can show a recruiter the
 * same card a seeker will actually see, rather than a second card that only
 * resembles it.
 *
 * THE TILE IS <Avatar> RESHAPED, NOT A SEPARATE COMPONENT. <Avatar> is built
 * for people (profile photos, account menus) and is circular everywhere else
 * it is used; a company mark reads as a square the way `<CompanyTile>` draws
 * it elsewhere in the app. Rather than fork a second initials component for
 * one shape difference, the className override wins — `rounded-card` beats
 * `<Avatar>`'s own `rounded-full` under tailwind-merge's conflict resolution,
 * since both set the same CSS property. Reach for `<CompanyTile>` instead once
 * this card has a real per-company logo to draw rather than initials.
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
 * `headerAction`, `actions` and `rail` are slots because what surrounds the
 * card differs by audience. A seeker's card carries a more-options menu, a
 * Save / Ask WorkIt / Apply row, and the match rail; the composer's preview
 * carries none of that — the role is not live, so there is nothing to save,
 * match against, or apply to yet.
 */
export type JobPostingCardData = {
  company: string;
  /** Omit to render the company name in the same brand colour without a real
   *  `<a>` under it — the composer's preview has nowhere to send a click that
   *  wouldn't abandon the draft being edited. */
  companyHref?: string;
  title: string;
  /** "Posted 3 hours ago" or "Closes Sep 29, 2026" — see (seeker)/jobs/format.ts's
   *  `formatTiming`. Printed as a badge above the title, not as a grid fact. */
  timing: string;
  /** Null omits the fact entirely rather than printing it empty. A fully
   *  remote posting has no location — `workStyle` already says "Remote", and
   *  repeating it under the pin icon reads as two different facts agreeing by
   *  coincidence rather than as one fact. */
  location: string | null;
  jobType: string;
  salary: string;
  workStyle: string;
  experienceLevel: string;
  /** "3+ yrs exp" — null when the role has no minimum (an internship, a new
   *  grad role), which omits the fact rather than printing an empty one. */
  minYearsExperience: string | null;
};

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
          <Avatar
            name={job.company}
            className="text-heading rounded-card w-20 shrink-0 self-stretch"
          />

          <div className="min-w-0 flex-1">
            <Badge variant="status" tone="positive">
              {job.timing}
            </Badge>

            <h3 className="text-title text-ink mt-1.5">{job.title}</h3>

            <p className="text-note mt-0.5">
              {job.companyHref ? (
                <TextLink href={job.companyHref} className="font-semibold">
                  {job.company}
                </TextLink>
              ) : (
                <span className="text-brand font-semibold">{job.company}</span>
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
          {job.location != null && <Fact Icon={PinIcon}>{job.location}</Fact>}
          <Fact Icon={BriefcaseIcon}>{job.jobType}</Fact>
          <Fact Icon={CoinIcon}>{job.salary}</Fact>
          <Fact Icon={MonitorIcon}>{job.workStyle}</Fact>
          <Fact Icon={AwardIcon}>{job.experienceLevel}</Fact>
          {job.minYearsExperience != null && (
            <Fact Icon={CalendarIcon}>{job.minYearsExperience}</Fact>
          )}
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
