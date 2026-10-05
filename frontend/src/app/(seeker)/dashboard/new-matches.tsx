import { CompanyLogo } from "@/components/company-logo";

import { formatPosted } from "../jobs/format";
import { getJobListings } from "../jobs/listings";
import { SectionHeader } from "./section-header";

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
/**
 * THE LIST SCROLLS INSIDE THE ROW rather than setting its height. Beside it,
 * Waiting to hear back is a fixed size, and the two should end on one line;
 * a list long enough to be useful would otherwise stretch the row and leave
 * Waiting floating above a gap. From @4xl/main the section is `h-0
 * min-h-full` — a grid item that contributes no height of its own and then
 * fills whatever the row's other cell made it — and the list takes the rest
 * of that with overflow-y-auto. Stacked on a phone, there is no neighbour to
 * match, so the list caps at max-h-96 instead.
 *
 * A fade at the bottom says there is more without a "show more" button, and
 * the list is focusable (tabIndex, a label and a ring) so it scrolls from the
 * keyboard too — a scroll region nothing can focus is unreachable without a
 * mouse.
 */
const SHOWN = 12;

export async function NewMatches() {
  const { jobs, error } = await getJobListings();
  const latest = (jobs ?? []).slice(0, SHOWN);

  return (
    <section
      aria-labelledby="new-matches"
      className="flex flex-col @4xl/main:h-0 @4xl/main:min-h-full"
    >
      <SectionHeader
        id="new-matches"
        title="New matches"
        link={{ href: "/jobs", text: "All jobs" }}
      />
      <p className="text-body text-ink-meta mt-1">The latest roles from your feed.</p>

      {error != null || latest.length === 0 ? (
        <p className="text-body text-ink-meta mt-4">
          {error != null
            ? "New roles aren't loading right now. Check back in a few minutes."
            : "No new roles yet. They land here as companies post them."}
        </p>
      ) : (
        <div className="relative mt-3 flex min-h-0 flex-1 flex-col">
          <ul
            tabIndex={0}
            aria-label="Latest roles"
            className="divide-border-subtle focus-visible:ring-brand-ring flex max-h-96 min-h-0 flex-1 flex-col divide-y overflow-y-auto overscroll-contain rounded-xs pr-2 pb-6 focus-visible:ring-2 focus-visible:outline-none @4xl/main:max-h-none"
          >
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
          <span
            aria-hidden="true"
            className="from-background pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t to-transparent"
          />
        </div>
      )}
    </section>
  );
}
