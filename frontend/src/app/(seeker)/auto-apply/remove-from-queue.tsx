"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { IconButton } from "@/components/ui/icon-button";

import { dequeueJob } from "./actions";

/**
 * Live Activity's cross on a queued row: takes the job out of the queue
 * (dequeueJob), then refreshes the route so the server draws the list
 * without it. Only queued rows have one: a later stage is a record, not a
 * plan. It sits above the row's stretched link (`relative z-10`), so a
 * click removes and never opens the job posting.
 */
export function RemoveFromQueue({ jobId, role }: { jobId: string; role: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      {error && (
        <span role="alert" className="text-note text-danger">
          {error}
        </span>
      )}
      <IconButton
        label={`Remove ${role} from the queue`}
        tooltip="Remove from queue"
        className="relative z-10 size-7"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await dequeueJob(jobId);
            setError(result.error);
            if (!result.error) router.refresh();
          })
        }
      >
        <X aria-hidden className="size-4" />
      </IconButton>
    </>
  );
}
