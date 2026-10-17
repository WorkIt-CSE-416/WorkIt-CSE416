"use client";

import { Zap } from "lucide-react";
import { useState, useTransition } from "react";

import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

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
 *
 * Queueing raises a toast (components/ui/toast.tsx), "<title> from <company>
 * is queued for Auto Apply.", with Undo, which takes the job out again
 * (dequeueJob) and turns the button back to Auto Apply: the same as Live
 * Activity's cross and its Undo, the other way round. Only a new queueing
 * raises one; a click that finds an earlier stage just shows it.
 */
export function AutoApplyButton({
  jobId,
  title,
  company,
  stage: saved,
}: {
  jobId: string;
  title: string;
  company: string;
  stage: ApplicationStage | null;
}) {
  const toast = useToast();
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

  /** The toast's Undo. A failure (a fill that began meanwhile) says so in a
   *  toast and leaves the button Queued. */
  async function undo() {
    const result = await dequeueJob(jobId);
    if (result.error) {
      toast.show({ message: `Couldn't take ${title} out of the queue. ${result.error}` });
      return;
    }
    setStage(null);
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
            if (!result.stage) return;
            setStage(result.stage);
            if (result.stage === "queued") {
              toast.show({
                message: (
                  <>
                    <span className="font-medium">{title}</span> from {company} is queued for Auto
                    Apply.
                  </>
                ),
                action: { label: "Undo", onClick: undo },
              });
            }
          })
        }
      >
        {queued ? <CheckIcon className="size-4" /> : <Zap className="size-4" />}
        {queued ? STAGE_LABEL.queued : "Auto Apply"}
      </Button>
    </>
  );
}
