import {
  CalendarBlankIcon,
  CaretDownIcon,
  CheckIcon,
  FunnelSimpleIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react/ssr";

import { cn } from "@/lib/cn";

import { FaviconLogo } from "../../favicon-logo";
import { followedJob, matchingFeature } from "../../feature-data";
import { Label, Score, Vignette } from "./parts";

/** The Application Tracker page's deep dives: the Applications list, "Did
 *  You Apply?" after Apply Now, and an application's own page with its
 *  stage menu and Interviews & Dates. Its fourth, the sent resume, is the
 *  Resume Builder page's (`SentResumeVisual`). */

/** The tracker's five stages (applications/tracked.ts), each with a dot. */
const STAGES = {
  Saved: "bg-slate-400",
  Applied: "bg-brand",
  Interviewing: "bg-advanced",
  Offer: "bg-positive",
  Rejected: "bg-danger",
} as const;
type Stage = keyof typeof STAGES;

function StagePill({ stage }: { stage: Stage }) {
  return (
    <span className="text-ink inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium">
      <span className={cn("size-1.5 rounded-full", STAGES[stage])} />
      {stage}
    </span>
  );
}

/** The Applications list: search, the Status filter, and every saved or
 *  applied job with its stage and match. */
export function ListVisual() {
  const [spotify, stripe, , databricks, duolingo] = matchingFeature.jobs;
  const rows: { job: typeof stripe; stage: Stage; date: string }[] = [
    { job: stripe, stage: "Interviewing", date: "Applied Oct 1" },
    { job: databricks, stage: "Applied", date: "Applied Oct 3" },
    { job: duolingo, stage: "Applied", date: "Applied Oct 6" },
    { job: spotify, stage: "Saved", date: "Saved Oct 7" },
  ];
  return (
    <Vignette className="px-3">
      <div className="gloss-card rounded-2xl p-3">
        <div className="flex items-center gap-2">
          <span className="text-ink-meta flex flex-1 items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[10px] ring-1 ring-slate-900/10">
            <MagnifyingGlassIcon className="size-3.5" />
            Search applications
          </span>
          <span className="text-ink inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-semibold ring-1 ring-slate-900/10">
            <FunnelSimpleIcon className="size-3.5" />
            Status
            <CaretDownIcon className="size-3" />
          </span>
        </div>
        <div className="text-ink-muted mt-2.5 flex px-2 pb-1 text-[10px] font-semibold">
          <span className="flex-1">Role</span>
          <span className="w-[86px]">Status</span>
          <span className="w-[40px] text-right">Match</span>
        </div>
        <div className="grid gap-1">
          {rows.map(({ job, stage, date }) => (
            <div
              key={job.id}
              className="flex min-w-0 items-center rounded-xl bg-white px-2 py-1.5 ring-1 ring-slate-900/5"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <FaviconLogo domain={job.domain} className="size-7" />
                <span className="min-w-0">
                  <span className="text-ink block truncate text-[11px] font-semibold">
                    {job.title}
                  </span>
                  <span className="text-ink-meta block text-[10px]">
                    {job.company} · {date}
                  </span>
                </span>
              </span>
              <span className="w-[86px] shrink-0">
                <StagePill stage={stage} />
              </span>
              <span className="flex w-[40px] shrink-0 justify-end">
                <Score score={job.score} className="px-1.5 text-[10px]" />
              </span>
            </div>
          ))}
        </div>
      </div>
    </Vignette>
  );
}

/** "Did You Apply?", waiting behind the company's tab after Apply Now. */
export function AskedVisual() {
  return (
    <Vignette className="px-8">
      <div className="gloss-card rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <FaviconLogo domain={followedJob.domain} className="size-9" />
          <div>
            <p className="text-ink text-[14px] font-semibold">Did You Apply?</p>
            <p className="text-ink-meta text-[10px]">
              {followedJob.title} · {followedJob.company}
            </p>
          </div>
        </div>
        <Label className="mt-3">The resume you sent</Label>
        <div className="mt-1 grid gap-1">
          {["Alex_Morgan_Stripe", "Resume #2"].map((name, i) => (
            <div
              key={name}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] ring-1 ring-inset",
                i === 0
                  ? "bg-brand-tint text-brand-ink ring-brand/40 font-semibold"
                  : "text-ink bg-white ring-slate-900/10",
              )}
            >
              <span
                className={cn(
                  "grid size-3.5 place-items-center rounded-full ring-1 ring-inset",
                  i === 0 ? "bg-brand ring-brand" : "bg-white ring-slate-400",
                )}
              >
                {i === 0 && <span className="size-1.5 rounded-full bg-white" />}
              </span>
              {name}
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <span className="text-ink rounded-lg bg-white px-3 py-1.5 text-[11px] font-semibold ring-1 ring-slate-900/10">
            Not Yet
          </span>
          <span className="bg-brand rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white">
            Yes, I Applied
          </span>
        </div>
      </div>
    </Vignette>
  );
}

/** An application's own page: the stage menu open on Interviewing, and the
 *  interview added under Interviews & Dates. */
export function StageVisual() {
  return (
    <Vignette className="px-4">
      <div className="gloss-card rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <FaviconLogo domain={followedJob.domain} className="size-9" />
          <div className="min-w-0 flex-1">
            <p className="text-ink truncate text-[13px] font-semibold">{followedJob.title}</p>
            <p className="text-ink-meta text-[10px]">{followedJob.company} · Applied Oct 1</p>
          </div>
          <span className="text-ink inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold ring-1 ring-slate-900/10">
            Interviewing
            <CaretDownIcon className="size-3" />
          </span>
        </div>
        <div className="mt-4 flex gap-3">
          <div className="min-w-0 flex-1">
            <Label>Interviews &amp; Dates</Label>
            <div className="mt-1.5 flex items-center gap-2.5 rounded-xl bg-white px-2.5 py-2 ring-1 ring-slate-900/5">
              <span className="bg-advanced-tint text-advanced grid size-8 shrink-0 place-items-center rounded-lg">
                <CalendarBlankIcon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="text-ink block text-[11px] font-semibold">
                  Technical interview
                </span>
                <span className="text-ink-meta block text-[10px]">Thu, Nov 12 · 1:00 PM</span>
              </span>
            </div>
          </div>
          <div className="w-[120px] shrink-0 rounded-xl bg-white p-1 shadow-[0_14px_28px_-12px_rgb(40_20_90/0.35)] ring-1 ring-slate-900/8">
            {(Object.keys(STAGES) as Stage[]).map((stage) => (
              <p
                key={stage}
                className={cn(
                  "text-ink flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px]",
                  stage === "Interviewing" && "bg-advanced-tint font-semibold",
                )}
              >
                <span className={cn("size-1.5 rounded-full", STAGES[stage])} />
                <span className="flex-1">{stage}</span>
                {stage === "Interviewing" && <CheckIcon className="size-3" weight="bold" />}
              </p>
            ))}
          </div>
        </div>
      </div>
    </Vignette>
  );
}
