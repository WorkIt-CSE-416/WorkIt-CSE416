"use client";

import { XIcon } from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { useToast } from "@/components/ui/toast";

import { dequeueJob, queueJob } from "./actions";

/**
 * Live Activity's cross on a queued row, in its Actions cell: takes the job out of the queue
 * (dequeueJob), refreshes the route so the server draws the list without
 * it, and raises a toast with Undo (components/ui/toast.tsx). Undo queues
 * the job again (queueJob), so it comes back as a new queued row, at the
 * bottom: the queue orders by when a job was queued, and this is a new
 * queueing.
 *
 * Only queued rows have one: a later stage is a record, not a plan. A bare
 * cross, its name in the tooltip, alone in the narrow Actions column
 * (KAN-285): beside the badge it read as closing the badge, and a worded
 * Remove button took width the table needs. The row leaves a click on a button
 * alone (components/clickable-row.tsx), so a click removes and never opens
 * the job posting. A failure says so in a toast too.
 *
 * One removal per row at a time (`busy`, a ref): `disabled={pending}` only
 * lands on the next render, so a fast double click sent two removals, and
 * the second one's 404 counts as done, so it raised a second toast.
 */
export function RemoveFromQueue({
  jobId,
  role,
  company,
}: {
  jobId: string;
  role: string;
  company: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const busy = useRef(false);

  async function undo() {
    const result = await queueJob(jobId);
    if (result.error) {
      toast.show({ message: `Couldn't put ${role} back in the queue. ${result.error}` });
      return;
    }
    router.refresh();
  }

  return (
    <IconButton
      label={`Remove ${role} from the queue`}
      tooltip="Remove from queue"
      className="size-8"
      disabled={pending}
      onClick={() => {
        if (busy.current) return;
        busy.current = true;
        start(async () => {
          try {
            const result = await dequeueJob(jobId);
            if (result.error) {
              toast.show({ message: result.error });
              return;
            }
            router.refresh();
            toast.show({
              message: (
                <>
                  <span className="font-medium">{role}</span> from{" "}
                  <span className="font-medium">{company}</span> is removed from Auto Apply.
                </>
              ),
              action: { label: "Undo", onClick: undo },
            });
          } finally {
            busy.current = false;
          }
        });
      }}
    >
      <XIcon aria-hidden className="size-4" />
    </IconButton>
  );
}
