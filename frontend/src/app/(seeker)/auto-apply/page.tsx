import type { Metadata } from "next";

import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { RememberFeed } from "../jobs/[jobId]/page-actions";
import { AutoApplyPanel } from "./auto-apply-panel";
import { getActivity, getNow } from "./data";

export const metadata: Metadata = {
  title: "Auto Apply",
  description: "Apply to the jobs that match you, with your resume filled in for you.",
};

/**
 * /auto-apply — where the seeker sets up applying in bulk (KAN-223). The
 * pipeline it will grow into is `auto-apply/architecture.md` at the repo root:
 * match, tailor the resume, fill the form with the extension, record.
 *
 * Two sections, under the heading block every seeker screen uses:
 *
 *   Applying with Resume   live: the primary resume, and the Start button
 *                          beside it (./applying-resume.tsx)
 *   Live Activity          the job postings the seeker queued with Auto
 *                          Apply, over a fixture (./data.ts): each job
 *                          posting the pipeline is working on and where it
 *                          stands (./activity-list.tsx)
 *
 * The button and the feed's heading share whether it runs, and the queue is
 * read in the browser, so both sections sit in the client
 * ./auto-apply-panel.tsx; the fixture and the request's clock are read here. A <div>, since SidebarInset is already the
 * <main>.
 */
export default function AutoApplyPage() {
  const now = getNow();

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      {/* So a queued job's page goes back here, not to the feed. */}
      <RememberFeed />
      <h1 className="text-heading text-ink">Auto Apply</h1>
      <p className="text-body text-ink-meta mt-1">
        Apply to the jobs that match you, with your resume filled in for you.
      </p>

      <AutoApplyPanel items={getActivity()} now={now} />
    </div>
  );
}
