"use client";

import { useEffect, useState } from "react";

import { CheckIcon } from "@/components/icons";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { practiceStatus, showRunTab, type PracticeState } from "@/lib/autofill-extension";
import { PRACTICE_JOBS } from "@/lib/practice-form";

/** How often the step asks the extension where each practice job is. */
const POLL_MS = 1000;

/** Each practice job's state by job id, asked now and every POLL_MS while `active`. */
export function usePracticeStatus(active: boolean): Record<string, PracticeState> {
  const [states, setStates] = useState<Record<string, PracticeState>>({});
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const ask = async () => {
      const next = await practiceStatus();
      if (!stopped) setStates(next);
    };
    void ask();
    const timer = setInterval(ask, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active]);
  return states;
}

/** Whether every practice job was submitted: the step's end. */
export function practiceDone(states: Record<string, PracticeState>): boolean {
  return PRACTICE_JOBS.every((job) => states[job.id] === "submitted");
}

/** The first practice job whose tab is open, the one Show Next Tab switches to: a tab that needs the student first. */
export function nextPracticeTab(states: Record<string, PracticeState>): string | null {
  const open = (wanted: PracticeState[]) =>
    PRACTICE_JOBS.find((job) => wanted.includes(states[job.id]));
  return (open(["needs_you"]) ?? open(["ready", "filling"]))?.id ?? null;
}

const SHOWN: Record<PracticeState, { label: string; tone: BadgeTone }> = {
  waiting: { label: "Waiting", tone: "inert" },
  filling: { label: "Filling", tone: "brand" },
  ready: { label: "Ready", tone: "positive" },
  needs_you: { label: "Needs You", tone: "warning" },
  submitted: { label: "Submitted", tone: "positive" },
  closed: { label: "Tab Closed", tone: "inert" },
};

/**
 * Onboarding's last step (KAN-378): a practice batch on two of WorkIt's own
 * practice forms (lib/practice-form), so the student sees batch apply's
 * whole flow before a real job posting. Start Practice (the footer's, in
 * ./onboarding-form) asks the extension to open them; each row then shows
 * where its job is, as the extension reports it: filling, in the Ready or
 * Needs You tab group, submitted once the student pressed the form's own
 * Submit. Once both are submitted the step says the student is ready, and
 * the footer opens the Jobs page.
 */
export function PracticeStep({ states }: { states: Record<string, PracticeState> }) {
  if (practiceDone(states)) {
    return (
      <div className="flex flex-col items-start gap-4">
        <span
          aria-hidden
          className="bg-positive text-panel flex size-12 items-center justify-center rounded-full"
        >
          <CheckIcon className="size-6" />
        </span>
        <h2 className="text-title text-ink">You&apos;re Ready</h2>
        <p className="text-body text-ink-muted max-w-prose">
          Real batches work the same way. Queue jobs from the Jobs page and start Auto Apply: WorkIt
          fills the facts on each form, and you answer the written questions, review each tab and
          press Submit yourself.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <ol className="text-body text-ink-muted flex list-decimal flex-col gap-2 pl-5">
        <li>WorkIt opens each practice form in a tab beside this one and fills it.</li>
        <li>
          A filled tab goes into the tab group named{" "}
          <strong className="text-ink font-semibold">Ready</strong>, or{" "}
          <strong className="text-ink font-semibold">Needs you</strong> when something is left for
          you.
        </li>
        <li>Check each tab, answer what is left, and press the form&apos;s Submit.</li>
      </ol>
      <p className="text-body text-ink-meta">
        These forms are WorkIt&apos;s own. Nothing you submit on them reaches an employer.
      </p>
      <ul className="flex flex-col gap-3">
        {PRACTICE_JOBS.map((job) => {
          const state = states[job.id];
          const open = state === "filling" || state === "ready" || state === "needs_you";
          return (
            <li
              key={job.id}
              className="border-border bg-panel rounded-card flex items-center gap-4 border p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="text-subtitle text-ink truncate">{job.title}</p>
                <p className="text-body text-ink-meta">{job.companyName}</p>
              </div>
              {state && <Badge tone={SHOWN[state].tone}>{SHOWN[state].label}</Badge>}
              {open && (
                <Button variant="outline" onClick={() => void showRunTab(job.id)}>
                  Show Tab
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
