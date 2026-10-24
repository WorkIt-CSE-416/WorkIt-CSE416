"use client";

import { PlusIcon } from "@/components/icons";
import { useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { LightningRoundedIcon } from "@/components/custom-icons";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";
import { useRunnerJob } from "@/lib/autofill-extension";

import { ActivityTable, type ActivityItem } from "./activity-list";
import { AddJobsDialog, type SavedJob } from "./add-jobs-dialog";
import { ResumeDialog } from "./resume-dialog";

/**
 * Up Next (KAN-359): the queue, in the order the extension takes it (oldest
 * first), with Add Jobs at the heading's right. Needs-you jobs (Couldn't
 * Finish) stay in it too: they wait on the seeker, and with History
 * archived (./page.tsx) no other table lists them.
 *
 * Live Activity's table in its "queue" variant (./activity-list.tsx): Role,
 * Status, Resume, Match, Date Added and the cross, with no sorting, since
 * this order is the run's. **The Resume cell is a button**: it opens the
 * row's resume picker (./resume-dialog.tsx), where the student picks the
 * resume that job goes out with. The cell shows that pick, else the rule's
 * (./page.tsx). The queued job open in the extension's tab reads Working
 * in Browser (useRunnerJob), with its glyph that goes to the tab.
 *
 * **Add Jobs** opens the saved jobs to pick and queue (./add-jobs-dialog.tsx),
 * which replaced a Ready to Queue section under this one.
 */
export function UpNext({ items, saved }: { items: ActivityItem[]; saved: SavedJob[] }) {
  const runnerJob = useRunnerJob();
  const [adding, setAdding] = useState(false);
  const [resumeFor, setResumeFor] = useState<ActivityItem | null>(null);

  const rows = items.map((item) =>
    item.id === runnerJob
      ? { ...item, status: "browser" as const, detail: "Open in a background tab" }
      : item,
  );

  return (
    <section aria-labelledby="up-next" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading id="up-next">Up Next</SectionHeading>
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
          <PlusIcon className="size-4" />
          Add Jobs
        </Button>
      </div>

      {rows.length > 0 ? (
        <ActivityTable
          items={rows}
          sort="queue"
          onSort={() => {}}
          variant="queue"
          onResume={setResumeFor}
        />
      ) : (
        <EmptyState Icon={LightningRoundedIcon} title="Nothing Queued Yet" className="mt-3">
          Start Auto Apply to queue your best matches, Add Jobs from your saved ones, or click Auto
          Apply on any job.
        </EmptyState>
      )}

      <AddJobsDialog jobs={saved} open={adding} onOpenChange={setAdding} />
      {resumeFor && (
        <ResumeDialog
          key={resumeFor.id}
          jobId={resumeFor.id}
          role={resumeFor.role}
          company={resumeFor.company}
          current={resumeFor.resumeKey ?? null}
          open
          onOpenChange={(open) => !open && setResumeFor(null)}
        />
      )}
    </section>
  );
}
