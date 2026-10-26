import { JobsRailFrame } from "./jobs-rail";

/** /jobs and everything under it. Draws the rail of jobs beside a job
 *  posting's page (./jobs-rail.tsx, KAN-297); every other page passes
 *  through as it was. */
export default function JobsLayout({ children }: LayoutProps<"/jobs">) {
  return <JobsRailFrame>{children}</JobsRailFrame>;
}
