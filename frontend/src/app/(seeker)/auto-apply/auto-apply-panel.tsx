"use client";

import { PauseIcon, PlayIcon } from "@phosphor-icons/react/ssr";
import { LightningRoundedIcon } from "@/components/custom-icons";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { openNextApplication } from "@/lib/autofill-extension";
import { TextLink } from "@/components/ui/text-link";
import { cn } from "@/lib/cn";

import { startBatch } from "./actions";
import { openedNote } from "./opened-note";

/** Whether auto apply is on: never started, running, or paused after a run. */
export type RunState = "idle" | "running" | "paused";

/** The run button by state. The brand fill marks the action that starts
 *  work, so Pause steps back to the bordered neutral and Resume is the brand
 *  fill again. */
const RUN_BUTTON: Record<
  RunState,
  { label: string; variant: "default" | "secondary"; Icon: typeof LightningRoundedIcon }
> = {
  idle: { label: "Start Auto Apply", variant: "default", Icon: LightningRoundedIcon },
  running: { label: "Pause Auto Apply", variant: "secondary", Icon: PauseIcon },
  paused: { label: "Resume Auto Apply", variant: "default", Icon: PlayIcon },
};

/**
 * The Auto Apply page's heading, its run button and the resume note under
 * it. `children` is the page's three sections, Up Next, Ready to Queue and
 * History, drawn on the server (./page.tsx) and passed through, since this
 * half is a client component.
 *
 * THE RESUME NOTE replaced the Resume List table (KAN-359), which opened the
 * page with every resume the seeker has: the page is about which jobs go
 * out, so jobs lead it, and each queued job shows its own resume in Up
 * Next. The note names the default resume and links to Resumes &
 * Experiences, where resumes are chosen and starred.
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
 * resume (`hasResume`, read on the server), and while a batch is queueing. The note on what happened sits under the header.
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
export function AutoApplyPanel({
  hasResume,
  defaultResume,
  children,
}: {
  /** The seeker has at least one resume: Start is off without one. */
  hasResume: boolean;
  /** The default resume's name, or null when none is starred. */
  defaultResume: string | null;
  children: ReactNode;
}) {
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

  const button = RUN_BUTTON[run];

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
          disabled={!hasResume || pending}
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

      <p className="text-body text-ink-meta mt-3">
        {defaultResume ? (
          <>
            Each job goes out with the resume tailored to it, else your default,{" "}
            <span className="text-ink font-medium">{defaultResume}</span>.{" "}
          </>
        ) : hasResume ? (
          "Each job goes out with the resume tailored to it. Star a default resume for the rest. "
        ) : (
          "Add a resume to start auto applying. "
        )}
        <TextLink href="/resumes">Manage Resumes</TextLink>
      </p>

      {children}
    </>
  );
}
