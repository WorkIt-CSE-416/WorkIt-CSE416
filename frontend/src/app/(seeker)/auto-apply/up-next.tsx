"use client";

import { PlusIcon } from "@/components/icons";
import { XIcon } from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { LightningRoundedIcon } from "@/components/custom-icons";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";
import { useToast } from "@/components/ui/toast";
import {
  closeRunTab,
  openNextApplication,
  showRunTab,
  useBrowserTabs,
} from "@/lib/autofill-extension";

import { dequeueJob, queueJob, skipJob } from "./actions";
import type { ActivityItem } from "./activity-list";
import { AddJobsDialog, type SavedJob } from "./add-jobs-dialog";
import { openedNote } from "./opened-note";
import { canOpen, groupOf, QueueTable, type QueueRow } from "./queue-table";
import { ResumeDialog } from "./resume-dialog";

/**
 * Up Next (KAN-359): every job in the queue, in the order the extension
 * takes it (oldest first), with Add Jobs at the heading's right.
 *
 * **Grouped by whether WorkIt has started each job** (./queue-table.tsx):
 * In Progress (open in a batch tab, with the tab's own state, read live
 * from the extension: useBrowserTabs asks every few seconds while this
 * shows; or Needs You once its tab closed) and Queued (not started). A tab that
 * closes or sends its application refreshes the route, since its stage may
 * have moved (needs_you, applied) and only the server reads it.
 *
 * **A row's status is its one action** (`act`): a click goes to the job's
 * tab (showRunTab), opens a started job again whose tab was closed
 * (openNextApplication with its id, which fills its form again). Its ⋯ menu (./row-menu.tsx) holds
 * Change Resume, I Already Applied and Remove From Queue on every row.
 * **The Resume cell is a button** opening the row's resume picker
 * (./resume-dialog.tsx); the cell shows that pick, else the rule's
 * (./page.tsx), and an empty Choose Resume slot when there is none.
 *
 * **Rows are picked with select boxes.** While any is picked, the heading's
 * right end shows the count and the two things to do to them, in place of
 * Add Jobs; Select All unpicks them (./queue-table.tsx):
 *
 *   Remove       `remove`, as the row menu's Remove From Queue.
 *   Auto Apply   opens the picked jobs with no tab open (queued, or started with its tab closed)
 *                in batch tabs
 *                (openNextApplication with their ids): they go first, and
 *                a batch started from them opens nothing else.
 *
 * A Stop (close a filling job's tab, so it waits again) and a Clear sat
 * there too until 2026-10-29: Stop's square read as one more select box
 * and Remove already closes the tab, and Select All clears a pick.
 *
 * **Remove works on every row** (`remove`): a tab open on it closes first;
 * a queued job leaves the queue (dequeueJob), with Undo in the toast, which
 * queues it again at the end; a started one (needs_you), which the queue's DELETE
 * refuses, is skipped (skipJob), with no Undo.
 *
 * **Add Jobs** opens the saved jobs to pick and queue (./add-jobs-dialog.tsx).
 */
