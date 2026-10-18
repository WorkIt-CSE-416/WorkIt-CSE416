"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";

import { SectionHeading } from "@/components/ui/section-heading";
import { openNextApplication } from "@/lib/autofill-extension";
import { cn } from "@/lib/cn";

import { startBatch } from "./actions";
import { openedNote } from "./opened-note";
import { ResumeList } from "./resume-list";

/** Whether auto apply is on: never started, running, or paused after a run. */
export type RunState = "idle" | "running" | "paused";

const RUN_LABEL: Record<RunState, string> = {
  idle: "Not Started",
  running: "Live",
  paused: "Paused",
};

/**
 * The page's two sections, and the one piece of state they share: the button
 * beside the resume list starts and pauses auto apply, and Live Activity's heading
 * says which it is. `children` is Live Activity's list, drawn on the server
 * (./page.tsx) and passed through, since this half is a client component.
 *
 * START QUEUES A BATCH, THEN OPENS THE FIRST APPLICATION. From idle, the
 * button asks the API for the seeker's best matches (./actions, startBatch:
 * 10, leaving out every job they already have an application for) and
 * refreshes the route so the list shows them. Then it asks the extension's
 * runner to open the oldest queued application's apply_url in a background
 * tab beside this one (openNextApplication), and says what happened
 * (./opened-note.ts); Live Activity marks it Working in Browser. The click
 * waits for the queueing only: the tab opens after it settles, as on the
 * job card (./auto-apply-button.tsx), so the button never waits on a page
 * load. Nothing fills the form yet, and Pause and Resume only move this state
 * (`auto-apply/architecture.md`, "The run"). The state is the page's own,
 * so a return visit starts idle, and Start queues another batch.
 */
export function AutoApplyPanel({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [run, setRun] = useState<RunState>("idle");
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, start] = useTransition();
  // One batch at a time: `pending` disables the button a render late, so a
  // fast double click on Start queued two batches.
  const queueing = useRef(false);

  /** Not awaited: `run/open` answers only once the tab's page loads (up
   *  to 30 seconds), and inside the transition that kept Start disabled and
   *  held back the refreshed list. The note gains the result when it lands. */
  async function openInBrowser(queued: string) {
    const opened = await openNextApplication();
    setNote({
      text: `${queued} ${openedNote(opened)}`,
      error: !opened.opened && opened.reason !== "queue_empty",
    });
  }

  function toggle() {
    if (run !== "idle") {
      setRun(run === "running" ? "paused" : "running");
      return;
    }
    if (queueing.current) return;
    queueing.current = true;
    start(async () => {
      try {
        const result = await startBatch();
        if (result.error != null) {
          setNote({ text: result.error, error: true });
          return;
        }
        setRun("running");
        router.refresh();
        const queued =
          result.queued === 0
            ? "No new matches to queue."
            : `Queued ${result.queued} ${result.queued === 1 ? "job" : "jobs"}.`;
        setNote({ text: queued, error: false });
        void openInBrowser(queued);
      } finally {
        queueing.current = false;
      }
    });
  }

  return (
    <>
      <ResumeList run={run} pending={pending} onToggle={toggle} />

      {note && (
        <p
          role={note.error ? "alert" : "status"}
          className={cn("text-meta mt-2", note.error ? "text-danger" : "text-ink-meta")}
        >
          {note.text}
        </p>
      )}

      <section aria-labelledby="live-activity" className="mt-8">
        <SectionHeading id="live-activity" action={<RunIndicator run={run} />}>
          Live Activity
        </SectionHeading>
        {children}
      </section>
    </>
  );
}

/** A dot and a word at the heading's top right. Green only while it runs; the
 *  ring mounts with each start, so a restart rings again. role="status" so
 *  the change is read out. */
function RunIndicator({ run }: { run: RunState }) {
  const live = run === "running";

  return (
    <span role="status" className="text-label text-ink-muted flex items-center gap-2">
      <span
        aria-hidden="true"
        className={cn("relative size-2 rounded-full", live ? "bg-positive" : "bg-ink-faint")}
      >
        {live && <span className="animate-status-ping bg-positive absolute inset-0 rounded-full" />}
      </span>
      {RUN_LABEL[run]}
    </span>
  );
}
