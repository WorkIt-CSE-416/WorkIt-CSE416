import Link from "next/link";

import { CompanyLogo } from "@/components/company-logo";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

import { formatPlaces } from "../jobs/format";
import type { ApplicationStage } from "./actions";
import type { Application } from "./applications";
import { RemoveFromQueue } from "./remove-from-queue";

/** Where one application stands in the pipeline. The order a job moves
 *  through: queued, browser (open in the run's Chrome window), tailoring,
 *  filling, then review or failed, then applied or skipped. Only queued,
 *  failed, skipped and applied are stored (job_applications.stage); browser
 *  comes from the extension (./live-activity.tsx), and tailoring, filling
 *  and review are the runner's live states, for when it reports them. */
export type ActivityStatus =
  "queued" | "browser" | "tailoring" | "filling" | "review" | "failed" | "skipped" | "applied";

export type ActivityItem = {
  id: string;
  role: string;
  company: string;
  /** The job posting's logo URL; its initials when null. */
  logoUrl: string | null;
  /** Null when the job posting names no place. */
  location: string | null;
  status: ActivityStatus;
  /** One line on what is happening or what went wrong. */
  detail: string;
  /** When the status last changed: an ISO instant. */
  at: string;
  /** The job posting's own page; the whole row opens it. None once closed. */
  href?: string;
};

/** Each stored stage's row: its status, and a line on what it waits on. */
const STAGE_ROW: Record<ApplicationStage, { status: ActivityStatus; detail: string }> = {
  queued: { status: "queued", detail: "Waiting for its turn" },
  needs_you: { status: "failed", detail: "Couldn't fill the form. Finish it on the job's page" },
  skipped: { status: "skipped", detail: "You skipped this one" },
  applied: { status: "applied", detail: "You applied" },
};

/** A stored application as its Live Activity row. */
export function activityOf(application: Application): ActivityItem {
  const { job, stage, open } = application;
  const { status, detail } = STAGE_ROW[stage];
  return {
    id: job.id,
    role: job.title,
    company: job.company,
    logoUrl: job.logo_url,
    location: formatPlaces(job.location_label ?? job.location),
    status,
    // A closed one waits on nothing: its page is gone.
    detail: open ? detail : "This job posting has closed",
    at: application.applied_at ?? application.added_at,
    href: open ? `/jobs/${job.id}` : undefined,
  };
}

/**
 * Live Activity's feed: one row per job posting the pipeline is working on,
 * newest change first, in one white card with rules between rows, the frame
 * the Applications list and the company Dashboard's Recent Applicants use.
 *
 * COLOURS FOLLOW THE BADGE TONES' KINDS (ui/badge.tsx), and Applied keeps its
 * stage's violet (../stage-colors.ts), so "Applied" reads the same here as on
 * the Applications board:
 *
 *   queued, skipped              inert grey   not begun, or set aside: nothing owed
 *   browser, tailoring, filling  advanced     in flight: WorkIt is doing the work
 *   review, failed               warning      halted, waiting on the seeker
 *   applied                      brand        the Applied stage
 *
 * A row with an `href` (its job posting is still open) is one link: its
 * role, stretched over the row, as on the Applications list. A queued row
 * also has a cross beside its badge that takes it out of the queue, with a
 * toast to Undo it (./remove-from-queue.tsx), above the link; no other
 * stage has one.
 *
 * A row in flight rings out from its dot, three times and then rests
 * (`animate-status-ping`, as the detail panel's next step does): a dot that
 * never stops is the one thing on screen the eye cannot leave alone.
 */
const STATUS: Record<ActivityStatus, { label: string; tone: BadgeTone; dot: string }> = {
  queued: { label: "Queued", tone: "inert", dot: "bg-ink-meta" },
  browser: { label: "Working in Browser", tone: "advanced", dot: "bg-advanced" },
  tailoring: { label: "Tailoring Resume", tone: "advanced", dot: "bg-advanced" },
  filling: { label: "Autofilling", tone: "advanced", dot: "bg-advanced" },
  review: { label: "Needs Review", tone: "warning", dot: "bg-warning-strong" },
  failed: { label: "Couldn't Finish", tone: "warning", dot: "bg-warning-strong" },
  skipped: { label: "Skipped", tone: "inert", dot: "bg-ink-faint" },
  applied: { label: "Applied", tone: "brand", dot: "bg-brand" },
};

