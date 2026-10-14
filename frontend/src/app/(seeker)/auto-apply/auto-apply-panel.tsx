"use client";

import { useState, type ReactNode } from "react";

import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";

import { ApplyingResume } from "./applying-resume";

/** Whether auto apply is on: never started, running, or paused after a run. */
export type RunState = "idle" | "running" | "paused";

const RUN_LABEL: Record<RunState, string> = {
  idle: "Not Started",
  running: "Live",
  paused: "Paused",
};

/**
 * The page's two sections, and the one piece of state they share: the button
 * beside the resume starts and pauses auto apply, and Live Activity's heading
 * says which it is. `children` is the feed itself (./activity-list.tsx),
 * drawn on the server and passed through, since this half is a client
 * component.
 *
 * NOTHING RUNS YET. The button only moves this state; no job is matched,
 * tailored or filled, and the feed is a fixture (./data.ts). Wiring it is
 * `auto-apply/design.md` at the repo root, sections 4 and 7.
 */
export function AutoApplyPanel({ children }: { children: ReactNode }) {
  const [run, setRun] = useState<RunState>("idle");

  return (
    <>
      <ApplyingResume
        run={run}
        onToggle={() => setRun((now) => (now === "running" ? "paused" : "running"))}
      />

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
