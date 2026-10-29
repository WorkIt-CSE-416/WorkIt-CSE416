"use client";

import { CheckIcon, PencilLineIcon, WarningIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { ClickableRow } from "@/components/clickable-row";
import { CompanyLogo } from "@/components/company-logo";
import { ChevronDownIcon, PencilIcon, PlusIcon } from "@/components/icons";
import { MatchBadge } from "@/components/match-badge";
import { Reflow } from "@/components/reflow";
import { Checkbox } from "@/components/shadcn/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { BatchTabState } from "@/lib/autofill-extension";
import { cn } from "@/lib/cn";

import { LocalDate } from "../local-time";
import { CENTER, FROZEN, TD, TH, type ActivityItem } from "./activity-list";
import { RowMenu } from "./row-menu";

/** Whether WorkIt has started an Up Next job: In Progress (opened in a
 *  batch tab, whether the tab is still open or not) or Queued (not yet).
 *  Two groups since 2026-10-29: a third, Incomplete, held started jobs
 *  whose tab was closed, and split one kind of job in two (it was named
 *  Unfinished, and In Your Tabs and Waiting were the others, before that). */
export type QueueGroup = "progress" | "queued";

/** An Up Next row: the job, its batch tab's state (`tab`, null with no tab
 *  open), and the group that puts it in. */
export type QueueRow = ActivityItem & { tab: BatchTabState | null; group: QueueGroup };

/** A job's group: started once a tab is open on it, or once its fill left
 *  it needs_you (its tab since closed). */
export function groupOf(item: ActivityItem, tab: BatchTabState | null): QueueGroup {
  return tab || item.status === "failed" ? "progress" : "queued";
}

/** Whether Auto Apply can open the row: no tab open on it, and its posting open. */
export function canOpen(row: QueueRow): boolean {
  return row.tab == null && !row.closed;
}

/** The groups in the order the table shows them. A line beside each name
 *  ("Filling now, or waiting for your Submit") was cut as noise (2026-10-29):
 *  the name, the count and the rows' statuses say it. */
const GROUP_ORDER: { id: QueueGroup; label: string }[] = [
  { id: "progress", label: "In Progress" },
  { id: "queued", label: "Queued" },
];

/** A batch tab's state as the row's status: a word in its colour, with
 *  its glyph. Plain text, not a pill: the group already names the state in
 *  a pill, and two pills per row read as noise. */
const TAB_STATUS: Record<BatchTabState, { label: string; ink: string; Icon: typeof CheckIcon }> = {
  filling: { label: "Filling", ink: "text-advanced", Icon: PencilLineIcon },
  ready: { label: "Ready to Submit", ink: "text-positive-ink", Icon: CheckIcon },
  needs_you: { label: "Needs You", ink: "text-warning", Icon: WarningIcon },
  failed: { label: "Fill Failed", ink: "text-danger", Icon: WarningIcon },
  applied: { label: "Submitted", ink: "text-brand", Icon: CheckIcon },
};

const COLUMNS: { id: string; label: string; width?: string }[] = [
  { id: "role", label: "Role" },
  // "Ready to Submit · Review" with its glyph, about 200px.
  { id: "status", label: "Status", width: "w-60" },
  { id: "resume", label: "Resume", width: "w-52" },
  { id: "match", label: "Match", width: "w-24" },
  { id: "added", label: "Date Added", width: "w-28" },
  { id: "menu", label: "More", width: "w-14" },
];

/**
 * Up Next's table (./up-next.tsx): every queued job in two groups, each
 * under a heading row with its name in a pill and its count, which folds it
 * (as the Resumes page groups its list):
 *
 *   In Progress    started: open in a batch tab, with the tab's own state
 *                  (Filling, Ready to Submit, Needs You, Fill Failed), read
 *                  live from the extension (useBrowserTabs), or Needs You
 *                  once its tab closed (stage needs_you); a click opens it again
 *   Queued         not started, in the order the extension takes them
 *
 * The status says only where the job is. What it lacks shows where it is
 * fixed: no resume is an empty Choose Resume slot in the Resume cell, and
 * written questions are a link under the status to Written Answers.
 *
 * A row's status is its one action (a click goes where it is finished),
 * and the same ⋯ menu sits on every row
 * (./row-menu.tsx). Its Role cell starts with a select box, and Role's
 * heading with Select All, which unpicks every row while any is picked; a
 * box's click stops in its cell, or the row opens the job posting.
 */
export function QueueTable({
  rows,
  picked,
  onPick,
  onAction,
  onResume,
  onRemove,
}: {
  rows: QueueRow[];
  picked: ReadonlySet<string>;
  onPick: (ids: string[]) => void;
  /** The row's one action (`actionOf`). */
  onAction: (row: QueueRow) => void;
  onResume: (row: QueueRow) => void;
  onRemove: (row: QueueRow) => void;
}) {
  const [folded, setFolded] = useState<ReadonlySet<QueueGroup>>(new Set());
  const all = rows.length > 0 && rows.every((row) => picked.has(row.id));
  const some = rows.some((row) => picked.has(row.id));

  function pick(row: QueueRow, on: boolean) {
    onPick(on ? [...picked, row.id] : [...picked].filter((id) => id !== row.id));
  }

  function fold(group: QueueGroup) {
    const next = new Set(folded);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    setFolded(next);
  }

  return (
    <Card padding="none" className="mt-3 overflow-hidden">
      <Table className="min-w-[60rem] table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((column) => (
              <TableHead
                key={column.id}
                className={cn(TH, column.width, column.id === "role" ? FROZEN : CENTER)}
              >
                {column.id === "role" ? (
                  <span className="flex items-center gap-3">
                    <PickBox>
                      <Checkbox
                        className="border-ink-meta"
                        checked={all}
                        indeterminate={some && !all}
                        // As the Inbox's: a click picks every row, or unpicks while any is picked,
                        // which is how a pick is cleared (the bar has no Clear).
                        onCheckedChange={() => onPick(some ? [] : rows.map((row) => row.id))}
                        aria-label={some ? "Unselect All" : "Select All"}
                      />
                    </PickBox>
                    {column.label}
                  </span>
                ) : column.id === "menu" ? (
                  <span className="sr-only">{column.label}</span>
                ) : (
                  column.label
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          {GROUP_ORDER.map(({ id, label }) => {
            const members = rows.filter((row) => row.group === id);
            if (members.length === 0) return null;
            const open = !folded.has(id);
            return [
              <TableRow key={id} className="bg-canvas hover:bg-canvas">
                {/* The heading spans every column, so it is the button that stays at the left while the
                    table scrolls sideways: a sticky cell this wide scrolled away with the rest. */}
                <TableCell colSpan={COLUMNS.length} className="bg-canvas px-4 py-2">
                  <button
                    type="button"
                    onClick={() => fold(id)}
                    aria-expanded={open}
                    className="focus-visible:ring-brand-ring sticky left-4 flex items-center gap-2 rounded-xs focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <ChevronDownIcon
                      className={cn(
                        "text-ink-meta size-3.5 transition-transform duration-150",
                        !open && "-rotate-90",
                      )}
                    />
                    <Badge tone="neutral">{label}</Badge>
                    <span className="text-note text-ink-meta tabular-nums">{members.length}</span>
                  </button>
                </TableCell>
              </TableRow>,
              ...(open
                ? members.map((row, i) => (
                    <Reflow key={row.id}>
                      <Row
                        row={row}
                        index={i}
                        picked={picked.has(row.id)}
                        onPick={pick}
                        onAction={onAction}
                        onResume={onResume}
                        onRemove={onRemove}
                      />
                    </Reflow>
                  ))
                : []),
            ];
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function Row({
  row,
  index,
  picked,
  onPick,
  onAction,
  onResume,
  onRemove,
}: {
  row: QueueRow;
  index: number;
  picked: boolean;
  onPick: (row: QueueRow, on: boolean) => void;
  onAction: (row: QueueRow) => void;
  onResume: (row: QueueRow) => void;
  onRemove: (row: QueueRow) => void;
}) {
  const cells: ReactNode = (
    <>
      <TableCell
        className={cn(
          TD,
          FROZEN,
          "transition-colors",
          // The whole row tints while its ⋯ menu is open (`data-popup-open` on the trigger): the pointer
          // leaves for the menu, and the frozen cell alone kept its hover tint.
          picked
            ? "bg-brand-tint"
            : "group-hover/row:bg-hover [tr:has([data-popup-open])_&]:bg-hover",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <PickBox>
            <Checkbox
              className="border-ink-meta"
              checked={picked}
              onCheckedChange={(on) => onPick(row, on === true)}
              aria-label={`Select ${row.role} at ${row.company}`}
            />
          </PickBox>
          <CompanyLogo
            name={row.company}
            src={row.logoUrl}
            className="text-meta size-8 shrink-0 rounded"
          />
          <div className="min-w-0">
            {row.href ? (
              <Link
                href={row.href}
                title={row.role}
                className="text-label text-ink hover:text-brand focus-visible:ring-brand-ring block truncate rounded-xs font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
              >
                {row.role}
              </Link>
            ) : (
              <p className="text-label text-ink truncate font-semibold" title={row.role}>
                {row.role}
              </p>
            )}
            <p className="text-note text-ink-meta truncate" title={row.company}>
              {row.company}
            </p>
          </div>
        </div>
      </TableCell>

      <TableCell className={cn(TD, CENTER, "overflow-hidden")}>
        <Status row={row} onAction={onAction} />
      </TableCell>

      <TableCell className={cn(TD, CENTER, "overflow-hidden py-0")}>
        {/* A button, so the row's own click (it opens the job) leaves it alone (components/clickable-row.tsx). */}
        <button
          type="button"
          onClick={() => onResume(row)}
          title={row.resume ? `${row.resume}: change resume` : "Choose a resume"}
          className={cn(
            "text-note focus-visible:ring-brand-ring inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
            // No resume is an empty slot (dashed, grey, a plus), never a warning: the job still fills,
            // and amber is kept for what stopped. It was an amber pill, which read as a pair with
            // the amber questions link beside it.
            row.resume
              ? "border-border-subtle hover:text-brand hover:border-brand-ring"
              : "border-ink-faint text-ink-meta hover:text-brand hover:border-brand-ring border-dashed",
          )}
        >
          {!row.resume && <PlusIcon aria-hidden className="size-3.5 shrink-0" />}
          <span className={cn("truncate", row.resume && "text-ink")}>
            {row.resume ?? "Choose Resume"}
          </span>
          {row.resume && <PencilIcon aria-hidden className="text-ink-meta size-3.5 shrink-0" />}
        </button>
      </TableCell>

      <TableCell className={cn(TD, CENTER)}>
        {row.match != null ? (
          <MatchBadge score={row.match} />
        ) : (
          <span className="text-ink-faint">
            <span aria-hidden="true">–</span>
            <span className="sr-only">Not scored</span>
          </span>
        )}
      </TableCell>

      <TableCell className={cn(TD, CENTER)}>
        <LocalDate at={row.addedAt} />
      </TableCell>

      <TableCell className={cn(TD, CENTER, "py-0")}>
        {row.tab !== "applied" && <RowMenu item={row} onResume={onResume} onRemove={onRemove} />}
      </TableCell>
    </>
  );

  // Fades in down the table on arrival, 25ms apart, as the Applications list's rows do.
  const style = { animationDelay: `${Math.min(index, 10) * 25}ms` };
  return row.href ? (
    <ClickableRow
      href={row.href}
      className={cn(
        "animate-fade",
        picked
          ? "bg-brand-tint hover:bg-brand-tint"
          : "hover:bg-hover has-[[data-popup-open]]:bg-hover",
      )}
      style={style}
    >
      {cells}
    </ClickableRow>
  ) : (
    // No `group/row`: a row that opens nothing takes no hover tint (activity-list.tsx says why).
    <TableRow
      className={cn(
        "animate-fade",
        picked
          ? "bg-brand-tint hover:bg-brand-tint"
          : "has-[[data-popup-open]]:bg-hover hover:bg-transparent",
      )}
      style={style}
    >
      {cells}
    </TableRow>
  );
}

/**
 * The row's status: ONE item, never a second line, and a button where
 * there is somewhere to go. Most urgent first:
 *
 *   Posting Closed          red; nothing to open (Remove is in the ⋯ menu)
 *   N Questions to Write    amber, while any wait; Filling outranks it
 *   the tab's state         Filling (with a spinning ring), Ready to
 *                           Submit, Needs You, Fill Failed, Submitted
 *   Needs You               a started job whose tab was closed
 *   (nothing)               a queued job, whatever it holds: its group's
 *                           name says it, and its questions show once it
 *                           starts (they can be written ahead on Written
 *                           Answers)
 *
 * A click goes where the student finishes it (`onAction`, ./up-next.tsx):
 * the job's tab, opened again if it was closed.
 *
 * TOO MANY LAYERS (2026-10-29). Each row had a pill badge, then a state with
 * an action link after it ("Tab Closed · Reopen") and the questions' link on
 * a second line; the user found the layers of text cluttered. "Tab Closed"
 * said a browser detail, and Reopen and the questions' link went to the same
 * place. A place in the queue ("#1 in Queue") was cut before that: five
 * fill at once, so the order read as one at a time.
 */
function Status({ row, onAction }: { row: QueueRow; onAction: (row: QueueRow) => void }) {
  if (row.closed) {
    return (
      <span className="text-note text-danger inline-flex items-center gap-1.5 font-medium">
        <WarningIcon aria-hidden className="size-3.5 shrink-0" />
        Posting Closed
      </span>
    );
  }

  let label: string;
  let ink: string;
  let glyph: ReactNode;
  // A queued job shows only Posting Closed: its questions wait for it to start (asked for 2026-10-29),
  // though they can be written ahead on Written Answers.
  if (row.group === "queued") return null;
  if (row.questions && row.tab !== "filling" && row.tab !== "applied") {
    label = `${row.questions} ${row.questions === 1 ? "Question" : "Questions"} to Write`;
    ink = "text-warning";
    glyph = <PencilLineIcon aria-hidden className="size-3.5 shrink-0" />;
  } else if (row.tab) {
    const status = TAB_STATUS[row.tab];
    label = status.label;
    ink = status.ink;
    glyph =
      row.tab === "filling" ? (
        // A spinning ring while it fills, drawn as Tailor's run loader is; still with reduced motion.
        <span
          aria-hidden="true"
          className="border-advanced/25 border-t-advanced size-3.5 shrink-0 animate-spin rounded-full border-2 motion-reduce:animate-none"
        />
      ) : (
        <status.Icon aria-hidden className="size-3.5 shrink-0" />
      );
  } else if (row.group === "progress") {
    label = "Needs You";
    ink = "text-warning";
    glyph = <WarningIcon aria-hidden className="size-3.5 shrink-0" />;
  } else {
    return null;
  }

  return (
    // A button, so the row's own click (it opens the job) leaves it alone (components/clickable-row.tsx).
    <button
      type="button"
      onClick={() => onAction(row)}
      title={row.tab ? "Go to its tab" : "Open it again"}
      className={cn(
        "text-note focus-visible:ring-brand-ring inline-flex items-center gap-1.5 rounded-sm font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none",
        ink,
      )}
    >
      {glyph}
      {label}
    </button>
  );
}

/** A select box's square in the Role cell. Its clicks stop here: the row's
 *  own click opens the job posting (components/clickable-row.tsx), and a
 *  pick should not. */
function PickBox({ children }: { children: ReactNode }) {
  return (
    <span className="flex shrink-0 items-center" onClick={(event) => event.stopPropagation()}>
      {children}
    </span>
  );
}
