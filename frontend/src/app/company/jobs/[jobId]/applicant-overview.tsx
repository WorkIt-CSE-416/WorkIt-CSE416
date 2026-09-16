import type { JobPosting } from "@/components/job-detail/data";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format-date";

/**
 * The company-side right rail, filling the seeker page's `MatchRail(standalone)`
 * slot in `JobDetailHeader` — a rounded card of its own, the same width, so
 * the two page variants read as one layout rather than two.
 */
export function ApplicantOverviewPanel({ posting }: { posting: JobPosting }) {
  return (
    <aside
      aria-label="Applicant overview"
      className="bg-well border-border-subtle rounded-card flex shrink-0 flex-col gap-3 border p-4 md:w-52"
    >
      <h2 className="text-title text-ink">Applicants</h2>

      <dl className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between">
          <dt className="text-note text-ink-meta">Total</dt>
          <dd className="text-title text-ink tabular-nums">{posting.applicantCount ?? 0}</dd>
        </div>

        <div className="flex items-baseline justify-between">
          <dt className="text-note text-ink-meta">Unreviewed</dt>
          <dd
            className={cn(
              "text-title tabular-nums",
              (posting.unreviewedCount ?? 0) > 0 ? "text-ink" : "text-ink-faint",
            )}
          >
            {posting.unreviewedCount ?? 0}
          </dd>
        </div>
      </dl>

      <div className="border-border-subtle text-note text-ink-meta flex flex-col gap-1 border-t pt-3">
        <p>Posted {formatDate(posting.postedAt)}</p>
        <p>Updated {formatDate(posting.updatedAt)}</p>
        {posting.closesAt && <p>Closed {formatDate(posting.closesAt)}</p>}
      </div>
    </aside>
  );
}
