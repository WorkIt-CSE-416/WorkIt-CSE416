"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { CompanyLogo } from "@/components/company-logo";
import { LightningRoundedIcon } from "@/components/custom-icons";
import { ArrowRightIcon } from "@/components/icons";
import { MatchBadge } from "@/components/match-badge";
import { Checkbox } from "@/components/shadcn/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { openNextApplication } from "@/lib/autofill-extension";
import { cn } from "@/lib/cn";

import { hasApplied } from "../applied";
import { queueJob, type ApplicationStage } from "../auto-apply/actions";
import { openedNote } from "../auto-apply/opened-note";
import { ApplyButton } from "../jobs/apply-button";
import { SaveJobButton } from "../jobs/save-job-button";
import { TopMatchLink } from "./top-match-link";
import { LIST } from "./top-matches-frame";
import type { LogoSrc } from "@/lib/job-logo";

/** One Top Matches row, as ./top-matches.tsx reads it: plain data, so it can
 *  cross into this client component. `posted` is already words. */
export type TopMatchRow = {
  id: string;
  title: string;
  company: string;
  logoUrl: LogoSrc;
  applyUrl: string;
  match: number | null;
  posted: string | null;
  /** Its hiring system is one auto apply can fill (Greenhouse for now). */
  autoApply: boolean;
  stage: ApplicationStage | null;
};

/** Why a row can't be picked for the queue, in the words its row shows; null
 *  when it can. A saved job counts as no application, as the job's own Auto
 *  Apply button treats it. */
function blockedReason(row: TopMatchRow): string | null {
  if (row.stage === "queued") return "Already queued";
  if (hasApplied(row.stage)) return "Applied";
  if (row.stage === "needs_you") return "Needs you";
  if (row.stage === "skipped") return "Skipped";
  if (!row.autoApply) return "Auto Apply can't fill this one";
  return null;
}

/**
 * Top Matches' heading and rows (KAN-342), and AUTO APPLY'S PICKING MODE.
 *
 * A row is a well with the logo, the title (its link to the job posting
 * page, which makes that page's Back return here: ./top-match-link.tsx), the
 * company, the match ring and when it was posted, then Save and Apply Now,
 * the feed card's first and last steps. Tailor My Resume sat between them
 * and was taken out at the user's ask: the list is for choosing what to
 * apply to, and Tailor is one click away on the job's page.
 *
 * Auto Apply, at the heading's right beside See More Matches, turns the list
 * into a picker of the seeker's best matches that auto apply can fill
 * (`autoRows`, the same scores with ?auto_apply=true): the top list itself
 * may hold none of them, since auto apply fills Greenhouse alone for now,
 * and a picker of rows that can't be picked helped nobody. Each row gets a
 * checkbox in front, the whole row toggles it, and its buttons step aside,
 * so a click picks rather than saves or applies. A row that already has a
 * stage (queued, applied) is dimmed with it. "Add N to Queue"
 * queues every pick through the same call as a job's own Auto Apply button
 * (queueJob), then, as that button does, asks the extension to open the
 * oldest queued job in its background tab (openNextApplication). A toast
 * says how many went in, with View Queue to the Auto Apply page. The
 * seeker picks each job themself, so this keeps the rule that auto apply
 * never queues a saved job on its own (frontend/CLAUDE.md).
 */
