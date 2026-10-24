import { CloudSlashIcon } from "@phosphor-icons/react/ssr";
import { LightningRoundedIcon } from "@/components/custom-icons";
import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { RememberFeed } from "../jobs/[jobId]/page-actions";
import { activityOf } from "./activity-list";
import { getRunApplications } from "./applications";
import { AutoApplyPanel } from "./auto-apply-panel";
import { LiveActivity } from "./live-activity";

export const metadata: Metadata = {
  title: "Auto Apply",
  description: "Apply to the jobs that match you, with your resume filled in for you.",
};

/**
 * /auto-apply — where the seeker sets up applying in bulk (KAN-223). The
 * pipeline it grows into is `auto-apply/architecture.md` at the repo root:
 * match, pick the resume, fill the form with the extension, record.
 *
 * The heading block every seeker screen uses, with Start Auto Apply at its
 * top right (./auto-apply-panel.tsx, KAN-285), then two sections:
 *
 *   Resume List            every resume, since each application gets its
 *                          own pick, as a table (./resume-list.tsx)
 *   Live Activity          the seeker's applications from the API
 *                          (./applications.ts), with their match scores,
 *                          as a table filtered by status and sorted from
 *                          the URL (./live-activity.tsx, ./query.ts); queue
 *                          order by default (oldest first, the API's list
 *                          reversed): each job posting queued with a batch
 *                          or a job's Auto Apply button, and where it stands
 *                          (./activity-list.tsx)
 *
 * The rows are read here, on the server, and passed through the client
 * panel; a batch refreshes the route to redraw them.
 * A failed read says so, never a fixture (backend/CLAUDE.md). A <div>, since
 * SidebarInset is already the <main>.
 */
export default async function AutoApplyPage() {
  const { applications, error } = await getRunApplications();

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      {/* So a queued job's page goes back here, not to the feed. */}
      <RememberFeed />
      <AutoApplyPanel>
        {error != null ? (
          <EmptyState
            Icon={CloudSlashIcon}
            title="Live Activity Isn't Loading"
            className="mt-3"
            detail={process.env.NODE_ENV === "development" ? error : undefined}
          >
            We couldn&apos;t reach your applications. Refresh the page in a few minutes.
          </EmptyState>
        ) : applications.length === 0 ? (
          <EmptyState Icon={LightningRoundedIcon} title="Nothing Queued Yet" className="mt-3">
            Start Auto Apply to queue your best matches, or click Auto Apply on any job.
          </EmptyState>
        ) : (
          // Queue order, oldest first: the API answers newest first, but the
          // job the extension opens next belongs at the top and a newly
          // queued one joins at the bottom. The table's default sort keeps
          // it (./query.ts, `queue`).
          <LiveActivity items={[...applications].reverse().map(activityOf)} />
        )}
      </AutoApplyPanel>
    </div>
  );
}
