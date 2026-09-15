import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CompanyTile, type CompanyTileTone } from "@/components/ui/company-tile";
import { formatRelativeTime } from "@/lib/format-date";

import type { JobPosting } from "./data";
import { JobFacts } from "./job-facts";

/** The dot between the employer and how long ago it was posted —
 *  lifted from the search detail pane, which drew this first. */
function Dot() {
  return <span aria-hidden="true" className="bg-border-strong size-1 shrink-0 rounded-full" />;
}

type JobDetailHeaderProps = {
  posting: JobPosting;
  /** BuildingIcon for the company viewing its own posting; the posting's own
   *  Icon for a seeker viewing someone else's. */
  tileIcon: ComponentType<{ className?: string }>;
  tileTone: CompanyTileTone;
  /** Omit to render the company name as plain text — a company has nothing
   *  to link to on its own posting. */
  companyHref?: string;
  /** Apply Now + Save on the seeker side, Edit on the company side. */
  actions: ReactNode;
  /** The right rail this job's audience gets: `MatchRail` (`standalone`) for
   *  a seeker, `ApplicantOverviewPanel` for the company managing the
   *  posting — each its own rounded card, sitting beside the facts. */
  rail: ReactNode;
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
 * The badge beside it is how long ago the posting went up, the same fact a
 * feed card leads with. Location isn't repeated up here either: `JobFacts`
 * already carries it below, and the point of a small header is not filling
 * it with what the facts row says again.
 *
 * The rule below the title runs the card's full width, and the facts and the
 * rail sit together underneath it — the rail is the facts' neighbour, not the
 * title's, so it starts level with them rather than reaching up beside the
 * company tile. `rail` renders as its own rounded card rather than a rail
 * flush against this one's edge, so the two do not read as one ruled grid.
 *
 * `actions` and `rail` are the only things that differ between the company
 * and seeker pages that render this; everything else is shared.
 */
export function JobDetailHeader({
  posting,
  tileIcon,
  tileTone,
  companyHref,
  actions,
  rail,
}: JobDetailHeaderProps) {
  return (
    <Card as="header" padding="lg" elevated={false} className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CompanyTile Icon={tileIcon} size="sm" tone={tileTone} />

            {companyHref ? (
              // Ink, not brand — a name that turns brand on hover/focus
              // rather than sitting blue at rest, the same call the feed
              // card's own company name makes.
              <Link
                href={companyHref}
                className="text-label text-ink hover:text-brand focus-visible:ring-brand-ring rounded-xs font-semibold focus-visible:ring-2 focus-visible:outline-none"
              >
                {posting.companyName}
              </Link>
            ) : (
              <span className="text-label text-ink font-semibold">{posting.companyName}</span>
            )}
            <Dot />
            <Badge variant="tag">Posted {formatRelativeTime(posting.postedAt)}</Badge>
          </div>

          <h1 className="text-display text-ink mt-2">{posting.title}</h1>
        </div>

        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>

      <div className="border-border-subtle flex flex-col gap-4 border-t pt-4 md:flex-row md:items-start">
        <div className="min-w-0 flex-1">
          <JobFacts posting={posting} />

          {/* Fills the space the facts leave under themselves when the rail
              beside them is taller — a line about who is hiring, not what
              the role does (that's "About the Role", further down). */}
          <p className="text-note text-ink-meta mt-4 leading-5">{posting.companyAbout}</p>
        </div>

        {rail}
      </div>
    </Card>
  );
}
