"use client";

import { Zap } from "lucide-react";
import { useState, useTransition } from "react";

import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

import { dequeueJob, queueJob, type ApplicationStage } from "./actions";

/** What the button says once the job posting has an application. */
const STAGE_LABEL: Record<ApplicationStage, string> = {
  queued: "Queued",
  needs_you: "Needs You",
  skipped: "Skipped",
  applied: "Applied",
};

/**
 * A job posting's "Auto Apply", on its card and its own page, between Ask
 * Scout and Apply Now: Ask Scout's secondary design, with the sidebar's Auto
 * Apply glyph. A click queues the job posting through the API (./actions,
 * queueJob), and the Auto Apply page lists it in Live Activity.
 *
 * `stage` is the application the server read as it drew the page (null:
 * none). With one, the button names its stage. Queued is a toggle: a second
 * click takes the job out of the queue (dequeueJob) and the button reads
 * Auto Apply again. Any later stage is off: needs you, skipped and applied
 * are what happened, not a plan, so the button never undoes them. A stale
 * `stage` is harmless: a click answers the real one.
 */
export function AutoApplyButton({
  jobId,
  stage: saved,
}: {
  jobId: string;
  stage: ApplicationStage | null;
}) {
  const [stage, setStage] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (stage && stage !== "queued") {
    return (
      <Button variant="secondary" size="sm" disabled>
        <CheckIcon className="size-4" />
        {STAGE_LABEL[stage]}
      </Button>
    );
  }

  const queued = stage === "queued";
  return (
    <>
      {error && (
        <p role="alert" className="text-note text-ink-meta">
          {error}
        </p>
      )}
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        // A toggle: pressed while queued, and the hover says what a click does.
        aria-pressed={queued}
        title={queued ? "Remove from the queue" : undefined}
        onClick={() =>
          start(async () => {
            if (queued) {
              const result = await dequeueJob(jobId);
              setError(result.error);
              if (!result.error) setStage(null);
              return;
            }
            const result = await queueJob(jobId);
            setError(result.error);
            if (result.stage) setStage(result.stage);
          })
        }
      >
        {queued ? <CheckIcon className="size-4" /> : <Zap className="size-4" />}
        {queued ? STAGE_LABEL.queued : "Auto Apply"}
      </Button>
    </>
  );
}
