import Link from "next/link";

import { CompanyLogo } from "@/components/company-logo";
import { MatchBadge } from "@/components/match-badge";
import { Badge } from "@/components/ui/badge";
import { jobLogo } from "@/lib/job-logo";
import { cn } from "@/lib/cn";

import type { ApplicationStage } from "../auto-apply/actions";
import { formatPostedShort } from "./format";
import { listingFacts } from "./listing-card";
import type { JobListing } from "./listings";
import { NotInterestedButton } from "./not-interested-button";
import { SaveJobButton } from "./save-job-button";

/** The facts a posting states, with nothing marked for the rest. */
function stated(...facts: unknown[]): string[] {
  return facts.filter((fact): fact is string => typeof fact === "string");
}

/**
 * One role as a compact card (KAN-519, after Simplify's list), in the rail
 * beside a job's page, the split view and /search's list. The title and the
 * company sit beside Not Interested, Save and the match, and where it is, its
 * pay, type and age run under them on the card's whole width: beside the buttons
 * every line wrapped (2026-11-02). Each of those is one line, cut short with its
 * whole text in a tooltip. Ink says what a student scans for (the company and the
 * pay) and grey the rest. Its list draws its edge: in the split view each row is
 * its own card edged in `border-control`, the open one in brand (jobs-rail.tsx,
 * 2026-11-03); elsewhere rows are split by a hairline. The open job is the whole
 * row tinted. A fact the posting does not state
 * closes up, where the large card keeps its empty slot.
 *
 * The score stays, since it is what a student scans the list for. Tailor, Auto
 * Apply, Ask Scout and Apply Now sit on the open job.
 *
 * The title is the link, and its `after` layer takes a click anywhere on the
 * card, as the large card's does; the buttons sit above that layer, since a
 * button inside a link is invalid. The tint marks the open job, from `@4xl/main`,
 * where the job can sit beside the list.
 */
export function CompactJobCard({
  job,
  stage,
  current = false,
}: {
  job: JobListing;
  stage: ApplicationStage | null;
  current?: boolean;
}) {
  const facts = listingFacts(job);
  const place = stated(facts.location, facts.workStyle).join(" · ");
  const [pay] = stated(facts.salary);
  const [type] = stated(facts.jobType);

  return (
    <article
      data-current={current || undefined}
      className={cn(
        "hover:bg-hover relative grid grid-cols-[3rem_minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-4 py-4 transition-colors",
        current && "@4xl/main:bg-brand-tint",
      )}
    >
      <CompanyLogo
        name={job.company}
        src={jobLogo(job)}
        className="text-label rounded-control size-12"
      />
      <div className="min-w-0">
        <h3 className="text-subtitle text-ink line-clamp-2">
          <Link
            href={`/jobs/${encodeURIComponent(job.id)}`}
            title={job.title}
            aria-current={current ? "page" : undefined}
            className="focus-visible:ring-brand-ring rounded-control after:absolute after:inset-0 focus-visible:ring-2 focus-visible:outline-none"
          >
            {job.title}
          </Link>
        </h3>
        <p title={job.company} className="text-label text-ink mt-0.5 truncate">
          {job.company}
        </p>
      </div>
      <div className="relative z-2 flex flex-col items-end gap-2">
        <div className="flex gap-3">
          <NotInterestedButton title={job.title} quiet />
          <SaveJobButton jobId={job.id} title={job.title} stage={stage} quiet />
        </div>
        {job.match != null && <MatchBadge score={job.match} />}
      </div>
      {/* Under the logo and the buttons too, so these two lines take the card's
          whole width, each on one line. */}
      <div className="col-span-full min-w-0">
        <p title={place} className="text-label text-ink-muted truncate font-normal">
          {place}
        </p>
        <div className="text-label mt-1 flex items-center justify-between gap-3 font-normal">
          <p className="text-ink-muted min-w-0 truncate">
            {pay && <span className="text-ink font-medium">{pay}</span>}
            {pay && type && " · "}
            {type}
          </p>
          {/* The clock moves between the server render and hydration. */}
          {job.posted_at && (
            <span className="flex shrink-0">
              <Badge variant="status" tone="positive">
                <span suppressHydrationWarning>{formatPostedShort(job.posted_at)}</span>
              </Badge>
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
