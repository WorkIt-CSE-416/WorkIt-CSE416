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
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Fact } from "@/components/ui/fact";

/**
 * The job posting card a seeker sees on their Jobs feed, in the layout it had
 * when the feed showed mock postings: the employer's logo in a tile as tall
 * as the header beside it; a timing badge, the title and the company; a
 * ruled grid of six facts (location, job type, salary, work style,
 * experience level, years required); and a ruled row of actions along the
 * bottom, right-aligned. Moved here from (seeker)/jobs/page.tsx
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
 * not an image. It is 80px wide and stretches to the header's height, so it
 * reads as the same block as the badge, title and company beside it; on a
 * body under 448px (a phone) it narrows to 56px so the title keeps room.
 *
 * TIMING IS THE GREEN BADGE ABOVE THE TITLE, as on the mock cards. It moved
 * into the company line for a while, as quieter text, and the user asked for
 * the mock layout back; recency is what a seeker scans the feed for first,
 * and the badge is where they had learned to find it. A role whose board
 * never dated it gets a grey badge saying so (NOT_LISTED below).
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
 * THE FACTS ARE A RULED GRID, three columns wide (two on a body under 448px),
 * so the salary sits under the salary of the card above and a stack of cards
 * scans as a table. For a while they were a wrapping row, because a scraped
 * role stated only three facts and the grid's columns sat ~300px apart with
 * nothing between them. Now every card states all six, with NOT_LISTED in
 * place of what a board does not give, so the grid fills again. A remote
 * role's absent location is the one fact left out, and its row closes up.
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
 * A FACT CAN BE NOT LISTED, which is not the same as null. Null means the
 * posting has nothing there (a remote role has no office location), and the
 * fact is left out. NOT_LISTED means the posting should say it but its source
 * didn't: a scraped role's board gives no salary, job type or years. The card
 * keeps that fact's glyph in its usual place with "Salary not listed" beside
 * it, in italic, so every live card has the full shape of a stated posting
 * and shows where each value will land once the data exists, rather than
 * shrinking to the three facts a board happens to give. The words say it
 * outright; the italic is only a second cue, so the text stays ink-meta and
 * readable rather than fading under AA.
 *
 * THE ACTIONS ARE A RULED ROW ALONG THE BOTTOM, right-aligned, as on the
 * mock cards, at every width. Beside the title they crushed it when the
 * match rail took a third of the card.
 *
 * `headerAction`, `actions` and `rail` are slots because what surrounds the
 * card differs by audience. A seeker's card carries a Save / Ask WorkIt /
 * Apply row, and the match rail; the composer's preview carries none of that
 * — the role is not live, so there is nothing to save, match against, or
 * apply to yet.
 */
/** A field this posting should state but whose source did not. See "A FACT
 *  CAN BE NOT LISTED" above. A plain object, not a symbol, so it survives
 *  being passed as a prop anywhere a string can. */
export const NOT_LISTED = { notListed: true } as const;
export type NotListed = typeof NOT_LISTED;

function isNotListed(value: unknown): value is NotListed {
  return typeof value === "object" && value !== null && "notListed" in value;
}

/** What each fact is called when it is not listed: "Salary not listed". Short
 *  enough to fit a grid column whole; "Years of experience not listed" was
 *  cut to "Years of experience n…" in the three-column grid, and the
 *  calendar glyph already says which years. */
const FACT_NAME = {
  location: "Location",
  jobType: "Job type",
  salary: "Salary",
  workStyle: "Work style",
  experienceLevel: "Level",
  minYearsExperience: "Years",
} as const;

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
   *  Printed after the company name, not as a fact. NOT_LISTED prints "Post
   *  date not listed", for a scraped role whose board never dated it. */
  timing: string | null | NotListed;
  /** Null omits the fact entirely rather than printing it empty — the rule for
   *  every nullable fact below. A fully remote posting has no location —
   *  `workStyle` already says "Remote", and repeating it under the pin icon
   *  reads as two different facts agreeing by coincidence rather than as one
   *  fact. */
  location: string | null | NotListed;
  /** NOT_LISTED for a scraped role: job boards rarely state salary, job type
   *  or work style, and a guessed "Full-Time" would be a fact no employer
   *  stated, so the card says it is not listed instead. */
  jobType: string | null | NotListed;
  salary: string | null | NotListed;
  workStyle: string | null | NotListed;
  experienceLevel: string | NotListed;
  /** "3+ yrs exp" — null when the role has no minimum (an internship, a new
   *  grad role). */
  minYearsExperience: string | null | NotListed;
};

/** Ink at rest, brand on hover, eased rather than snapped. See the note on
 *  the title and company name. */
const INK_LINK =
  "text-ink hover:text-brand focus-visible:ring-brand-ring rounded-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none";

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
  // Grid order, with a null dropped rather than printed empty; a NOT_LISTED
  // keeps its cell.
  const workStyle = isNotListed(job.workStyle) ? null : job.workStyle;
  const facts = (
    [
      ["location", PinIcon, job.location],
      ["jobType", BriefcaseIcon, job.jobType],
      ["salary", CoinIcon, job.salary],
      ["workStyle", workStyleIcon(workStyle), job.workStyle],
      ["experienceLevel", LevelIcon, job.experienceLevel],
      ["minYearsExperience", CalendarIcon, job.minYearsExperience],
    ] as const
  ).filter(([, , text]) => text != null);

  return (
    <Card as="article" padding="none" className="@container overflow-hidden">
      {/* The rail goes beside the body once the card is 576px wide (its own
          width, so the shell's panel is accounted for), under it below that.
          It was a window breakpoint, md, which put a 208px rail beside the
          body of a 400px card whenever the panel was open. */}
      <div className="flex flex-col @xl:flex-row">
        {/* THE BODY IS ITS OWN CONTAINER, so the grid and the tile break on
            the room the body actually has beside the rail, not the card's. */}
        <div className="@container min-w-0 flex-1 p-4">
          <div className="flex items-start gap-3">
            <CompanyLogo
              name={job.company}
              src={job.logoUrl}
              className="text-heading rounded-card w-14 shrink-0 self-stretch @md:w-20"
            />

            <div className="min-w-0 flex-1">
              {isNotListed(job.timing) ? (
                <Badge variant="status" tone="inert">
                  <span className="italic">Post date not listed</span>
                </Badge>
              ) : (
                job.timing != null && (
                  <Badge variant="status" tone="positive">
                    {job.timing}
                  </Badge>
                )
              )}

              <h3 className="text-title text-ink mt-1.5">
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

          {facts.length > 0 && (
            <div className="border-border-subtle mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-3 @md:grid-cols-3">
              {facts.map(([name, Icon, text]) =>
                isNotListed(text) ? (
                  <Fact key={name} Icon={Icon}>
                    {/* pr-0.5 inside the clipping box: an italic's last
                        letter leans past its own advance, and Fact's
                        truncate clips at the box edge, which shaved the top
                        off the "d" in "listed". */}
                    <span className="pr-0.5 italic">{FACT_NAME[name]} not listed</span>
                  </Fact>
                ) : (
                  <Fact key={name} Icon={Icon}>
                    {text}
                  </Fact>
                ),
              )}
            </div>
          )}

          {actions && (
            <div className="border-border-subtle mt-3 flex flex-wrap items-center justify-end gap-2 border-t pt-3">
              {actions}
            </div>
          )}
        </div>

        {rail}
      </div>
    </Card>
  );
}
