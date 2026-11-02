import Link from "next/link";

import { CompanyLogo } from "@/components/company-logo";
import { MatchBadge } from "@/components/match-badge";
import { jobLogo } from "@/lib/job-logo";
import { cn } from "@/lib/cn";

import type { ApplicationStage } from "../auto-apply/actions";
import { formatPosted } from "./format";
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
 * beside a job's page, the split view and /search's list: the title first, then
 * the company, where and how it works, then its pay, type and age, with Not
 * Interested and Save at the top right as bare glyphs and its match under them.
 * Rows are split by a hairline by their list, not boxed, and the open job is the
 * whole row tinted. A fact the posting does not state closes up, where the large
 * card keeps its empty slot. Long titles and places wrap rather than cut off
 * mid-word: the two buttons narrow the text, and a cut line said little.
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

  return (
    <article
      data-current={current || undefined}
      className={cn(
        "hover:bg-hover relative grid grid-cols-[2.75rem_minmax(0,1fr)_auto] gap-3 px-4 py-4 transition-colors",
        current && "@4xl/main:bg-brand-tint",
      )}
    >
      <CompanyLogo
        name={job.company}
        src={jobLogo(job)}
        className="text-label rounded-control size-11"
      />
      <div className="min-w-0">
        <h3 className="text-body text-ink line-clamp-3 font-medium">
          <Link
            href={`/jobs/${encodeURIComponent(job.id)}`}
            title={job.title}
            aria-current={current ? "page" : undefined}
            className="focus-visible:ring-brand-ring rounded-control after:absolute after:inset-0 focus-visible:ring-2 focus-visible:outline-none"
          >
            {job.title}
          </Link>
        </h3>
        <p className="text-note text-ink-muted mt-1 truncate">{job.company}</p>
        <p className="text-note text-ink-muted mt-1 line-clamp-2">
          {stated(facts.location, facts.workStyle).join(" · ")}
        </p>
        <p className="text-note text-ink-meta mt-1 line-clamp-2">
          {stated(facts.salary, facts.jobType).join(" · ")}
          {/* The clock moves between the server render and hydration. */}
          {job.posted_at && (
            <span suppressHydrationWarning>
              {stated(facts.salary, facts.jobType).length > 0 && " · "}
              {formatPosted(job.posted_at)}
            </span>
          )}
        </p>
      </div>
      <div className="relative z-2 flex flex-col items-end gap-2">
        <div className="flex gap-3">
          <NotInterestedButton title={job.title} quiet />
          <SaveJobButton jobId={job.id} title={job.title} stage={stage} quiet />
        </div>
        {job.match != null && <MatchBadge score={job.match} />}
      </div>
    </article>
  );
}