export function UpNext({ items, saved }: { items: ActivityItem[]; saved: SavedJob[] }) {
  const router = useRouter();
  const toast = useToast();
  const tabs = useBrowserTabs();
  const [adding, setAdding] = useState(false);
  const [resumeFor, setResumeFor] = useState<ActivityItem | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [pending, start] = useTransition();
  // One action at a time: `pending` lands a render late, and a fast double press sent two requests.
  const busy = useRef(false);

  const rows: QueueRow[] = items.map((item) => {
    const tab = tabs.get(item.id) ?? null;
    return { ...item, tab, group: groupOf(item, tab) };
  });
  const checked = rows.filter((row) => picked.has(row.id));
  const openable = checked.filter(canOpen);

  // A tab that closed or sent its application: its stage may have moved, so read the queue again.
  const seen = useRef<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    const before = seen.current;
    seen.current = tabs;
    const left = [...before.keys()].some((id) => !tabs.has(id));
    const sent = [...tabs].some(
      ([id, state]) => state === "applied" && before.get(id) !== "applied",
    );
    if (left || sent) router.refresh();
  }, [tabs, router]);

  function once(work: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    start(async () => {
      try {
        await work();
      } finally {
        busy.current = false;
      }
    });
  }

  const apply = (targets: QueueRow[]) =>
    once(async () => {
      const result = await openNextApplication(targets.map((row) => row.id));
      if (result.opened) setPicked(new Set());
      const one = targets.length === 1;
      toast.show({
        message: result.opened
          ? `${one ? "It is" : `${targets.length} jobs are`} filling in background tabs, five at a time.`
          : result.reason === "queue_empty"
            ? `${one ? "It" : "None of them"} could open. ${one ? "Its posting" : "Their postings"} may have closed.`
            : openedNote(result),
      });
    });

  const remove = (targets: QueueRow[]) =>
    once(async () => {
      const results = await Promise.all(
        targets.map(async (row) => {
          if (row.tab) await closeRunTab(row.id);
          if (row.status === "failed") return { row, undo: false, ...(await skipJob(row.id)) };
          const out = await dequeueJob(row.id);
          // Its fill moved it to needs_you since the page loaded: the queue's DELETE refuses it.
          if (out.error) return { row, undo: false, ...(await skipJob(row.id)) };
          return { row, undo: true, ...out };
        }),
      );
      const removed = results.filter((result) => !result.error);
      const failed = results.length - removed.length;
      const undoable = removed.filter((result) => result.undo).map((result) => result.row);
      setPicked(new Set());
      router.refresh();
      const one = removed.length === 1 && targets.length === 1;
      toast.show({
        message: one
          ? `${targets[0].role} from ${targets[0].company} is removed from Auto Apply.`
          : `${removed.length} ${removed.length === 1 ? "job is" : "jobs are"} removed from Auto Apply.${
              failed > 0 ? ` ${failed} couldn't be removed.` : ""
            }`,
        ...(undoable.length > 0 && {
          action: {
            label: "Undo",
            onClick: async () => {
              // One at a time, so they join the queue's end in the order they had.
              let lost = 0;
              for (const row of undoable) if ((await queueJob(row.id)).error) lost += 1;
              if (lost > 0) toast.show({ message: `Couldn't put ${lost} back in the queue.` });
              router.refresh();
            },
          },
        }),
      });
    });

  /** A click on a row's status (./queue-table.tsx, Status): where the job is finished. */
  function act(row: QueueRow) {
    if (row.tab) void showRunTab(row.id);
    else apply([row]);
  }

  return (
    <section aria-labelledby="up-next" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading id="up-next">Up Next</SectionHeading>
        {checked.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-note text-ink tabular-nums">{checked.length} selected</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => remove(checked)}
            >
              <XIcon aria-hidden className="size-4" />
              Remove
            </Button>
            <Button
              size="sm"
              disabled={openable.length === 0 || pending}
              onClick={() => apply(openable)}
            >
              <LightningRoundedIcon aria-hidden />
              Auto Apply
            </Button>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <PlusIcon className="size-4" />
            Add Jobs
          </Button>
        )}
      </div>

      {rows.length > 0 ? (
        <QueueTable
          rows={rows}
          picked={picked}
          onPick={(ids) => setPicked(new Set(ids))}
          onAction={act}
          onResume={setResumeFor}
          onRemove={(row) => remove([row])}
        />
      ) : (
        <EmptyState Icon={LightningRoundedIcon} title="Nothing Queued Yet" className="mt-3">
          Add Jobs from your saved ones, or click Auto Apply on any job.
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

/**
 * The Auto Apply header's line (./page.tsx): how many jobs are In Progress
 * and how many Queued, by Up Next's own rule (`groupOf`), so it reads the
 * live tabs too. Each part only when it counts something: "0 queued" read
 * as a fault.
 */
export function QueueSummary({ jobs }: { jobs: { id: string; started: boolean }[] }) {
  const tabs = useBrowserTabs();
  const started = jobs.filter((job) => job.started || tabs.has(job.id)).length;
  const queued = jobs.length - started;
  return [
    ...(started ? [`${started} in progress`] : []),
    ...(queued ? [`${queued} queued`] : []),
  ].join(" · ");
}
