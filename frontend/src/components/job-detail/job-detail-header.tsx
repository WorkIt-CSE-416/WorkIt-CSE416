import Link from "next/link";
import type { ReactNode } from "react";

import { formatPosted } from "@/app/(seeker)/jobs/format";
import { Card } from "@/components/ui/card";

import { ClosesOn } from "./closes-on";
import type { JobPosting } from "./data";
import { JobFacts } from "./job-facts";

type JobDetailHeaderProps = {
  posting: JobPosting;
  /** The small employer mark before the name, sized to sit on one line with
   *  it (32px). A BuildingIcon `CompanyTile` for the company viewing its own
   *  posting; the same initials the feed card draws for a seeker viewing
   *  someone else's, since a job carries no logo of its own. */
  tile: ReactNode;
  /** Omit to render the company name as plain text — a company has nothing
   *  to link to on its own posting. */
  companyHref?: string;
  /** Print when the posting closes, rather than when it went up, whenever it
   *  has a closing date. The seeker page's: a deadline is what a seeker acts
   *  on. The company rail already prints its own dates, so the company page
   *  leaves this off and keeps "Posted …". The day is the viewer's own, set
   *  in the browser by `ClosesOn`, since `closesAt` is a full timestamp. */
  showDeadline?: boolean;
  /** Save, Report, Share and Apply Now on the seeker side; the status badge
   *  and Edit on the company side. */
  actions: ReactNode;
  /** The right rail this job's audience gets: `MatchRail` (`standalone`) for
   *  a seeker, `ApplicantOverviewPanel` for the company managing the
   *  posting, each its own rounded card, sitting beside the facts. Omit it
   *  (a job nothing has scored) and the facts take the full width. */
  rail?: ReactNode;
};

/**
 * The single card atop a job's expanded view: who is hiring, for what,
 * where, how far along it is, its facts, and the score or applicant panel
 * the viewer's audience gets — one box rather than three stacked ones, so
 * the whole top-of-page picture reads at a glance instead of in pieces.
 *
 * The employer line sits small and above the title, the way a job board's
 * card names the company before it names the role — a little mark and a
 * name, not the full-size tile the rest of the app uses to anchor a company.
 * After it, as quiet text and not a pill, comes when the posting went up (or
 * when it closes, with `showDeadline`): the same line, classes and wording
 * as the feed card's `<JobPostingCard>`, since age is a fact about the
 * posting, not a state to flag. Location isn't repeated up here either:
 * `JobFacts` already carries it below, and the point of a small header is
 * not filling it with what the facts row says again.
 *
 * The rule below the title runs the card's full width, and the facts and the
 * rail sit together underneath it — the rail is the facts' neighbour, not the
 * title's, so it starts level with them rather than reaching up beside the
 * company tile. `rail` renders as its own rounded card rather than a rail
 * flush against this one's edge, so the two do not read as one ruled grid.
 *
 * The card is its own `@container` and breaks at `@xl` (576px of card), not
 * at a window breakpoint: the seeker shell's panel takes 256px of the window
 * and the company shell has no `@container/main` to measure. Narrower than
 * that, the actions drop to a full-width row of their own under the title,
 * and the rail stacks under the facts, so neither squeezes the title or the
 * facts into a sliver beside it.
 *
 * `actions` and `rail` are the only things that differ between the company
 * and seeker pages that render this; everything else is shared.
 */
export function JobDetailHeader({
  posting,
  tile,
  companyHref,
  showDeadline = false,
  actions,
  rail,
}: JobDetailHeaderProps) {
  const timing =
    showDeadline && posting.closesAt ? (
      <ClosesOn iso={posting.closesAt} />
    ) : (
      formatPosted(posting.postedAt)
    );

  return (
    <Card as="header" padding="lg" elevated={false} className="@container flex flex-col gap-4">
      <div className="flex flex-col gap-3 @xl:flex-row @xl:items-start @xl:justify-between @xl:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {tile}

            {/* Under 448px of card the timing takes its own line with no dot,
                as on the feed card, rather than wrapping "ago" alone. */}
            <p className="text-label text-ink-meta min-w-0 font-normal">
              {companyHref ? (
                // Ink, not brand: a name that turns brand on hover/focus
                // rather than sitting violet at rest, the same call the feed
                // card's own company name makes.
                <Link
                  href={companyHref}
                  className="text-ink hover:text-brand focus-visible:ring-brand-ring rounded-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                >
                  {posting.companyName}
                </Link>
              ) : (
                <span className="text-ink font-medium">{posting.companyName}</span>
              )}
              <span aria-hidden="true" className="text-ink-faint mx-1.5 @max-md:hidden">
                ·
              </span>
              <span className="whitespace-nowrap @max-md:block">{timing}</span>
            </p>
          </div>

          <h1 className="text-display text-ink mt-2">{posting.title}</h1>
        </div>

        <div className="flex w-full items-center gap-2 @xl:w-auto @xl:shrink-0">{actions}</div>
      </div>

      <div className="border-border-subtle flex flex-col gap-4 border-t pt-4 @xl:flex-row @xl:items-start">
        <div className="min-w-0 flex-1">
          <JobFacts posting={posting} />

          {/* Fills the space the facts leave under themselves when the rail
              beside them is taller — a line about who is hiring, not what
              the role does (that's "About the Role", further down). Capped
              at the same 68ch measure as About the Role, since with no rail
              (an unscored job) it would otherwise run the card's width. */}
          {/* A scraped job has no line about its employer apart from its
              description, so it has none here. */}
          {posting.companyAbout && (
            <p className="text-note text-ink-meta mt-4 max-w-[68ch] leading-5">
              {posting.companyAbout}
            </p>
          )}
        </div>

        {rail}
      </div>
    </Card>
  );
}
