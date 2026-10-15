"use client";

import { useState } from "react";

import { useAutoApplyQueue } from "@/components/auto-apply-queue";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";

import { ActivityList } from "./activity-list";
import { ApplyingResume } from "./applying-resume";
import type { ActivityItem } from "./data";

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
 * says which it is.
 *
 * LIVE ACTIVITY IS THE SEEKER'S QUEUE OVER THE FIXTURE. The job postings
 * queued with Auto Apply on a job card or page (@/components/auto-apply-queue)
 * come first, newest first, each Queued and linking to its page; the
 * fixture's invented rows (`items`, ./data.ts) follow. The queue is read in
 * the browser, so it lands just after hydration. `now` is the request's
 * clock, which the fixture's times are set against.
 *
 * NOTHING RUNS YET. The button only moves this state; no job is matched,
 * tailored or filled. Wiring it is `auto-apply/architecture.md` at the repo
 * root: the runner and its routes.
 */
export function AutoApplyPanel({ items, now }: { items: ActivityItem[]; now: Date }) {
  const [run, setRun] = useState<RunState>("idle");
  const { jobs } = useAutoApplyQueue();
  const queued = jobs.map((job): ActivityItem => ({
    id: `queued-${job.id}`,
    role: job.title,
    company: job.company,
    logoUrl: job.logoUrl,
    location: job.location,
    status: "queued",
    detail: "Waiting for its turn",
    at: job.queuedAt,
    href: `/jobs/${job.id}`,
  }));

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
        <ActivityList items={[...queued, ...items]} now={now} />
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
