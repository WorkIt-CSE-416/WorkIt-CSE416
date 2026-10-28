"use client";

import { PlusIcon } from "@/components/icons";
import { useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { LightningRoundedIcon } from "@/components/custom-icons";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";
import { useBrowserJobs } from "@/lib/autofill-extension";

import { ActivityTable, needsYou, type ActivityItem } from "./activity-list";
import { AddJobsDialog, type SavedJob } from "./add-jobs-dialog";
import { ResumeDialog } from "./resume-dialog";

/**
 * Up Next (KAN-359): the queue, in the order the extension takes it (oldest
 * first), with Add Jobs at the heading's right. Needs-you jobs (Couldn't
 * Finish) stay in it too: they wait on the seeker, and with History
 * archived (./page.tsx) no other table lists them.
 *
 * **Rows that need the student come first (KAN-424)**, then the rest, each
 * in the run's order: `needsYou` in ./activity-list.tsx (a closed posting,
 * a fill that couldn't finish, or no resume), whose chips say why. One table
 * with no group headings: a "Needs You · 2" heading under Up Next's said
 * again what the header's line and the chips say.
 *
 * Live Activity's table in its "queue" variant (./activity-list.tsx): Role,
 * Status (a chip only where a row isn't simply waiting), Resume, Match,
 * Date Added and the row's ⋯ menu (./row-menu.tsx), with no sorting, since
 * this order is the run's. **The Resume cell is a button**: it opens the
 * row's resume picker (./resume-dialog.tsx), where the student picks the
 * resume that job goes out with. The cell shows that pick, else the rule's
 * (./page.tsx). The queued job open in the extension's tab reads Working
 * in Browser (useBrowserJobs), and its ⋯ menu goes to its tab.
 *
 * **Add Jobs** opens the saved jobs to pick and queue (./add-jobs-dialog.tsx),
 * which replaced a Ready to Queue section under this one.
 */
export function UpNext({ items, saved }: { items: ActivityItem[]; saved: SavedJob[] }) {
  const browserJobs = useBrowserJobs();
  const [adding, setAdding] = useState(false);
  const [resumeFor, setResumeFor] = useState<ActivityItem | null>(null);

  const rows = items.map((item) =>
    browserJobs.has(item.id)
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
          // Needs You first, then the rest, each in the run's order (a stable sort).
          items={[...rows.filter(needsYou), ...rows.filter((row) => !needsYou(row))]}
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
