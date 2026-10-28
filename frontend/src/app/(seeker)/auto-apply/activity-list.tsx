import {
  AppWindowIcon,
  EyeIcon,
  PencilLineIcon,
  SkipForwardIcon,
  WarningIcon,
} from "@phosphor-icons/react/ssr";
import { LightningRoundedIcon } from "@/components/custom-icons";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

import { ClickableRow } from "@/components/clickable-row";
import { CompanyLogo } from "@/components/company-logo";
import { ClockIcon, PencilIcon, SortIcon, SparkleIcon } from "@/components/icons";
import { MatchBadge } from "@/components/match-badge";
import { Reflow } from "@/components/reflow";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/table";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { Card } from "@/components/ui/card";
import { showRunTab } from "@/lib/autofill-extension";
import { cn } from "@/lib/cn";

import { LocalDate } from "../local-time";
import { STAGE_ICON } from "../stage-colors";
import type { RunStage } from "./actions";
import type { Application } from "./applications";
import type { Sort, StatusFilter } from "./query";
import { MarkApplied } from "./mark-applied";
import { RemoveFromQueue } from "./remove-from-queue";

type Glyph = ComponentType<{ className?: string }>;

/** Where one application stands in the pipeline. The order a job moves
 *  through: queued, browser (open in the run's Chrome tab), tailoring,
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
  /** The job posting's own page; the whole row opens it. None once closed. */
  href?: string;
  /** The resume a queued job will go out with (./page.tsx): the student's
   *  pick, else the rule's; null when it would go with none. Up Next shows
   *  it. */
  resume?: string | null;
  /** That resume as the picker keys it, "built:<id>" or "uploaded:<id>", so
   *  Up Next's resume picker (./resume-dialog.tsx) opens on it. */
  resumeKey?: string | null;
};

/** Each stored stage's status, and the line it needs under its badge. */
const STAGE_ROW: Record<RunStage, { status: ActivityStatus; detail: string | null }> = {
  queued: { status: "queued", detail: null },
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
  };
}

/**
 * COLOURS FOLLOW THE BADGE TONES' KINDS (ui/badge.tsx), and Applied keeps its
 * stage's violet (../stage-colors.ts), so "Applied" reads the same here as on
 * the Applications page:
 *
 *   queued, skipped              inert grey   not begun, or set aside: nothing owed
 *   browser, tailoring, filling  advanced     in flight: WorkIt is doing the work
 *   review, failed               warning      halted, waiting on the seeker
 *   applied                      brand        the Applied stage
 *
 * Each badge leads with its status's glyph, so a status reads by shape as
 * well as colour (asked for 2026-10-20): a clock for Queued, a window for
 * Working in Browser, the AI sparkle for Tailoring Resume, a pen for
 * Autofilling, an eye for Needs Review, a warning for Couldn't Finish, the
 * Applied stage's own briefcase (../stage-colors.ts), a skip for Skipped.
 *
 * `group` is the Status filter's option a status belongs to; `rank` is the Status sort, what needs the seeker first.
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
    Icon: EyeIcon,
    label: "Needs Review",
    tone: "warning",
    dot: "bg-warning-strong",
    group: "needs_you",
    rank: 0,
  },
  failed: {
    Icon: WarningIcon,
    label: "Couldn't Finish",
    tone: "warning",
    dot: "bg-warning-strong",
    group: "needs_you",
    rank: 0,
  },
  browser: {
    Icon: AppWindowIcon,
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
    Icon: PencilLineIcon,
    label: "Autofilling",
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
    Icon: SkipForwardIcon,
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
  progress: { label: "In Progress", Icon: LightningRoundedIcon, ink: "text-advanced" },
  needs_you: { label: "Needs You", Icon: WarningIcon, ink: "text-warning" },
  applied: { label: "Applied", Icon: STAGE_ICON.applied, ink: "text-brand" },
  skipped: { label: "Skipped", Icon: SkipForwardIcon, ink: "text-ink-meta" },
};

const IN_FLIGHT: ActivityStatus[] = ["browser", "tailoring", "filling"];

/** What each sort orders by; null sorts last, whichever way it runs. */
const SORT_VALUE: Record<Sort, (item: ActivityItem) => string | number | null> = {
  queue: (item) => Date.parse(item.addedAt),
  company: (item) => `${item.company}\u0000${item.role}`.toLowerCase(),
  status: (item) => STATUS[item.status].rank,
  match: (item) => item.match,
  applied: (item) => (item.appliedAt ? Date.parse(item.appliedAt) : null),
};

/** Which way each sort runs: true is largest first. */
const SORT_DESC: Record<Sort, boolean> = {
  queue: false,
  company: false,
  status: false,
  match: true,
  applied: true,
};

/** `items` in `sort`'s order. Stable, so ties keep the queue order. */
export function sortItems(items: ActivityItem[], sort: Sort) {
  const value = SORT_VALUE[sort];
  const sign = SORT_DESC[sort] ? -1 : 1;
  return [...items].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
    return (x < y ? -1 : x > y ? 1 : 0) * sign;
  });
}

