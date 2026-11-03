import { JobSearch } from "../search/job-search";
import type { JobsView } from "./view";
import { ViewSwitch } from "./view-switch";

/** The row over the Jobs page's filters: the job search, with the view at the
 *  right end. Drawn by the page for the large cards and by the split frame for
 *  the split view (./jobs-rail.tsx). The page's title is in the top bar. */
export function JobsTopRow({ view }: { view: JobsView }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <JobSearch />
      <ViewSwitch view={view} />
    </div>
  );
}
