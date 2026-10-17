import { CloudOff, Zap } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { RememberFeed } from "../jobs/[jobId]/page-actions";
import { ActivityList, activityOf } from "./activity-list";
import { getApplications } from "./applications";
import { AutoApplyPanel } from "./auto-apply-panel";

export const metadata: Metadata = {
  title: "Auto Apply",
  description: "Apply to the jobs that match you, with your resume filled in for you.",
};

/**
 * /auto-apply — where the seeker sets up applying in bulk (KAN-223). The
 * pipeline it grows into is `auto-apply/architecture.md` at the repo root:
 * match, pick the resume, fill the form with the extension, record.
 *
 * Two sections, under the heading block every seeker screen uses:
 *
 *   Resume List            every resume, since each application gets its
 *                          own pick, and Start Auto Apply beside it, which
 *                          queues a batch of matches
 *                          (./resume-list.tsx, ./auto-apply-panel.tsx)
 *   Live Activity          the seeker's applications from the API
 *                          (./applications.ts), newest first: each job
 *                          posting queued with a batch or a job's Auto Apply
 *                          button, and where it stands (./activity-list.tsx)
 *
 * The list is drawn here, on the server, against the request's clock, and
 * passed through the client panel; a batch refreshes the route to redraw it.
 * A failed read says so, never a fixture (backend/CLAUDE.md). A <div>, since
 * SidebarInset is already the <main>.
 */
export default async function AutoApplyPage() {
  const now = new Date();
  const { applications, error } = await getApplications();

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      {/* So a queued job's page goes back here, not to the feed. */}
      <RememberFeed />
      <h1 className="text-heading text-ink">Auto Apply</h1>
      <p className="text-body text-ink-meta mt-1">
        Apply to the jobs that match you, with your resume filled in for you.
      </p>

      <AutoApplyPanel>
        {error != null ? (
          <EmptyState
            Icon={CloudOff}
            title="Live Activity Isn't Loading"
            className="mt-3"
            detail={process.env.NODE_ENV === "development" ? error : undefined}
          >
            We couldn&apos;t reach your applications. Refresh the page in a few minutes.
          </EmptyState>
        ) : applications.length === 0 ? (
          <EmptyState Icon={Zap} title="Nothing Queued Yet" className="mt-3">
            Start Auto Apply to queue your best matches, or click Auto Apply on any job.
          </EmptyState>
        ) : (
          <ActivityList items={applications.map(activityOf)} now={now} />
        )}
      </AutoApplyPanel>
    </div>
  );
}