/** The table's columns: a width each but Role, which takes the rest. */
const COLUMNS: { id: string; label: string; sort?: Sort; hint?: string; width?: string }[] = [
  { id: "role", label: "Role", sort: "company", hint: "Sort by company, A to Z" },
  {
    id: "status",
    label: "Status",
    sort: "status",
    hint: "Sort by status, what needs you first",
    // The longest badge, Working in Browser with its glyph and ringing
    // dot, is about 151px.
    width: "w-48",
  },
  { id: "match", label: "Match", sort: "match", hint: "Sort by match, best first", width: "w-26" },
  {
    id: "added",
    label: "Date Added",
    sort: "queue",
    hint: "Sort in queue order, oldest first",
    width: "w-30",
  },
  {
    id: "applied",
    label: "Date Applied",
    sort: "applied",
    hint: "Sort by date applied, latest first",
    width: "w-30",
  },
  { id: "action", label: "Actions", width: "w-16" },
];

/** Up Next's columns (variant "queue"): the resume each job will go out
 *  with in place of Date Applied, which a queued job never has, and no
 *  sorting, since the queue's order is the order the extension takes. */
const QUEUE_COLUMNS: typeof COLUMNS = [
  { id: "role", label: "Role" },
  { id: "status", label: "Status", width: "w-48" },
  { id: "resume", label: "Resume", width: "w-56" },
  { id: "match", label: "Match", width: "w-26" },
  { id: "added", label: "Date Added", width: "w-30" },
  { id: "action", label: "Actions", width: "w-16" },
];

const TH = "px-4 text-note text-ink-meta font-medium";
const TD = "px-4 py-3 text-note text-ink";
/** Every column but Role is centred, heading and cell (asked for
 *  2026-10-20): each holds one short value under its heading. */
const CENTER = "text-center";
/** Role is frozen at the left while the rest scrolls, from 672px of page up,
 *  as on the Applications list (applications/list.tsx says why not below). */
const FROZEN =
  "z-1 bg-panel @2xl/main:sticky @2xl/main:left-0 @2xl/main:shadow-[1px_0_0_var(--color-border-subtle)]";

/**
 * Live Activity's table (KAN-285): one row per job posting, in one white
 * card with 12px grey headings and rules between rows, the Applications
 * list's frame (applications/list.tsx). Columns: Role (the logo, then the
 * role over its company), Status, Match, Date Added, Date Applied, and
 * Actions at the right end.
 *
 * Every column but Role is centred. A row with an `href` (its job posting
 * is still open) opens it on a click anywhere (components/clickable-row.tsx);
 * the role is its link. Actions is a narrow column of icon buttons, to save
 * width: a queued row's cross takes it out of the queue
 * (./remove-from-queue.tsx), and the row open in the extension's tab has a
 * window glyph that goes to that tab; the row leaves clicks on a button to
 * the button.
 *
 * A heading sorts the table (`onSort`), each one way, as the Applications
 * list's headings do; the sort in force says so in aria-sort and its chevron.
 * It scrolls sideways under 864px rather than squeezing the role.
 *
 * A row in flight rings out from its dot, three times and then rests
 * (`animate-status-ping`): a dot that never stops is the one thing on screen
 * the eye cannot leave alone.
 */
