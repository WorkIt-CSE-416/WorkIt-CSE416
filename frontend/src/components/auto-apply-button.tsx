"use client";

import { Zap } from "lucide-react";

import { useAutoApplyQueue, type QueuedJob } from "@/components/auto-apply-queue";
import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

/** A job posting's "Auto Apply", on its card and its own page, between Ask
 *  Scout and Apply Now. Ask Scout's secondary design, with the sidebar's
 *  Auto Apply glyph. A click queues the job posting for the Auto Apply page
 *  (./auto-apply-queue.tsx); once queued it reads Queued and is off, so the
 *  same job is never queued twice. */
export function AutoApplyButton({ job }: { job: Omit<QueuedJob, "queuedAt"> }) {
  const { jobs, add } = useAutoApplyQueue();
  const queued = jobs.some((item) => item.id === job.id);

  return (
    <Button variant="secondary" size="sm" disabled={queued} onClick={() => add(job)}>
      {queued ? <CheckIcon className="size-4" /> : <Zap className="size-4" />}
      {queued ? "Queued" : "Auto Apply"}
    </Button>
  );
}
