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
 * the fixture cards around it don't. The fallback is NewMatchesSkeleton below:
 * the same heading and subtitle over placeholder rows, so the column is not a
 * blank hole beside Waiting while the feed loads.
 */
/**
 * THE LIST SCROLLS INSIDE THE ROW rather than setting its height. Beside it,
 * Waiting to hear back is a fixed size, and the two should end on one line;
 * a list long enough to be useful would otherwise stretch the row and leave
 * Waiting floating above a gap. From @4xl/main the section is `h-0
 * min-h-full` — a grid item that contributes no height of its own and then
 * fills whatever the row's other cell made it — and the list takes the rest
 * of that with overflow-y-auto. Stacked on a phone, there is no neighbour to
 * match, so the list does not scroll at all: it shows the first five rows and
 * the page scrolls past them (the fifth drops its divider, which divide-y
 * still draws because hidden rows follow it). A box that scrolls inside a
 * scrolling page traps the swipe that reaches its end, and All jobs is one tap
 * away.
 *
 * Beside Waiting, a fade at the bottom says there is more without a "show
 * more" button, and the list is focusable (tabIndex, a label and a ring) so it
 * scrolls from the keyboard too: a scroll region nothing can focus is
 * unreachable without a mouse. Stacked, titles get two lines instead of one,
 * since the row has the width to itself and a cut title is the part that
 * matters.
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
            className="divide-border-subtle focus-visible:ring-brand-ring flex min-h-0 flex-1 flex-col divide-y rounded-xs focus-visible:ring-2 focus-visible:outline-none @4xl/main:overflow-y-auto @4xl/main:overscroll-contain @4xl/main:pr-2 @4xl/main:pb-6 @max-4xl/main:[&>li:nth-child(5)]:border-b-0 @max-4xl/main:[&>li:nth-child(n+6)]:hidden"
          >
            {latest.map((job) => (
              <li key={job.id} className="flex items-center gap-3 py-2.5">
                <CompanyLogo
                  name={job.company}
                  src={job.logo_url}
                  className="text-note rounded-control size-9 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-label text-ink @max-4xl/main:line-clamp-2 @4xl/main:truncate">
                    {job.title}
                  </p>
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
                  className="text-label text-brand-ink focus-visible:ring-brand-ring relative shrink-0 rounded-xs after:absolute after:-inset-x-1 after:-inset-y-1.5 after:content-[''] hover:underline focus-visible:ring-2 focus-visible:outline-none"
                >
                  Apply
                </a>
              </li>
            ))}
          </ul>
          <span
            aria-hidden="true"
            className="from-background pointer-events-none absolute inset-x-0 bottom-0 hidden h-8 bg-linear-to-t to-transparent @4xl/main:block"
          />
        </div>
      )}
    </section>
  );
}

/**
 * What New matches shows while the feed loads: the same heading, link and
 * subtitle, and the list's place held by pulsing rows in its own shape (a
 * logo square, a title line, a meta line). On a phone the box is h-88, the
 * height of the five rows the loaded list shows there once most titles run to
 * two lines (349px measured at 375px), so Waiting below barely moves when the
 * roles arrive; beside Waiting it fills the row, as the list does.
 */
export function NewMatchesSkeleton() {
  return (
    <section
      aria-labelledby="new-matches"
      aria-busy="true"
      className="flex flex-col @4xl/main:h-0 @4xl/main:min-h-full"
    >
      <SectionHeader
        id="new-matches"
        title="New matches"
        link={{ href: "/jobs", text: "All jobs" }}
      />
      <p className="text-body text-ink-meta mt-1">The latest roles from your feed.</p>

      <ul
        aria-hidden="true"
        className="divide-border-subtle mt-3 flex h-88 flex-col divide-y overflow-hidden @4xl/main:h-auto @4xl/main:flex-1"
      >
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="flex items-center gap-3 py-2.5">
            <span className="bg-well rounded-control size-9 shrink-0 animate-pulse" />
            <span className="flex flex-1 flex-col gap-1.5">
              <span className="bg-well h-3 w-2/3 animate-pulse rounded" />
              <span className="bg-well h-3 w-1/3 animate-pulse rounded" />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