const IN_FLIGHT: ActivityStatus[] = ["browser", "tailoring", "filling"];

/** The summary over the feed: each group's count, by the same dot colours. */
const GROUPS: { label: string; statuses: ActivityStatus[]; dot: string }[] = [
  { label: "In Progress", statuses: IN_FLIGHT, dot: "bg-advanced" },
  { label: "Needs You", statuses: ["review", "failed"], dot: "bg-warning-strong" },
  { label: "Applied", statuses: ["applied"], dot: "bg-brand" },
  { label: "Queued", statuses: ["queued"], dot: "bg-ink-meta" },
];

/** "Just now", "4 min ago", "2 hr ago". Worked out against the request's own
 *  clock on the server, so the browser draws the same words it was sent. */
function ago(at: string, now: Date) {
  const minutes = Math.floor((now.getTime() - new Date(at).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} hr ago`;
}

export function ActivityList({ items, now }: { items: ActivityItem[]; now: Date }) {
  return (
    <>
      <ul role="list" className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {GROUPS.map((group) => (
          <li key={group.label} className="text-label text-ink-muted flex items-center gap-2">
            <span aria-hidden="true" className={cn("size-2 rounded-full", group.dot)} />
            {group.label}
            <span className="text-ink font-semibold tabular-nums">
              {items.filter((item) => group.statuses.includes(item.status)).length}
            </span>
          </li>
        ))}
      </ul>

      <Card padding="none" className="mt-3 overflow-hidden">
        {/* Polite, so a status that changes once this is live is read out
            after whatever the seeker is doing, not over it. */}
        <ul role="list" aria-live="polite" className="divide-border-subtle divide-y">
          {items.map((item, i) => {
            const status = STATUS[item.status];
            const moving = IN_FLIGHT.includes(item.status);

            return (
              <li
                key={item.id}
                className={cn(
                  "animate-rise relative flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3 @md/main:flex-nowrap",
                  item.href && "hover:bg-hover transition-colors duration-150",
                )}
                style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
              >
                <CompanyLogo
                  name={item.company}
                  src={item.logoUrl}
                  className="text-meta mt-0.5 size-8 shrink-0 rounded"
                />

                <div className="min-w-0 flex-1">
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="text-label text-ink hover:text-brand focus-visible:ring-brand-ring block truncate rounded-xs transition-colors duration-150 after:absolute after:inset-0 focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {item.role}
                    </Link>
                  ) : (
                    <p className="text-label text-ink truncate">{item.role}</p>
                  )}
                  <p className="text-note text-ink-meta truncate">
                    {item.location ? `${item.company} · ${item.location}` : item.company}
                  </p>
                  <p className="text-note text-ink-muted mt-1 flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn("relative size-1.5 shrink-0 rounded-full", status.dot)}
                    >
                      {moving && (
                        <span
                          className={cn(
                            "animate-status-ping absolute inset-0 rounded-full",
                            status.dot,
                          )}
                        />
                      )}
                    </span>
                    <span className="min-w-0 truncate">{item.detail}</span>
                  </p>
                </div>

                {/* Wide, a column at the right edge. Narrow, a line of its
                    own under the text, lined up with it past the logo (32px
                    and the 12px gap), so the role keeps the row's width. */}
                <div className="flex w-full shrink-0 items-center gap-2 pl-11 @md/main:w-auto @md/main:flex-col @md/main:items-end @md/main:gap-1.5 @md/main:pl-0">
                  <div className="flex items-center gap-1">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    {item.status === "queued" && (
                      <RemoveFromQueue jobId={item.id} role={item.role} company={item.company} />
                    )}
                  </div>
                  <span className="text-note text-ink-meta">{ago(item.at, now)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
