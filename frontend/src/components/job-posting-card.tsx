import Link from "next/link";
import type { ReactNode } from "react";

import { CompanyLogo } from "@/components/company-logo";
import {
  BriefcaseIcon,
  CalendarIcon,
  CoinIcon,
  LevelIcon,
  PinIcon,
  workStyleIcon,
} from "@/components/icons";
import { Card } from "@/components/ui/card";
import { Fact } from "@/components/ui/fact";
import { cn } from "@/lib/cn";

/**
 * The job posting card a seeker sees on their Jobs feed: the employer's logo
 * (or its initials) in a square tile, the title, a company-and-timing line,
 * and a row of up to six facts (location, job type, salary, work style,
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
 * TIMING SITS BESIDE THE COMPANY NAME, NOT IN A BADGE ABOVE THE TITLE. It was
 * a green status badge there, which put a pill on every card in the feed, in
 * the one colour the app keeps for good news, and pushed the title down off
 * the logo's top edge. "Posted 5 days ago" is a fact about the posting rather
 * than a state to flag, so it reads as quiet text after the employer:
 * recency is still the second thing the eye lands on, without competing with
 * the title for the first. On a card under 448px it takes a line of its own
 * with no dot, rather than wrapping and leaving "ago" alone on the next line.
 *
 * EXPERIENCE IS TWO FACTS, NOT ONE. `experienceLevel` and `minYearsExperience`
 * used to print as a single joined string ("Experienced · 8+ yrs") under one
 * icon. Split, level and years get their own icon each rather than asking one
 * glyph to stand for both.
 *
 * EACH GLYPH SAYS WHAT ITS FACT SAYS. Work style picks its icon by value, a
 * building for On-Site, a house for Remote and two arrows for Hybrid, where
 * one desktop screen used to sit beside "On-Site" on most of the feed. The
 * level is a mortarboard, not a prize rosette beside "Internship". The
 * choices live in components/icons.tsx (workStyleIcon, LevelIcon), not here,
 * so the job page can draw the same glyph for the same fact as this card.
 *
 * THE FACTS ARE A WRAPPING ROW UNDER THE TITLE, NOT A FULL-WIDTH GRID. A
 * three-column grid across the whole card kept one fact under another from
 * card to card, but a scraped role states only three, so on a 928px card they
 * sat ~300px apart with nothing between them, below a rule of their own. As
 * a row they sit beside each other under the title they describe, indented
 * to the title's edge rather than the logo's.
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
 * card differs by audience. A seeker's card carries a Save / Ask WorkIt /
 * Apply row, and the match rail; the composer's preview carries none of that
 * — the role is not live, so there is nothing to save, match against, or
 * apply to yet.
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
   *  Printed after the company name, not as a fact. Null drops it: a
   *  scraped role whose board never dated it. */
  timing: string | null;
  /** Null omits the fact entirely rather than printing it empty — the rule for
   *  every nullable fact below. A fully remote posting has no location —
   *  `workStyle` already says "Remote", and repeating it under the pin icon
   *  reads as two different facts agreeing by coincidence rather than as one
   *  fact. */
  location: string | null;
  /** Null for a scraped role: job boards rarely state salary, job type or work
   *  style, and a guessed "Full-Time" would be a fact no employer stated. */
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
      ["workStyle", workStyleIcon(job.workStyle), job.workStyle],
      ["experienceLevel", LevelIcon, job.experienceLevel],
      ["minYearsExperience", CalendarIcon, job.minYearsExperience],
    ] as const
  ).filter(([, , text]) => text != null);

  return (
    <Card
      as="article"
      padding="none"
      className="@container flex flex-col overflow-hidden md:flex-row"
    >
      {/* On a card 672px or wider the actions sit on the header's own row,
          centred against it, instead of a ruled-off row underneath: at that
          width the row was mostly empty space, and it made every card a third
          taller than what it says. Narrower, there is no room beside the
          title, so they drop under a rule again. The card's own width, not
          the window's, because the shell's panel can take 256px of it. */}
      <div className="min-w-0 flex-1 p-4 sm:p-5 @2xl:flex @2xl:items-center @2xl:gap-6">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
          {/* A fixed 48px square, the height of the title and company line
              beside it. It used to stretch to the full height of that block
              at 80px wide, which on a phone took a quarter of the card and
              squeezed the title into a column three words wide. */}
          <CompanyLogo
            name={job.company}
            src={job.logoUrl}
            className="text-label rounded-control size-11 shrink-0 sm:size-12"
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-subtitle text-ink">
                  {job.titleHref ? (
                    <Link href={job.titleHref} className={INK_LINK}>
                      {job.title}
                    </Link>
                  ) : (
                    job.title
                  )}
                </h3>

                <p className="text-label text-ink-meta mt-0.5 font-normal">
                  {job.companyHref ? (
                    <Link href={job.companyHref} className={cn(INK_LINK, "font-medium")}>
                      {job.company}
                    </Link>
                  ) : (
                    <span className="text-ink font-medium">{job.company}</span>
                  )}
                  {job.timing != null && (
                    <>
                      <span aria-hidden="true" className="text-ink-faint mx-1.5 @max-md:hidden">
                        ·
                      </span>
                      <span className="whitespace-nowrap @max-md:block">{job.timing}</span>
                    </>
                  )}
                </p>
              </div>

              {headerAction}
            </div>

            {facts.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {facts.map(([name, Icon, text]) => (
                  <Fact key={name} Icon={Icon}>
                    {text}
                  </Fact>
                ))}
              </div>
            )}
          </div>
        </div>

        {actions && (
          <div className="border-border-subtle mt-4 flex flex-wrap items-center gap-2 border-t pt-3 @2xl:mt-0 @2xl:shrink-0 @2xl:flex-nowrap @2xl:border-t-0 @2xl:pt-0">
            {actions}
          </div>
        )}
      </div>

      {rail}
    </Card>
  );
}
