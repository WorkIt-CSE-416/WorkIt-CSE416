"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { useToast } from "@/components/ui/toast";

import { dequeueJob, queueJob } from "./actions";

/**
 * Live Activity's cross on a queued row: takes the job out of the queue
 * (dequeueJob), refreshes the route so the server draws the list without
 * it, and raises a toast with Undo (components/ui/toast.tsx). Undo queues
 * the job again (queueJob), so it comes back as a new queued row, at the
 * top: the queue orders by when a job was queued, and this is a new queueing.
 *
 * Only queued rows have a cross: a later stage is a record, not a plan. It
 * sits above the row's stretched link (`relative z-10`), so a click removes
 * and never opens the job posting. A failure says so in a toast too.
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
      className="relative z-10 size-7"
      disabled={pending}
      onClick={() =>
        start(async () => {
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
        })
      }
    >
      <X aria-hidden className="size-4" />
    </IconButton>
  );
}