export function ActivityTable({
  items,
  sort,
  onSort,
  variant = "history",
  onResume,
}: {
  items: ActivityItem[];
  sort: Sort;
  onSort: (sort: Sort) => void;
  /** "queue": Up Next's columns (QUEUE_COLUMNS); "history": the rest. */
  variant?: "queue" | "history";
  /** Up Next's resume cell is a button that opens this row's resume picker. */
  onResume?: (item: ActivityItem) => void;
}) {
  const columns = variant === "queue" ? QUEUE_COLUMNS : COLUMNS;
  return (
    <Card padding="none" className="mt-3 overflow-hidden">
      <Table className="min-w-[54rem] table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => {
              const active = column.sort != null && column.sort === sort;
              const direction = column.sort && SORT_DESC[column.sort] ? "desc" : "asc";
              return (
                <TableHead
                  key={column.id}
                  aria-sort={
                    active ? (direction === "asc" ? "ascending" : "descending") : undefined
                  }
                  className={cn(TH, column.width, column.id === "role" ? FROZEN : CENTER)}
                >
                  {column.sort ? (
                    <SortButton
                      label={column.label}
                      hint={column.hint}
                      active={active}
                      direction={direction}
                      onClick={() => onSort(column.sort!)}
                    />
                  ) : column.id === "action" ? (
                    // Actions is named for a screen reader only: the column
                    // holds one icon button with its own tooltip, and the
                    // word would not fit its 64px.
                    <span className="sr-only">{column.label}</span>
                  ) : (
                    column.label
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>

        {/* Not a live region: a sort or a filter redraws every row, and a
            screen reader read them all aloud (KAN-285 review). No status
            changes in place yet; Start and Remove say what they did. */}
        <TableBody>
          {items.map((item, i) => (
            <Reflow key={item.id}>
              <Row item={item} index={i} variant={variant} onResume={onResume} />
            </Reflow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function Row({
  item,
  index,
  variant,
  onResume,
}: {
  item: ActivityItem;
  index: number;
  variant: "queue" | "history";
  onResume?: (item: ActivityItem) => void;
}) {
  const status = STATUS[item.status];
  const cells: ReactNode = (
    <>
      <TableCell className={cn(TD, FROZEN, "group-hover/row:bg-hover transition-colors")}>
        <div className="flex min-w-0 items-center gap-3">
          <CompanyLogo
            name={item.company}
            src={item.logoUrl}
            className="text-meta size-8 shrink-0 rounded"
          />
          <div className="min-w-0">
            {item.href ? (
              <Link
                href={item.href}
                title={item.role}
                className="text-label text-ink hover:text-brand focus-visible:ring-brand-ring block truncate rounded-xs font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
              >
                {item.role}
              </Link>
            ) : (
              <p className="text-label text-ink truncate font-semibold" title={item.role}>
                {item.role}
              </p>
            )}
            <p className="text-note text-ink-meta truncate" title={item.company}>
              {item.company}
            </p>
          </div>
        </div>
      </TableCell>

      <TableCell className={cn(TD, CENTER, "overflow-hidden")}>
        <div className="flex items-center justify-center gap-2">
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
        </div>
        {item.detail && (
          <p className="text-note text-ink-meta mt-1 truncate" title={item.detail}>
            {item.detail}
          </p>
        )}
      </TableCell>

      {variant === "queue" && (
        <TableCell className={cn(TD, CENTER, "overflow-hidden py-0")}>
          {onResume ? (
            // A button, so the row's own click (it opens the job) leaves it
            // alone (components/clickable-row.tsx).
            <button
              type="button"
              onClick={() => onResume(item)}
              title={item.resume ? `${item.resume}: change resume` : "Choose a resume"}
              className="text-note hover:text-brand hover:border-brand-ring focus-visible:ring-brand-ring border-border-subtle inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className={cn("truncate", item.resume ? "text-ink" : "text-ink-meta")}>
                {item.resume ?? "Choose a resume"}
              </span>
              <PencilIcon aria-hidden className="text-ink-meta size-3.5 shrink-0" />
            </button>
          ) : item.resume ? (
            <span className="block truncate" title={item.resume}>
              {item.resume}
            </span>
          ) : (
            <span className="text-ink-meta">No resume</span>
          )}
        </TableCell>
      )}

      <TableCell className={cn(TD, CENTER)}>
        {item.match != null ? (
          <MatchBadge score={item.match} />
        ) : (
          <span className="text-ink-meta">Not scored</span>
        )}
      </TableCell>

      <TableCell className={cn(TD, CENTER)}>
        <LocalDate at={item.addedAt} />
      </TableCell>

      {variant === "history" && (
        <TableCell className={cn(TD, CENTER, !item.appliedAt && "text-ink-meta")}>
          {item.appliedAt ? <LocalDate at={item.appliedAt} /> : "Not yet"}
        </TableCell>
      )}

      <TableCell className={cn(TD, CENTER, "py-0")}>
        {item.status !== "applied" && item.status !== "skipped" && (
          <MarkApplied jobId={item.id} role={item.role} />
        )}
        {item.status === "queued" ? (
          <RemoveFromQueue jobId={item.id} role={item.role} company={item.company} />
        ) : item.status === "browser" ? (
          <IconButton
            label={`Go to the tab with ${item.role}`}
            tooltip="Go to the tab"
            className="size-8"
            onClick={() => void showRunTab(item.id)}
          >
            <AppWindowIcon aria-hidden className="size-4" />
          </IconButton>
        ) : null}
      </TableCell>
    </>
  );

  // Fades in down the table on arrival, 25ms apart, as the Applications
  // list's rows do; a row cannot rise (its transform does not paint).
  const style = { animationDelay: `${Math.min(index, 10) * 25}ms` };
  return item.href ? (
    <ClickableRow href={item.href} className="hover:bg-hover animate-fade" style={style}>
      {cells}
    </ClickableRow>
  ) : (
    <TableRow className="group/row animate-fade hover:bg-transparent" style={style}>
      {cells}
    </TableRow>
  );
}

/** A heading that sorts: its label and a chevron, brand while in force. */
function SortButton({
  label,
  hint,
  active,
  direction,
  onClick,
}: {
  label: string;
  hint?: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className="hover:text-ink focus-visible:ring-brand-ring inline-flex min-w-0 items-center gap-1 rounded-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
    >
      <span className="truncate">{label}</span>
      {/* Keyed on its state, so the glyph pops in when the column takes the
          sort rather than swapping in place. */}
      <SortIcon
        key={active ? direction : "none"}
        className={cn("animate-pop size-3.5 shrink-0", active ? "text-brand" : "text-ink-faint")}
        direction={active ? direction : undefined}
      />
    </button>
  );
}
