import Link from "next/link";

import { CompanyLogo } from "@/components/company-logo";
import { ArrowRightIcon } from "@/components/icons";

import { formatPosted } from "../jobs/format";
import { getJobListings } from "../jobs/listings";

/**
 * The newest roles from the live feed — the one Dashboard card that is real
 * today. "Matches" is the feed's own word for what it shows (Recommended for
 * You); there is no scoring yet, so the order is newest first.
 *
 * Open on the page, like the other lists. A compact list rather than the Jobs
 * page's cards: this is a glance at what
 * arrived, with Jobs one click away for the full card and its actions. Apply
 * goes straight to the employer's posting, as it does there.
 *
 * Its own <Suspense> boundary in the page, because it waits on the API and
 * the fixture cards around it don't.
 */
const SHOWN = 5;

export async function NewMatches() {
  const { jobs, error } = await getJobListings();
  const latest = (jobs ?? []).slice(0, SHOWN);

  return (
    <section aria-labelledby="new-matches">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="new-matches" className="text-title text-ink">
          New matches
        </h2>
        <Link
          href="/jobs"
          className="text-label text-ink-muted hover:text-ink focus-visible:ring-brand-ring inline-flex items-center gap-1 rounded-xs focus-visible:ring-2 focus-visible:outline-none"
        >
          All jobs
          <ArrowRightIcon className="size-3.5" />
        </Link>
      </div>
      <p className="text-body text-ink-meta mt-1">The latest roles from your feed.</p>

      {error != null || latest.length === 0 ? (
        <p className="text-body text-ink-meta mt-4">
          {error != null
            ? "New roles aren't loading right now. Check back in a few minutes."
            : "No new roles yet. They land here as companies post them."}
        </p>
      ) : (
        <ul className="divide-border-subtle mt-3 flex flex-col divide-y">
          {latest.map((job) => (
            <li key={job.id} className="flex items-center gap-3 py-2.5">
              <CompanyLogo
                name={job.company}
                src={job.logo_url}
                className="text-note rounded-control size-9 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-label text-ink truncate">{job.title}</p>
                <p className="text-note text-ink-meta truncate">
                  {job.company}
                  {job.posted_at && ` · ${formatPosted(job.posted_at)}`}
                </p>
              </div>
              <a
                href={job.apply_url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Apply to ${job.title} at ${job.company}`}
                className="text-label text-brand-ink focus-visible:ring-brand-ring shrink-0 rounded-xs hover:underline focus-visible:ring-2 focus-visible:outline-none"
              >
                Apply
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
