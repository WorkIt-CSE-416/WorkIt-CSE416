import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

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
import { cn } from "@/lib/cn";

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
 * THE FACTS ARE TWO FIXED ROWS of three, so a fact sits in the same column
 * on every card and a stack of cards scans as a table:
 *
 *   Location · Job type · Salary            where, what kind of job, its pay
 *   Work style · Level · Start or Years     the rest
 *
 * A fact the posting doesn't give keeps its slot, empty (SLOTS below), so the
 * salary of the card above still sits over this one's and every card is the
 * same height. Salary is in the first row because it is what a seeker scans
 * for next after where (asked for 2026-10-09), though 40% of scraped roles
 * leave its slot empty; level moved down beside the start date it goes with.
 * Job type sits before work style, as Jobright orders them (asked for the
 * same day). On a body under
 * 448px (two columns, a phone) the empty slots close up instead: columns that
 * narrow don't line up across cards anyway, and holes would only waste room.
 * For a while the facts were a wrapping row, because a scraped role stated
 * only three and the grid's columns sat ~300px apart with nothing between
 * them; the fixed slots are what made the grid hold up with gaps in it.
 *
 * THE TITLE IS ONE LINE, trailing off with an ellipsis. Scraped titles run to
 * 113 characters ("… (Bangkok-based, Relocation Provided)"), and a title that
 * wrapped made its card taller than the ones around it (asked for
 * 2026-10-09; it was clamped at two lines before). The whole title is the
 * heading's `title`, so a hover shows it, and a fact cut short by its column
 * shows its whole text the same way. A truncated heading hides its overflow,
 * so a `titleHref` link's focus ring is kept inside it by the heading's
 * padding.
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
 * posting has nothing there (a remote role has no office location).
 * NOT_LISTED means the posting should say it but its source didn't: a scraped
 * role's board gives no salary, job type or years. Both leave the slot empty
 * on screen; a NOT_LISTED one also tells a screen reader ("Salary not
 * listed"), since the gap alone says nothing to one. They used to print
 * "Salary not listed" in italic on screen too, and on 55% of the feed's cards
 * at least one slot did: the gaps read better than a column of apologies.
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

/** What a screen reader hears for a fact that is not listed: "Salary not
 *  listed". */
const FACT_NAME = {
  location: "Location",
  jobType: "Job type",
  salary: "Salary",
  workStyle: "Work style",
  experienceLevel: "Level",
  minYearsExperience: "Years",
  startTerm: "Start date",
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
  /** Null leaves the fact's slot empty, as NOT_LISTED does, but says nothing
   *  to a screen reader either: the rule for every nullable fact below. A
   *  fully remote posting has no location — `workStyle` already says
   *  "Remote", and repeating it under the pin icon reads as two different
   *  facts agreeing by coincidence rather than as one fact. */
  location: string | null | NotListed;
  /** NOT_LISTED for a scraped role with no job type. Where a posting is
   *  silent, the scraper fills Full-Time only for a new-grad role or a summer
   *  internship, which nearly always are (scraper/CLAUDE.md); any other role
   *  stays empty rather than guessed. */
  jobType: string | null | NotListed;
  salary: string | null | NotListed;
  workStyle: string | null | NotListed;
  experienceLevel: string | NotListed;
  /** "3+ yrs exp" — null when the role has no minimum (an internship, a new
   *  grad role). */
  minYearsExperience: string | null | NotListed;
  /** "Start in Summer 2027" — an internship's in place of years, since that is
   *  what a student plans around, in the same slot. Omit for any other role:
   *  given at all, even as null, it takes the slot from `minYearsExperience`. */
  startTerm?: string | null | NotListed;
};

type FactName = keyof typeof FACT_NAME;
type Slot = readonly [FactName, ComponentType<{ className?: string }>, FactValue];
type FactValue = string | null | NotListed;

/** The six slots in reading order, three to a row from 448px of body. See
 *  "THE FACTS ARE TWO FIXED ROWS" above. */
function slotsOf(job: JobPostingCardData): Slot[] {
  const workStyle = isNotListed(job.workStyle) ? null : job.workStyle;
  return [
    ["location", PinIcon, job.location],
    ["jobType", BriefcaseIcon, job.jobType],
    ["salary", CoinIcon, job.salary],
    ["workStyle", workStyleIcon(workStyle), job.workStyle],
    ["experienceLevel", LevelIcon, job.experienceLevel],
    job.startTerm === undefined
      ? ["minYearsExperience", CalendarIcon, job.minYearsExperience]
      : ["startTerm", CalendarIcon, job.startTerm],
  ];
}

/** One slot of the grid. A stated fact is its glyph and value, with the whole
 *  value on hover in case the column cuts it short. An empty one is the same
 *  row drawn invisibly, so it keeps a row's height even when the whole row is
 *  empty, and a NOT_LISTED one names itself to a screen reader. Under 448px
 *  of body the empty slot steps out of the grid (`contents`, its stand-in
 *  hidden; the sr-only text is absolutely placed, so it takes no cell) and
 *  the facts after it close up. */
function FactSlot({ name, Icon, value }: { name: FactName; Icon: Slot[1]; value: FactValue }) {
  if (typeof value === "string") {
    return (
      <Fact Icon={Icon} title={value}>
        {value}
      </Fact>
    );
  }
  return (
    <span className="@max-md:contents">
      <Fact Icon={Icon} className="invisible @max-md:hidden">
        {" "}
      </Fact>
      {isNotListed(value) && <span className="sr-only">{FACT_NAME[name]} not listed</span>}
    </span>
  );
}

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
  return (
    <Card
      as="article"
      padding="none"
      className={cn(
        "@container overflow-hidden",
        // One whole target, so the pointer anywhere on it tints its edge,
        // raises its shadow and turns its title brand. It does not lift, as
        // the Motion rule has whole-target cards do: the feed's heading and
        // filters stick over the list (feed-header.tsx), and a card just
        // under them lifted into them and was cut off.
        job.titleHref &&
          "group/card hover:border-brand/40 hover:shadow-lift ease-glide relative transition-[box-shadow,border-color] duration-200",
      )}
    >
      {/* THE WHOLE CARD OPENS THE ROLE, not only its title. This layer is
          the click target over the card; the title stays the real link that
          a keyboard and a screen reader reach, so this one is hidden from
          both. It is the card's own child rather than the title's stretched
          ::after (the board's way): the body is a size container, which
          contains an absolute ::after inside the body and left the rail
          dead. The title, company and actions sit above it (z-2); the facts
          stay under it, so a click on one opens the role too. */}
      {job.titleHref && (
        <Link
          href={job.titleHref}
          tabIndex={-1}
          aria-hidden="true"
          className="absolute inset-0 z-1"
        />
      )}
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

              {/* p-0.5 inside -m-0.5: room for a link's focus ring, which
                  the clamp's overflow would otherwise cut, at no change of
                  place (mt-1 plus the padding is the 1.5 it was). */}
              <h3
                title={job.title}
                className="text-title text-ink -mx-0.5 mt-1 -mb-0.5 truncate p-0.5"
              >
                {job.titleHref ? (
                  <Link
                    href={job.titleHref}
                    className={cn(INK_LINK, "group-hover/card:text-brand relative z-2")}
                  >
                    {job.title}
                  </Link>
                ) : (
                  job.title
                )}
              </h3>

              <p className="text-note text-ink mt-0.5 font-semibold">
                {job.companyHref ? (
                  <Link href={job.companyHref} className={cn(INK_LINK, "relative z-2")}>
                    {job.company}
                  </Link>
                ) : (
                  job.company
                )}
              </p>
            </div>

            {headerAction}
          </div>

          <div className="border-border-subtle mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-3 @md:grid-cols-3">
            {slotsOf(job).map(([name, Icon, value]) => (
              <FactSlot key={name} name={name} Icon={Icon} value={value} />
            ))}
          </div>

          {actions && (
            <div className="border-border-subtle relative z-2 mt-3 flex flex-wrap items-center justify-end gap-2 border-t pt-3">
              {actions}
            </div>
          )}
        </div>

        {rail}
      </div>
    </Card>
  );
}