export function TopMatchesList({
  rows,
  autoRows,
  canMarkApplied,
}: {
  rows: TopMatchRow[];
  /** The best matches auto apply can fill, for picking mode. */
  autoRows: TopMatchRow[];
  canMarkApplied: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Stages this list has changed since the server drew it: a job queued here.
  const [stages, setStages] = useState<Record<string, ApplicationStage>>({});
  const [pending, start] = useTransition();

  const withStage = (picking ? autoRows : rows).map((row) => ({
    ...row,
    stage: stages[row.id] ?? row.stage,
  }));
  const pickable = autoRows.filter(
    (row) => blockedReason({ ...row, stage: stages[row.id] ?? row.stage }) === null,
  );

  function leave() {
    setPicking(false);
    setPicked(new Set());
  }

  function toggle(id: string) {
    setPicked((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addToQueue() {
    const ids = [...picked];
    start(async () => {
      // One at a time, in the list's order, so the queue keeps the best first.
      let queued = 0;
      let failed = 0;
      const nowQueued: Record<string, ApplicationStage> = {};
      for (const id of ids) {
        const result = await queueJob(id);
        if (result.stage) {
          nowQueued[id] = result.stage;
          if (result.stage === "queued") queued++;
        } else failed++;
      }
      setStages((now) => ({ ...now, ...nowQueued }));
      leave();
      if (queued > 0) {
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
        action:
          queued > 0
            ? { label: "View Queue", onClick: () => router.push("/auto-apply") }
            : undefined,
      });
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="top-matches" className="text-subtitle text-ink font-medium">
            Top Matches
          </h2>
          <p className="text-body text-ink-meta mt-1">
            {picking
              ? "Your best matches that Auto Apply can fill. Pick the ones to queue."
              : "Your highest-scoring jobs right now."}
          </p>
        </div>
        {picking ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={leave} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={addToQueue} disabled={picked.size === 0 || pending}>
              <LightningRoundedIcon aria-hidden className="size-4" />
              {pending
                ? "Adding…"
                : picked.size === 0
                  ? "Add to Queue"
                  : `Add ${picked.size} to Queue`}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPicking(true)}
              disabled={pickable.length === 0}
              title={
                pickable.length === 0
                  ? "None of your matches can be auto applied to right now."
                  : undefined
              }
            >
              <LightningRoundedIcon aria-hidden className="size-4" />
              Auto Apply
            </Button>
            <ButtonLink href="/jobs?sort=match" variant="secondary" size="sm">
              See More Matches
              <ArrowRightIcon className="size-4" />
            </ButtonLink>
          </div>
        )}
      </div>

      <div className="relative">
        <ul
          tabIndex={0}
          aria-label="Top Matches"
          className={cn(
            LIST,
            "scrollbar-quiet focus-visible:ring-brand-ring rounded-xs focus-visible:ring-2 focus-visible:outline-none",
          )}
        >
          {withStage.map((row, i) => {
            const blocked = blockedReason(row);
            const isPicked = picked.has(row.id);
            const match = row.match != null && <MatchBadge score={row.match} />;
            const posted = row.posted && (
              <Badge variant="tag" pill>
                {row.posted}
              </Badge>
            );
            const details = (
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <CompanyLogo
                  name={row.company}
                  src={row.logoUrl}
                  className="text-note rounded-control size-10 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  {picking ? (
                    <p className="text-label text-ink @max-4xl/main:line-clamp-2 @4xl/main:truncate">
                      {row.title}
                    </p>
                  ) : (
                    <TopMatchLink
                      href={`/jobs/${encodeURIComponent(row.id)}`}
                      className="text-label text-ink hover:text-brand focus-visible:ring-brand-ring block rounded-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none @max-4xl/main:line-clamp-2 @4xl/main:truncate"
                    >
                      {row.title}
                    </TopMatchLink>
                  )}
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-note text-ink-meta min-w-0 truncate">{row.company}</span>
                    <span className="contents @4xl/main:hidden">
                      {match}
                      {posted}
                    </span>
                  </div>
                </div>
                {/* From @4xl/main the match and the posted date are columns
                    of their own (KAN-423), centred on the row's height at
                    fixed widths, so they line up down the list. Squeezed
                    on the company's line they read as one cramped run, and
                    a long company name pushed them out of line. */}
                <div className="hidden shrink-0 items-center gap-6 pl-4 @4xl/main:flex">
                  <span className="flex w-20">{match}</span>
                  <span className="flex w-36">{posted}</span>
                </div>
              </div>
            );

            return (
              // The rows rise in as the scores arrive, 30ms apart and capped
              // at the eighth, so the list never makes anyone wait.
              <li
                key={row.id}
                style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                className="animate-rise flex shrink-0"
              >
                {picking ? (
                  // The whole row is the checkbox's label, so a click anywhere
                  // on it picks; a blocked row says why instead.
                  <label
                    className={cn(
                      "bg-well rounded-card flex w-full items-center gap-3 p-3 transition-colors duration-150",
                      blocked
                        ? "cursor-not-allowed opacity-60"
                        : "hover:bg-brand-tint has-[[data-checked]]:bg-brand-tint cursor-pointer",
                    )}
                  >
                    {/* border-ink-meta, as CheckRowBox's: the vendored
                        input hairline drew the empty box at 1.19:1. */}
                    <Checkbox
                      className="border-ink-meta"
                      checked={blocked ? row.stage === "queued" : isPicked}
                      disabled={blocked !== null || pending}
                      onCheckedChange={() => toggle(row.id)}
                      aria-label={`Queue ${row.title} at ${row.company}`}
                    />
                    {details}
                    {blocked && (
                      <span className="text-note text-ink-meta shrink-0 @max-xl/main:hidden">
                        {blocked}
                      </span>
                    )}
                  </label>
                ) : (
                  <div className="bg-well rounded-card flex w-full flex-col gap-3 p-3 @xl/main:flex-row @xl/main:items-center">
                    {details}
                    {/* Save, then Apply Now: their own full-width line below
                        @xl/main, since beside the text on a phone they
                        squeezed the title to two words a line. */}
                    <div className="flex shrink-0 items-center gap-2 @max-xl/main:w-full">
                      <SaveJobButton jobId={row.id} title={row.title} stage={row.stage} />
                      <ApplyButton
                        jobId={row.id}
                        title={row.title}
                        applyUrl={row.applyUrl}
                        canMarkApplied={canMarkApplied}
                        applied={hasApplied(row.stage)}
                        className="whitespace-nowrap @max-xl/main:flex-1"
                      />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <span
          aria-hidden="true"
          className="from-panel pointer-events-none absolute right-0 bottom-0 left-0 hidden h-8 bg-linear-to-t to-transparent @4xl/main:block"
        />
      </div>
    </>
  );
}
