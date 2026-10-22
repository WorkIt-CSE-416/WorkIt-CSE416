"use client";

import { Pause, Play, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";
import { openNextApplication } from "@/lib/autofill-extension";
import { cn } from "@/lib/cn";

import { startBatch } from "./actions";
import { getDesktopStatus, type DesktopStatus } from "./desktop-actions";
import { DesktopStatusBar, useDesktopStatus } from "./desktop-status";
import { openedNote } from "./opened-note";
import { ResumeList, useResumes } from "./resume-list";

/** Whether auto apply is on: never started, running, or paused after a run. */
export type RunState = "idle" | "running" | "paused";

/** The run button by state. The brand fill marks the action that starts
 *  work, so Pause steps back to the bordered neutral and Resume is the brand
 *  fill again. */
const RUN_BUTTON: Record<
  RunState,
  { label: string; variant: "default" | "secondary"; Icon: typeof Zap }
> = {
  idle: { label: "Start Auto Apply", variant: "default", Icon: Zap },
  running: { label: "Pause Auto Apply", variant: "secondary", Icon: Pause },
  paused: { label: "Resume Auto Apply", variant: "default", Icon: Play },
};

/**
 * The Auto Apply page under its heading, and the one piece of state its parts
 * share. `children` is Live Activity, drawn on the server (./page.tsx) and
 * passed through, since this half is a client component.
 *
 * THE RUN BUTTON SITS IN THE PAGE'S HEADER (KAN-285), at the top right. It
 * is sm (36px), a header action's size (docs/design.md), and as wide as its
 * widest label, so Start becoming Pause shifts nothing. Its label is the
 * run's state: Pause while it runs, Resume while paused. It sat beside the
 * Resume List until KAN-285, stretched by the list's grid to the list's
 * whole height; lg in the header then still read larger than the app's
 * other primary buttons, and a Not Started / Live / Paused word beside it
 * only repeated the label, so both went (asked for 2026-10-20). On a
 * phone it drops under the title at full width. It is off until there is a
 * resume (the Resume List's, read here by useResumes), and while a batch is
 * queueing. The note on what happened sits under the header.
 *
 * START QUEUES A BATCH. WITH WORKIT DESKTOP RUNNING, THAT IS ALL (KAN-323):
 * Desktop's Workers claim the queued jobs, fill them and stop each before
 * Submit for the seeker's review in Live Activity. Whether Desktop runs is
 * read again with the batch (getDesktopStatus), not taken from the bar.
 *
 * WITHOUT DESKTOP, START QUEUES A BATCH, THEN OPENS THE FIRST APPLICATION in
 * the extension, as before Desktop. From idle, the
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
 *
 * WORKIT DESKTOP'S STATUS (KAN-323) sits under the header
 * (./desktop-status.tsx): read by the page for the first paint, then polled.
 */
export function AutoApplyPanel({
  desktop: initialDesktop,
  children,
}: {
  desktop: DesktopStatus | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [desktop, setDesktop] = useDesktopStatus(initialDesktop);
  const resumes = useResumes();
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
        // Desktop's status is read again with the queueing, not taken from
        // the bar: it decides who fills the batch.
        const [result, status] = await Promise.all([startBatch(), getDesktopStatus()]);
        setDesktop(status.data);
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
        if (status.data?.online) {
          // WorkIt Desktop claims queued jobs itself (auto-apply/desktop.md).
          setNote({
            text: result.queued === 0 ? queued : `${queued} WorkIt Desktop is filling them.`,
            error: false,
          });
          return;
        }
        setNote({ text: queued, error: false });
        void openInBrowser(queued);
      } finally {
        queueing.current = false;
      }
    });
  }

  const button = RUN_BUTTON[run];
  const resumeCount = resumes.built.length + resumes.uploaded.length;

  return (
    <>
      <div className="flex flex-col gap-4 @2xl/main:flex-row @2xl/main:items-start @2xl/main:justify-between">
        <div className="min-w-0">
          <h1 className="text-heading text-ink">Auto Apply</h1>
          <p className="text-body text-ink-meta mt-1">
            Apply to the jobs that match you, with your resume filled in for you.
          </p>
        </div>

        <Button
          variant={button.variant}
          size="sm"
          disabled={resumeCount === 0 || pending}
          onClick={toggle}
          className="w-full shrink-0 @2xl/main:w-44"
        >
          <button.Icon aria-hidden />
          {button.label}
        </Button>
      </div>

      {note && (
        <p
          role={note.error ? "alert" : "status"}
          className={cn(
            "text-body mt-3 @2xl/main:text-right",
            note.error ? "text-danger" : "text-ink-meta",
          )}
        >
          {note.text}
        </p>
      )}

      <DesktopStatusBar status={desktop} className="mt-4" />

      <ResumeList resumes={resumes} />

      <section aria-labelledby="live-activity" className="mt-10">
        <SectionHeading id="live-activity">Live Activity</SectionHeading>
        {children}
      </section>
    </>
  );
}
