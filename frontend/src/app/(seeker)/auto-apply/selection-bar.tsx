"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { LightningRoundedIcon } from "@/components/custom-icons";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { openNextApplication } from "@/lib/autofill-extension";

import { queueJob } from "../auto-apply/actions";
import { openedNote } from "../auto-apply/opened-note";

/**
 * Ready to Queue's selection bar (./ready-to-queue.tsx): how many saved jobs
 * are picked, Clear, and **Auto Apply Selected**, floating at the foot of
 * the page while anything is picked, so it stays in reach however far the
 * list scrolls.
 *
 * Auto Apply Selected queues each pick through the same call as a job's own
 * Auto Apply button (queueJob), one at a time in the list's order, so the
 * queue keeps that order; a saved row becomes a queued one (the API moves
 * it, and to the queue's end). Then, as that button does, it asks the
 * extension to open the oldest queued job in its background tab
 * (openNextApplication). A toast says how many went in, and the page draws
 * again: the queued jobs move from Ready to Queue to Up Next.
 *
 * The seeker picks every job, so auto apply still never queues a saved job
 * on its own (frontend/CLAUDE.md).
 */
export function SelectionBar({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  function autoApply() {
    start(async () => {
      let queued = 0;
      let failed = 0;
      for (const id of ids) {
        const result = await queueJob(id);
        if (result.stage === "queued") queued++;
        else if (!result.stage) failed++;
      }
      onClear();
      router.refresh();
      if (queued > 0) {
        // The tab opens in the background; only a failure is worth a line.
        void openNextApplication().then((result) => {
          if (!result.opened && (result.reason === "signed_out" || result.reason === "error")) {
            toast.show({ message: openedNote(result) });
          }
        });
      }
      toast.show({
        message:
          queued === 0
            ? "None of those jobs could be queued. Try again in a moment."
            : `${queued} ${queued === 1 ? "job is" : "jobs are"} queued for Auto Apply.${
                failed > 0 ? ` ${failed} couldn't be queued.` : ""
              }`,
      });
    });
  }

  return (
    <div
      role="region"
      aria-label="Selected Jobs"
      className="bg-panel shadow-lift border-border-subtle animate-rise sticky bottom-4 z-20 mx-auto mt-4 flex w-fit max-w-full flex-wrap items-center gap-3 rounded-full border py-2 pr-2 pl-5"
    >
      <span className="text-label text-ink tabular-nums">{ids.length} Selected</span>
      <Button variant="ghost" size="sm" onClick={onClear} disabled={pending}>
        Clear
      </Button>
      <Button size="sm" onClick={autoApply} disabled={pending}>
        <LightningRoundedIcon aria-hidden className="size-4" />
        {pending ? "Queueing…" : "Auto Apply Selected"}
      </Button>
    </div>
  );
}
