"use client";

import { createColumnHelper, useTable } from "@tanstack/react-table";

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
import { POSTINGS, STATUSES, type Posting } from "./data";

/**
 * The postings table.
 *
 * Columns and data are module constants because both feed TanStack's row
 * models, and a new array identity on each render rebuilds every model that
 * depends on it. Nothing here is derived from props, so there is nothing to
 * memoize — they simply live outside the component.
 */
const helper = createColumnHelper<typeof FEATURES, Posting>();

const columns = helper.columns([
  helper.display({
    id: "select",
    meta: { className: "w-12" },
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
      <div className="min-w-0">
        <RowLink href={`/company/jobs/${row.original.id}`} className="text-label">
          {row.original.role}
        </RowLink>
        <p className="text-meta text-ink-meta mt-0.5 truncate">
          {row.original.team} · {row.original.location}
        </p>
      </div>
    ),
  }),

  helper.accessor("status", {
    meta: { className: "w-32" },
    header: ({ column }) => <SortHeader column={column}>Status</SortHeader>,
    sortFn: "alphanumeric",
    /* arrIncludesSome rather than equalsString: the toolbar hands over an
     * array so a multi-select dropdown later needs no change here. */
    filterFn: "arrIncludesSome",
    cell: ({ getValue }) => {
      const status = getValue();

      return (
        <Badge variant="status" tone={status === "Open" ? "positive" : "neutral"}>
          {status}
        </Badge>
      );
    },
  }),

  helper.accessor("applicants", {
    meta: { className: "w-32 text-right" },
    header: ({ column }) => (
      <SortHeader column={column} align="end">
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
    meta: { className: "w-32 text-right" },
    header: ({ column }) => (
      <SortHeader column={column} align="end">
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
    meta: { className: "w-40" },
    header: ({ column }) => <SortHeader column={column}>Posted</SortHeader>,
    /* datetime, not alphanumeric. ISO strings happen to sort correctly as
     * text, which is exactly why this is worth stating: the day the fixture
     * becomes a real date the string comparison would start lying, silently. */
    sortFn: "datetime",
    cell: ({ getValue }) => (
      <span className="text-ink-meta whitespace-nowrap">{formatDate(getValue())}</span>
    ),
  }),
]);

const FILTERS: FilterSpec[] = [{ columnId: "status", label: "Status", options: STATUSES }];

export function JobsTable() {
  const table = useTable({ features: FEATURES, columns, data: POSTINGS });

  return (
    <div className="flex flex-col gap-4">
      <TableToolbar
        table={table}
        searchColumnId="role"
        searchPlaceholder="Search roles"
        filters={FILTERS}
      />
      <DataTable table={table} empty="No postings match those filters." />
    </div>
  );
}
