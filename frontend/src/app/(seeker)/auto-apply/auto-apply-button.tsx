"use client";

import { Zap } from "lucide-react";
import { useState, useTransition } from "react";

import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

import { queueJob, type ApplicationStage } from "./actions";

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
 * none). With one, the button names its stage and is off, so a job is never
 * queued twice. A stale `stage` is harmless: a click answers the real one.
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

  if (stage) {
    return (
      <Button variant="secondary" size="sm" disabled>
        <CheckIcon className="size-4" />
        {STAGE_LABEL[stage]}
      </Button>
    );
  }

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
        onClick={() =>
          start(async () => {
            const result = await queueJob(jobId);
            setError(result.error);
            if (result.stage) setStage(result.stage);
          })
        }
      >
        <Zap className="size-4" />
        Auto Apply
      </Button>
    </>
  );
}
