import { AppWindow, Eye, PenLine, Send, SkipForward, TriangleAlert, Zap } from "lucide-react";
import type { ComponentType } from "react";

import { CompanyLogo } from "@/components/company-logo";
import { ClockIcon, SparkleIcon } from "@/components/icons";
import { MatchBadge } from "@/components/match-badge";
import { Reflow } from "@/components/reflow";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { showRunTab } from "@/lib/autofill-extension";
import { cn } from "@/lib/cn";
import type { SentResume } from "@/lib/sent-resume-actions";

import { STAGE_ICON } from "../stage-colors";
import type { RunStage } from "./actions";
import type { Application } from "./applications";
import type { StatusFilter } from "./query";
import { RemoveFromQueue } from "./remove-from-queue";

type Glyph = ComponentType<{ className?: string }>;

/** Where one application stands in the pipeline. The order a job moves
 *  through: queued, browser (open in the run's Chrome tab), tailoring,
 *  filling, then review or failed, approved (WorkIt Desktop submitting
 *  it), then applied or skipped. Browser comes from the extension
 *  (./live-activity.tsx) and tailoring is the runner's live state, for when
 *  it reports it; the rest are stored (job_applications.stage), filling,
 *  review and approved by WorkIt Desktop (KAN-323). */
export type ActivityStatus =
  | "queued"
  | "browser"
  | "tailoring"
  | "filling"
  | "review"
  | "approved"
  | "failed"
  | "skipped"
  | "applied";

export type ActivityItem = {
  id: string;
  role: string;
  company: string;
  /** The job posting's logo URL; its initials when null. */
  logoUrl: string | null;
  status: ActivityStatus;
  /** A line under the status, only where it says more than the badge: what
   *  went wrong, where the job is open, or that its posting closed. */
  detail: string | null;
  /** The Jobs page's match score (0-100); null when it has none. */
  match: number | null;
  /** When it joined the list, queued or marked applied: an ISO instant,
   *  and the queue's order. */
  addedAt: string;
  appliedAt: string | null;
  /** The job posting's own page; the review's title links it. None once
   *  closed. */
  href?: string;
  /** The resume it went out with, once applied (KAN-267). */
  sentResume: SentResume | null;
};

/** Each stored stage's status, and the line it needs under its badge. */
const STAGE_ROW: Record<RunStage, { status: ActivityStatus; detail: string | null }> = {
  queued: { status: "queued", detail: null },
  filling: { status: "filling", detail: null },
  review: { status: "review", detail: null },
  approved: { status: "approved", detail: null },
  needs_you: { status: "failed", detail: "Finish it on the job's page" },
  skipped: { status: "skipped", detail: null },
  applied: { status: "applied", detail: null },
};

/** A stored application as its Live Activity row. */
export function activityOf(application: Application<RunStage>): ActivityItem {
  const { job, stage, open } = application;
  const { status, detail } = STAGE_ROW[stage];
  return {
    id: job.id,
    role: job.title,
    company: job.company,
    logoUrl: job.logo_url,
    status,
    // A closed one waits on nothing: its page is gone.
    detail: open ? detail : "Job posting closed",
    match: application.match ?? null,
    addedAt: application.added_at,
    appliedAt: application.applied_at,
    href: open ? `/jobs/${job.id}` : undefined,
    sentResume: application.sent_resume ?? null,
  };
}

/**
 * COLOURS FOLLOW THE BADGE TONES' KINDS (ui/badge.tsx), and Applied keeps its
 * stage's violet (../stage-colors.ts), so "Applied" reads the same here as on
 * the Applications page:
 *
 *   queued, skipped              inert grey   not begun, or set aside: nothing owed
 *   browser, tailoring, filling,
 *   approved                     advanced     in flight: WorkIt is doing the work
 *   review, failed               warning      halted, waiting on the seeker
 *   applied                      brand        the Applied stage
 *
 * Each badge leads with its status's glyph, so a status reads by shape as
 * well as colour (asked for 2026-10-20): a clock for Queued, a window for
 * Working in Browser, the AI sparkle for Tailoring Resume, a pen for
 * Filling, a paper plane for Submitting, an eye for Needs Review, a warning for Needs You, the
 * Applied stage's own briefcase (../stage-colors.ts), a skip for Skipped.
 *
 * `group` is the Status filter's option a status belongs to; `rank` is the inbox order, what needs the seeker first.
 */
export const STATUS: Record<
  ActivityStatus,
  {
    Icon: Glyph;
    label: string;
    tone: BadgeTone;
    dot: string;
    group: StatusFilter;
    rank: number;
  }
> = {
  review: {
    Icon: Eye,
    label: "Needs Review",
    tone: "warning",
    dot: "bg-warning-strong",
    group: "needs_you",
    rank: 0,
  },
  failed: {
    Icon: TriangleAlert,
    label: "Needs You",
    tone: "warning",
    dot: "bg-warning-strong",
    group: "needs_you",
    rank: 0,
  },
  browser: {
    Icon: AppWindow,
    label: "Working in Browser",
    tone: "advanced",
    dot: "bg-advanced",
    group: "progress",
    rank: 1,
  },
  tailoring: {
    Icon: SparkleIcon,
    label: "Tailoring Resume",
    tone: "advanced",
    dot: "bg-advanced",
    group: "progress",
    rank: 1,
  },
  filling: {
    Icon: PenLine,
    label: "Filling",
    tone: "advanced",
    dot: "bg-advanced",
    group: "progress",
    rank: 1,
  },
  approved: {
    Icon: Send,
    label: "Submitting",
    tone: "advanced",
    dot: "bg-advanced",
    group: "progress",
    rank: 1,
  },
  queued: {
    Icon: ClockIcon,
    label: "Queued",
    tone: "inert",
    dot: "bg-ink-meta",
    group: "queued",
    rank: 2,
  },
  applied: {
    Icon: STAGE_ICON.applied,
    label: "Applied",
    tone: "brand",
    dot: "bg-brand",
    group: "applied",
    rank: 3,
  },
  skipped: {
    Icon: SkipForward,
    label: "Skipped",
    tone: "inert",
    dot: "bg-ink-faint",
    group: "skipped",
    rank: 4,
  },
};

