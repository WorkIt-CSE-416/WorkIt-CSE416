import { JobsRailFrame } from "./jobs-rail";
import { getJobFacets, getJobLocations, getJobsView } from "./listings";

/** /jobs and everything under it. Draws the rail of jobs beside a job
 *  posting's page (./jobs-rail.tsx, KAN-297), and in the split view the Jobs
 *  page's header over both (KAN-519), so it starts the filter row's options;
 *  every other page passes through as it was. */
export default async function JobsLayout({ children }: LayoutProps<"/jobs">) {
  const split = (await getJobsView()) === "split";
  return (
    <JobsRailFrame
      filterOptions={split ? { locations: getJobLocations(), facets: getJobFacets() } : undefined}
    >
      {children}
    </JobsRailFrame>
  );
}
