"use client";

import { createColumnHelper, useTable } from "@tanstack/react-table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { EllipsisIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Badge } from "@/components/ui/badge";

import {
  DataTable,
  FEATURES,
  RowLink,
  formatDate,
  SelectAllHeader,
  SelectRowCell,
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
 */
const helper = createColumnHelper<typeof FEATURES, Posting>();

const columns = helper.columns([
  helper.display({
    id: "select",
    header: ({ table }) => <SelectAllHeader table={table} />,
    cell: ({ row }) => <SelectRowCell row={row} label={row.original.role} />,
  }),

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
        <p className="text-meta text-ink-meta mt-0.5 truncate">
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
        <span className={`tabular-nums ${count > 0 ? "text-ink" : "text-ink-faint"}`}>{count}</span>
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
 * opening it. Only an Open job can be closed; a Draft was never live and a
 * Closed one is final, so they offer Edit alone.
 *
 * relative z-10 lifts the trigger above <RowLink>'s row-wide overlay, the same
 * way the checkbox is lifted, or opening the menu would open the job.
 */
function RowActions({ posting }: { posting: Posting }) {
  const [isClosing, setIsClosing] = useState(false);
  const router = useRouter();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions for ${posting.role}`}
          className="text-ink-meta hover:text-ink focus-visible:ring-brand-ring relative z-10 inline-flex size-7 cursor-pointer items-center justify-center rounded-xs focus-visible:ring-2 focus-visible:outline-none"
        >
          <EllipsisIcon className="size-4" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem render={<Link href={`/company/jobs/${posting.id}/edit`} />}>
            Edit
          </DropdownMenuItem>
          {posting.status === "Open" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setIsClosing(true)}>
                Close job
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
  { columnId: "status", label: "Status", plural: "Statuses", options: STATUSES },
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
        filters={FILTERS}
      />
      <DataTable table={table} empty={empty} />
    </div>
  );
}