/** The Status filter's options: one per group, its glyph in the text
 *  colour its badges share, as the Applications page's Status options lead
 *  with their stage's glyph. In Progress takes Auto Apply's own glyph:
 *  it is the run at work. */
export const GROUPS: Record<StatusFilter, { label: string; Icon: Glyph; ink: string }> = {
  queued: { label: "Queued", Icon: ClockIcon, ink: "text-ink-meta" },
  progress: { label: "In Progress", Icon: Zap, ink: "text-advanced" },
  needs_you: { label: "Needs You", Icon: TriangleAlert, ink: "text-warning" },
  applied: { label: "Applied", Icon: STAGE_ICON.applied, ink: "text-brand" },
  skipped: { label: "Skipped", Icon: SkipForward, ink: "text-ink-meta" },
};

export const IN_FLIGHT: ActivityStatus[] = ["browser", "tailoring", "filling", "approved"];

/** The inbox's order: what needs the seeker first, then in flight, the
 *  queue, applied, skipped (STATUS's `rank`); queue order (oldest added
 *  first) within each, so the job the run takes next is at the top of the
 *  queued ones. */
export function inboxOrder(items: ActivityItem[]) {
  return [...items].sort(
    (a, b) =>
      STATUS[a.status].rank - STATUS[b.status].rank ||
      Date.parse(a.addedAt) - Date.parse(b.addedAt),
  );
}

/**
 * Live Activity's list, the Inbox's left half (KAN-323, chosen from the
 * WorkIt Desktop prototypes): one row per job posting in one white card,
 * each the logo, the role over its company, and its status badge, with a
 * line under it where the status needs one. A click on a row shows its
 * application on the right (./review-pane.tsx); the row shown is marked
 * selected. It replaced KAN-285's table, whose dates and sorts the review
 * side has no room beside.
 *
 * A queued row keeps its cross that takes it out of the queue
 * (./remove-from-queue.tsx), and the row open in the extension's tab its
 * window glyph that goes to that tab: each sits beside the row's button,
 * never inside it, since a button cannot hold a button.
 *
 * A row in flight rings out from its dot, three times and then rests
 * (`animate-status-ping`): a dot that never stops is the one thing on screen
 * the eye cannot leave alone.
 */
export function ActivityList({
  items,
  selected,
  onSelect,
}: {
  items: ActivityItem[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="divide-border-subtle divide-y">
      {items.map((item, i) => (
        <Reflow key={item.id}>
          <Row
            item={item}
            index={i}
            selected={item.id === selected}
            onSelect={() => onSelect(item.id)}
          />
        </Reflow>
      ))}
    </ul>
  );
}

function Row({
  item,
  index,
  selected,
  onSelect,
}: {
  item: ActivityItem;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = STATUS[item.status];
  // Fades in down the list on arrival, 25ms apart, as the Applications
  // list's rows do.
  const style = { animationDelay: `${Math.min(index, 10) * 25}ms` };
  return (
    <li
      className={cn(
        "animate-fade flex items-center gap-1 pr-2 transition-colors",
        selected ? "bg-selected" : "hover:bg-hover",
      )}
      style={style}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className="focus-visible:ring-brand-ring flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
      >
        <CompanyLogo
          name={item.company}
          src={item.logoUrl}
          className="text-meta size-8 shrink-0 rounded"
        />
        <div className="min-w-0 flex-1">
          <p className="text-label text-ink truncate font-semibold" title={item.role}>
            {item.role}
          </p>
          <p className="text-note text-ink-meta truncate" title={item.company}>
            {item.company}
          </p>
          {item.detail && (
            <p className="text-note text-ink-meta truncate" title={item.detail}>
              {item.detail}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="flex items-center gap-2">
            {IN_FLIGHT.includes(item.status) && (
              <span
                aria-hidden="true"
                className={cn("relative size-1.5 shrink-0 rounded-full", status.dot)}
              >
                <span
                  className={cn("animate-status-ping absolute inset-0 rounded-full", status.dot)}
                />
              </span>
            )}
            <Badge tone={status.tone}>
              <status.Icon aria-hidden className="mr-1 size-3.5 shrink-0" />
              {status.label}
            </Badge>
          </span>
          {item.match != null && <MatchBadge score={item.match} />}
        </div>
      </button>
      <div className="flex w-8 shrink-0 justify-center">
        {item.status === "queued" ? (
          <RemoveFromQueue jobId={item.id} role={item.role} company={item.company} />
        ) : item.status === "browser" ? (
          <IconButton
            label={`Go to the tab with ${item.role}`}
            tooltip="Go to the tab"
            className="size-8"
            onClick={() => void showRunTab()}
          >
            <AppWindow aria-hidden className="size-4" />
          </IconButton>
        ) : null}
      </div>
    </li>
  );
}
