import type { Sort } from "./filter-query";
import type { JobsView } from "./view";
import { ViewSwitch } from "./view-switch";

/** The Jobs page's heading, with its view at the right end. Drawn by the page
 *  for the large cards and by the split frame for the split view
 *  (./jobs-rail.tsx). */
export function JobsHeading({ sort, view }: { sort: Sort; view: JobsView }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div>
        <h1 className="text-heading text-ink">Jobs</h1>
        <p className="text-body text-ink-meta mt-1">
          {sort === "match"
            ? "Roles that fit your preferences, ranked against your experience."
            : "Every open role in the feed, newest first."}
        </p>
      </div>
      <ViewSwitch view={view} />
    </div>
  );
}
