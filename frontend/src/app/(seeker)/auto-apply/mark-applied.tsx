"use client";

import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { useToast } from "@/components/ui/toast";

import { STAGE_ICON } from "../stage-colors";
import { markSubmitted } from "./actions";

/**
 * Live Activity's "Mark applied" (KAN-369), in a row's Actions cell while it
 * is not applied or skipped: for an application the student sent that the
 * extension didn't see (its submit detection missed it). It finishes the
 * application as submitted (markSubmitted), then redraws the list, where
 * the row shows Applied, dated now. The batch panel's "I submitted this"
 * does the same from the job's tab. One click at a time (`busy`), as
 * RemoveFromQueue.
 */
export function MarkApplied({ jobId, role }: { jobId: string; role: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const Icon = STAGE_ICON.applied;

  return (
    <IconButton
      label={`Mark ${role} applied`}
      tooltip="I submitted this: mark applied"
      className="size-8"
      disabled={pending}
      onClick={() => {
        if (busy.current) return;
        busy.current = true;
        start(async () => {
          try {
            const result = await markSubmitted(jobId);
            if (result.error) {
              toast.show({ message: result.error });
              return;
            }
            router.refresh();
            toast.show({
              message: (
                <>
                  <span className="font-medium">{role}</span> is marked Applied.
                </>
              ),
            });
          } finally {
            busy.current = false;
          }
        });
      }}
    >
      <Icon className="size-4" />
    </IconButton>
  );
}
