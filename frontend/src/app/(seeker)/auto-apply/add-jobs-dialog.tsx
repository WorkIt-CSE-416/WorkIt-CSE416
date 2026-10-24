"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { CompanyLogo } from "@/components/company-logo";
import { LightningRoundedIcon } from "@/components/custom-icons";
import { MatchBadge } from "@/components/match-badge";
import { Checkbox } from "@/components/shadcn/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button, ButtonLink } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { openNextApplication } from "@/lib/autofill-extension";
import { cn } from "@/lib/cn";

import { queueJob } from "./actions";
import { openedNote } from "./opened-note";

/** A saved job as Add Jobs lists it: plain data from ./page.tsx. */
export type SavedJob = {
  id: string;
  role: string;
  company: string;
  logoUrl: string | null;
  match: number | null;
  /** Its hiring system is one auto apply can fill (Greenhouse for now). */
  autoApply: boolean;
};

/**
 * Up Next's Add Jobs (KAN-359): the seeker's saved jobs in a dialog, to pick
 * several and add them to the queue. THE ONE PLACE A SEEKER QUEUES SEVERAL
 * JOBS AT ONCE: the Jobs page and the Dashboard keep one click per job, and
 * the Applications Tracker is the record. It was a Ready to Queue section on
 * this page first, which the user found redundant beside the saved jobs, and
 * before that the Tracker's Saved view.
 *
 * A row's checkbox, or a click on the row but its title (the job's link),
 * picks it; Select All picks every job auto apply can fill. One it can't
 * (not Greenhouse, for now) can't be picked and says why. "Add N to Queue"
 * queues each pick through the same call as a job's own Auto Apply button
 * (queueJob), in the list's order, then asks the extension to open the
 * oldest queued job (openNextApplication), says how many went in with a
 * toast, and redraws the page, so the picks join Up Next. There is no
 * "auto apply all saved jobs": the seeker picks each one, so auto apply
 * still never queues a saved job on its own (frontend/CLAUDE.md). The
 * checkbox takes `border-ink-meta`, as CheckRowBox does: the vendored
 * hairline drew the empty box at 1.19:1.
 */
export function AddJobsDialog({
  jobs,
  open,
  onOpenChange,
}: {
  jobs: SavedJob[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [pending, start] = useTransition();
  const pickable = jobs.filter((job) => job.autoApply);
  const pickedNow = pickable.filter((job) => picked.has(job.id)).map((job) => job.id);
  const allPicked = pickable.length > 0 && pickedNow.length === pickable.length;

  function toggle(id: string) {
    setPicked((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addToQueue() {
    start(async () => {
      let queued = 0;
      let failed = 0;
      for (const id of pickedNow) {
        const result = await queueJob(id);
        if (result.stage === "queued") queued++;
        else if (!result.stage) failed++;
      }
      setPicked(new Set());
      onOpenChange(false);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-subtitle font-semibold">Add Jobs to the Queue</DialogTitle>
          <DialogDescription>
            Pick saved jobs for Auto Apply to fill. It fills Greenhouse jobs only, for now.
          </DialogDescription>
        </DialogHeader>

        {jobs.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-body text-ink-meta">
              You have no saved jobs yet. Save jobs from the Jobs page, then add them here.
            </p>
            <ButtonLink href="/jobs?sort=match" variant="secondary" size="sm">
              Find Jobs
            </ButtonLink>
          </div>
        ) : (
          <div className="border-border-subtle rounded-card overflow-hidden border">
            <div className="border-border-subtle flex items-center gap-3 border-b px-4 py-2.5">
              <Checkbox
                className="border-ink-meta"
                checked={allPicked}
                indeterminate={pickedNow.length > 0 && !allPicked}
                disabled={pickable.length === 0 || pending}
                onCheckedChange={() =>
                  setPicked(allPicked ? new Set() : new Set(pickable.map((job) => job.id)))
                }
                aria-label={allPicked ? "Unselect All" : "Select All That Auto Apply Can Fill"}
              />
              <span className="text-note text-ink-meta">
                {pickable.length === 0
                  ? "None of your saved jobs are on Greenhouse yet."
                  : `${pickable.length} of ${jobs.length} saved jobs can be auto applied to`}
              </span>
            </div>
            <ul className="divide-border-subtle divide-y">
              {jobs.map((job) => (
                <li
                  key={job.id}
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("a, button")) return;
                    if (job.autoApply && !pending) toggle(job.id);
                  }}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 transition-colors duration-150",
                    job.autoApply
                      ? "hover:bg-hover has-[[data-checked]]:bg-brand-tint cursor-pointer"
                      : "cursor-not-allowed",
                  )}
                >
                  <Checkbox
                    className="border-ink-meta"
                    checked={picked.has(job.id) && job.autoApply}
                    disabled={!job.autoApply || pending}
                    onCheckedChange={() => toggle(job.id)}
                    aria-label={
                      job.autoApply
                        ? `Select ${job.role} at ${job.company}`
                        : `${job.role} at ${job.company}: Auto Apply can't fill this job's site yet`
                    }
                  />
                  <CompanyLogo
                    name={job.company}
                    src={job.logoUrl}
                    className={cn(
                      "text-meta size-8 shrink-0 rounded",
                      !job.autoApply && "opacity-60",
                    )}
                  />
                  <div className={cn("min-w-0 flex-1", !job.autoApply && "opacity-60")}>
                    <Link
                      href={`/jobs/${encodeURIComponent(job.id)}`}
                      title={job.role}
                      className="text-label text-ink hover:text-brand focus-visible:ring-brand-ring block truncate rounded-xs font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {job.role}
                    </Link>
                    <p className="text-note text-ink-meta truncate">
                      {job.company}
                      {!job.autoApply && " · Auto Apply can't fill this one"}
                    </p>
                  </div>
                  {job.match != null && <MatchBadge score={job.match} />}
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={addToQueue} disabled={pickedNow.length === 0 || pending}>
            <LightningRoundedIcon aria-hidden className="size-4" />
            {pending
              ? "Adding…"
              : pickedNow.length === 0
                ? "Add to Queue"
                : `Add ${pickedNow.length} to Queue`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
