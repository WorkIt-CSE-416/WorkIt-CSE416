"use client";

import { createColumnHelper, useTable } from "@tanstack/react-table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";

import { StatusIcon } from "@/app/(seeker)/applications/icons";
import { EllipsisIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { changeJobStatus } from "@/lib/job-actions";

import {
  DataTable,
  FEATURES,
  RowLink,
  formatDate,
  SortHeader,
  TableToolbar,
  type FilterSpec,
} from "../table";
import { CloseJobDialog } from "./close-job-dialog";
import { STATUS_TONE, STATUSES, type Posting } from "./data";

/**
 * The postings table.
 *
 * Columns are a module constant because they feed TanStack's row models, and
 * a new array identity on each render rebuilds every model that depends on
 * it. The rows arrive as a prop from the server page, which keeps the same
 * array for the life of the render, so they need no memo either.
 *
 * NO SELECTION COLUMN. Nothing acts on a set of postings yet, so a checkbox
 * per row only promised a bulk action that did not exist and cost the column
 * on a table that already scrolls on a phone. Put SelectAllHeader and
 * SelectRowCell back from ../table when a bulk Pause or Close lands, with
 * that action beside the toolbar's "N selected".
 */
const helper = createColumnHelper<typeof FEATURES, Posting>();

const columns = helper.columns([
  helper.accessor("role", {
    header: ({ column }) => <SortHeader column={column}>Role</SortHeader>,
    sortFn: "alphanumeric",
    /* The only text filter on this screen, so the toolbar's search box drives
     * this column. Team and location are searched through it too — see the
     * accessor's filter override below. */
    filterFn: "includesString",
    cell: ({ row }) => (
      /* The cap, not the column, is what stops a long title stretching the
         table. Past it the text trails off. */
      <div className="max-w-[22rem] min-w-0">
        <RowLink href={`/company/jobs/${row.original.id}/edit`} className="text-label">
          {row.original.role}
        </RowLink>
        <p className="text-note text-ink-meta mt-0.5 truncate">
          {[row.original.team, row.original.location].filter(Boolean).join(" · ")}
        </p>
      </div>
    ),
  }),

  helper.accessor("status", {
    meta: { className: "text-center" },
    header: ({ column }) => (
      <SortHeader column={column} align="center">
        Status
      </SortHeader>
    ),
    sortFn: "alphanumeric",
    /* arrIncludesSome rather than equalsString: the toolbar hands over an
     * array so a multi-select dropdown later needs no change here. */
    filterFn: "arrIncludesSome",
    cell: ({ getValue }) => {
      const status = getValue();

      return (
        <Badge variant="status" tone={STATUS_TONE[status]}>
          {status}
        </Badge>
      );
    },
  }),

  helper.accessor("applicants", {
    meta: { className: "text-center" },
    header: ({ column }) => (
      <SortHeader column={column} align="center">
        Applicants
      </SortHeader>
    ),
    sortFn: "basic",
    /* Descending first. A count column is almost always opened to find the
     * biggest number, and making the first click give the smallest wastes it. */
    sortDescFirst: true,
    cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span>,
  }),

  helper.accessor("unreviewed", {
    meta: { className: "text-center" },
    header: ({ column }) => (
      <SortHeader column={column} align="center">
        Unreviewed
      </SortHeader>
    ),
    sortFn: "basic",
    sortDescFirst: true,
    cell: ({ getValue }) => {
      const count = getValue();

      return (
        <span
          className={cn(
            "tabular-nums",
            /* A zero is quieter by weight, in ink-meta (5.59:1 on white),
               never in a grey too faint to read: ink-faint is 3.11:1, under
               the 4.5:1 text needs, and this is a number people scan for. */
            count > 0 ? "text-ink font-semibold" : "text-ink-meta",
          )}
        >
          {count}
        </span>
      );
    },
  }),

  helper.accessor("posted", {
    meta: { className: "text-center" },
    header: ({ column }) => (
      <SortHeader column={column} align="center">
        Posted
      </SortHeader>
    ),
    /* datetime, not alphanumeric. ISO strings happen to sort correctly as
     * text, which is exactly why this is worth stating: the day the fixture
     * becomes a real date the string comparison would start lying, silently. */
    sortFn: "datetime",
    cell: ({ getValue }) => <PostedDate iso={getValue()} />,
  }),

  helper.display({
    id: "actions",
    meta: { className: "w-px text-right" },
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => <RowActions posting={row.original} />,
  }),
]);

/**
 * The "⋯" menu at the end of a row: what a recruiter does to a job without
 * opening it. An Open job can be paused, a Paused one resumed, and either
 * closed; a Draft was never live and a Closed one is final, so they offer
 * Edit alone. Pause and Resume act at once, since Resume undoes Pause; only
 * Close asks first.
 *
 * The trigger is IconButton (KAN-582), as Up Next's row menu is: ink at rest
 * and a 32px box, where a hand-built one was grey and 28px. z-10 lifts it
 * above <RowLink>'s row-wide overlay, or opening the menu would open the job.
 *
 * A Pause or Resume says how it went in a toast (KAN-562), never in the row:
 * the column is sized to its content (`w-px`), so a sentence there wrapped
 * one word per line, and the two words that stood in for it put the reason
 * in a tooltip behind a tab stop. A done one offers Undo, the other status,
 * whose own toast offers none; a failed one gives the API's reason and
 * Retry.
 */
function RowActions({ posting }: { posting: Posting }) {
  const [isClosing, setIsClosing] = useState(false);
  const [isChanging, startChanging] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const isLive = posting.status === "Open" || posting.status === "Paused";

  /** Sets the status and says so; `undo` offers the other one in the toast. */
  async function change(status: "published" | "paused", undo: boolean) {
    const done = status === "paused" ? "paused" : "resumed";
    const result = await changeJobStatus(posting.id, status);
    if (result.error) {
      toast.show({
        message: `${posting.role} couldn't be ${done}. ${result.error}`,
        action: { label: "Retry", onClick: () => change(status, undo) },
      });
      return;
    }
    // Re-runs the server page, so the row comes back with its new status.
    router.refresh();
    toast.show({
      message: `${posting.role} is ${done}.`,
      ...(undo && {
        action: {
          label: "Undo",
          onClick: () => change(status === "paused" ? "published" : "paused", false),
        },
      }),
    });
  }

  function setStatus(status: "published" | "paused") {
    startChanging(() => change(status, true));
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton
              label={`Actions for ${posting.role}`}
              tooltip="More actions"
              className="z-10 size-8"
            >
              <EllipsisIcon className="size-4" />
            </IconButton>
          }
        />

        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem render={<Link href={`/company/jobs/${posting.id}/edit`} />}>
            Edit
          </DropdownMenuItem>
          {isLive && (
            <>
              {posting.status === "Open" ? (
                <DropdownMenuItem disabled={isChanging} onClick={() => setStatus("paused")}>
                  Pause
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled={isChanging} onClick={() => setStatus("published")}>
                  Resume
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setIsClosing(true)}>
                Close Job
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <CloseJobDialog
        jobId={posting.id}
        title={posting.role}
        open={isClosing}
        onOpenChange={setIsClosing}
        // Re-runs the server page, so the row comes back with its new status.
        onClosed={() => router.refresh()}
      />
    </>
  );
}

const FILTERS: FilterSpec[] = [
  { columnId: "status", label: "Status", Icon: StatusIcon, options: STATUSES },
];

/**
 * `created_at` is a full timestamp, so the calendar day it falls on depends
 * on the viewer's timezone, which only the browser knows. The server renders
 * the UTC day (formatDate), and the browser swaps in its own day after
 * hydration: useSyncExternalStore's server snapshot is what keeps that from
 * being a hydration mismatch, where suppressHydrationWarning would just keep
 * the server's text. A date-only string has no timezone to apply, so it
 * stays as written.
 */
const noSubscription = () => () => {};

function PostedDate({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    noSubscription,
    () =>
      iso.length === 10
        ? formatDate(iso)
        : new Date(iso).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
    () => formatDate(iso),
  );

  return <span className="text-ink-meta whitespace-nowrap">{text}</span>;
}

export function JobsTable({ postings, empty }: { postings: Posting[]; empty: string }) {
  const table = useTable({ features: FEATURES, columns, data: postings });

  return (
    <div className="flex flex-col gap-4">
      <TableToolbar
        table={table}
        searchColumnId="role"
        searchPlaceholder="Search roles"
        searchLabel="Search Roles"
        filters={FILTERS}
      />
      <DataTable table={table} empty={empty} />
    </div>
  );
}
