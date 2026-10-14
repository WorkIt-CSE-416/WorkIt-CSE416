import type { Metadata } from "next";

import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { ActivityList } from "./activity-list";
import { AutoApplyPanel } from "./auto-apply-panel";
import { getActivity, getNow } from "./data";

export const metadata: Metadata = {
  title: "Auto Apply",
  description: "Apply to the jobs that match you, with your resume filled in for you.",
};

/**
 * /auto-apply — where the seeker sets up applying in bulk (KAN-223). The
 * pipeline it will grow into is `auto-apply/design.md` at the repo root:
 * match, tailor the resume, fill the form with the extension, record.
 *
 * Two sections, under the heading block every seeker screen uses:
 *
 *   Applying with Resume   live: the primary resume, and the Start button
 *                          beside it (./applying-resume.tsx)
 *   Live Activity          a fixture (./data.ts): each job posting the
 *                          pipeline is working on and where it stands
 *                          (./activity-list.tsx)
 *
 * The button and the feed's heading share whether it runs, so both sit in
 * the client ./auto-apply-panel.tsx; the feed is drawn here, on the server,
 * against the request's clock. A <div>, since SidebarInset is already the
 * <main>.
 */
export default function AutoApplyPage() {
  const now = getNow();

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <h1 className="text-heading text-ink">Auto Apply</h1>
      <p className="text-body text-ink-meta mt-1">
        Apply to the jobs that match you, with your resume filled in for you.
      </p>

      <AutoApplyPanel>
        <ActivityList items={getActivity()} now={now} />
      </AutoApplyPanel>
    </div>
  );
}
