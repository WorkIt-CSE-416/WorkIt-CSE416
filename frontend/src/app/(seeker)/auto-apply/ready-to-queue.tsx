"use client";

import Link from "next/link";
import { useState } from "react";

import { CompanyLogo } from "@/components/company-logo";
import { MatchBadge } from "@/components/match-badge";
import { Checkbox } from "@/components/shadcn/checkbox";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

import { SelectionBar } from "./selection-bar";

/** A saved job as Ready to Queue lists it: plain data from ./page.tsx. */
export type ReadyJob = {
  id: string;
  role: string;
  company: string;
  logoUrl: string | null;
  match: number | null;
  /** Its hiring system is one auto apply can fill (Greenhouse for now). */
  autoApply: boolean;
};

/**
 * Ready to Queue: the seeker's saved jobs, to pick for the queue. THE ONE
 * PLACE A SEEKER QUEUES SEVERAL JOBS AT ONCE: finding pages (the Jobs page,
 * the Dashboard) keep one click per job, and the Applications Tracker is the
 * record. It sat in the Tracker's Saved view first (KAN-359) and moved here,
 * where the seeker's intent is "apply for me".
 *
 * A row's checkbox, or a click anywhere on the row but its title (the job's
 * link), picks it; Select All picks every job that can be picked. A job auto
 * apply can't fill (its hiring system isn't Greenhouse, for now) can't be
 * picked and says why. While anything is picked, the selection bar floats at
 * the page's foot with Auto Apply Selected (./selection-bar.tsx). The
 * checkbox takes `border-ink-meta`, as CheckRowBox does: the vendored
 * hairline drew the empty box at 1.19:1.
 */
export function ReadyToQueue({ jobs }: { jobs: ReadyJob[] }) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
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

  return (
    <>
      <Card padding="none" className="mt-3 overflow-hidden">
        <div className="border-border-subtle flex items-center gap-3 border-b px-4 py-2.5">
          <Checkbox
            className="border-ink-meta"
            checked={allPicked}
            indeterminate={pickedNow.length > 0 && !allPicked}
            disabled={pickable.length === 0}
            onCheckedChange={() =>
              setPicked(allPicked ? new Set() : new Set(pickable.map((job) => job.id)))
            }
            aria-label={allPicked ? "Unselect All" : "Select All That Auto Apply Can Fill"}
          />
          <span className="text-note text-ink-meta">
            {pickable.length === 0
              ? "Auto Apply can fill Greenhouse jobs only, for now. None of your saved jobs are on it."
              : `${pickable.length} of ${jobs.length} can be auto applied to`}
          </span>
        </div>
        <ul className="divide-border-subtle divide-y">
          {jobs.map((job, i) => (
            <li
              key={job.id}
              style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("a, button")) return;
                if (job.autoApply) toggle(job.id);
              }}
              className={cn(
                "animate-fade flex items-center gap-3 px-4 py-3 transition-colors duration-150",
                job.autoApply
                  ? "hover:bg-hover has-[[data-checked]]:bg-brand-tint cursor-pointer"
                  : "cursor-not-allowed",
              )}
            >
              <Checkbox
                className="border-ink-meta"
                checked={picked.has(job.id) && job.autoApply}
                disabled={!job.autoApply}
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
                className={cn("text-meta size-8 shrink-0 rounded", !job.autoApply && "opacity-60")}
              />
              <div className={cn("min-w-0 flex-1", !job.autoApply && "opacity-60")}>
                <Link
                  href={`/jobs/${encodeURIComponent(job.id)}`}
                  title={job.role}
                  className="text-label text-ink hover:text-brand focus-visible:ring-brand-ring block truncate rounded-xs font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                >
                  {job.role}
                </Link>
                <p className="text-note text-ink-meta truncate">{job.company}</p>
              </div>
              {!job.autoApply && (
                <span className="text-note text-ink-meta shrink-0 @max-xl/main:hidden">
                  Auto Apply can&apos;t fill this one
                </span>
              )}
              {job.match != null && <MatchBadge score={job.match} />}
            </li>
          ))}
        </ul>
      </Card>
      {pickedNow.length > 0 && (
        <SelectionBar ids={pickedNow} onClear={() => setPicked(new Set())} />
      )}
    </>
  );
}
