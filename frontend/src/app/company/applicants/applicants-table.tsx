"use client";

import { createColumnHelper, useTable } from "@tanstack/react-table";

import { Avatar } from "@/components/avatar";
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
import { APPLICANTS, ROLES, STAGE_TONE, STAGES, type Applicant } from "./data";

/** Module constants: a fresh array identity rebuilds every row model. */
const helper = createColumnHelper<typeof FEATURES, Applicant>();

const columns = helper.columns([
  helper.display({
    id: "select",
    header: ({ table }) => <SelectAllHeader table={table} />,
    cell: ({ row }) => <SelectRowCell row={row} label={row.original.name} />,
  }),

  helper.accessor("name", {
    header: ({ column }) => <SortHeader column={column}>Applicant</SortHeader>,
    sortFn: "alphanumeric",
    filterFn: "includesString",
    cell: ({ row }) => (
      <div className="flex max-w-[18rem] min-w-0 items-center gap-2.5">
        <Avatar name={row.original.name} className="text-meta size-7 shrink-0" />
        <div className="min-w-0">
          <RowLink href={`/company/applicants/${row.original.id}`} className="text-label">
            {row.original.name}
          </RowLink>
          <p className="text-meta text-ink-meta mt-0.5 truncate">{row.original.location}</p>
        </div>
      </div>
    ),
  }),

  /* Second, straight after the name: on a phone the scroller shows about two
   * columns, and where an applicant stands is the one fact worth having
   * without scrolling for it. */
  helper.accessor("stage", {
    meta: { className: "text-center" },
    header: ({ column }) => (
      <SortHeader column={column} align="center">
        Stage
      </SortHeader>
    ),
    /* Sorted by pipeline position, not alphabetically — Applied before
     * Screening before Interview, rather than Applied, Interview, Offer.
     * A custom function passed inline needs no registration in FEATURES. */
    sortFn: (a, b) => STAGES.indexOf(a.original.stage) - STAGES.indexOf(b.original.stage),
    filterFn: "arrIncludesSome",
    cell: ({ getValue }) => {
      const stage = getValue();

      return (
        <Badge variant="status" tone={STAGE_TONE[stage]}>
          {stage}
        </Badge>
      );
    },
  }),

  helper.accessor("role", {
    header: ({ column }) => <SortHeader column={column}>Applied To</SortHeader>,
    sortFn: "alphanumeric",
    filterFn: "arrIncludesSome",
    cell: ({ getValue }) => (
      <span className="text-ink-meta block max-w-[16rem] truncate">{getValue()}</span>
    ),
  }),

  helper.accessor("match", {
    meta: { className: "text-center" },
    header: ({ column }) => (
      <SortHeader column={column} align="center">
        Match
      </SortHeader>
    ),
    sortFn: "basic",
    sortDescFirst: true,
    cell: ({ getValue }) => <span className="tabular-nums">{getValue()}%</span>,
  }),

  helper.accessor("applied", {
    meta: { className: "text-center" },
    header: ({ column }) => (
      <SortHeader column={column} align="center">
        Applied
      </SortHeader>
    ),
    sortFn: "datetime",
    sortDescFirst: true,
    cell: ({ getValue }) => (
      <span className="text-ink-meta whitespace-nowrap">{formatDate(getValue())}</span>
    ),
  }),
]);

const FILTERS: FilterSpec[] = [
  { columnId: "stage", label: "Stage", plural: "Stages", options: STAGES },
  { columnId: "role", label: "Role", plural: "Roles", options: ROLES },
];

/** `query` is the bar's ?q=, the starting value of the name search. The page
 *  keys this component by it, since the table reads initialState only once. */
export function ApplicantsTable({ query = "" }: { query?: string }) {
  const table = useTable({
    features: FEATURES,
    columns,
    data: APPLICANTS,
    initialState: { columnFilters: query ? [{ id: "name", value: query }] : [] },
  });

  return (
    <div className="flex flex-col gap-4">
      <TableToolbar
        table={table}
        searchColumnId="name"
        searchPlaceholder="Search applicants"
        searchLabel="Search Applicants"
        filters={FILTERS}
      />
      <DataTable table={table} empty="No applicants match those filters." />
    </div>
  );
}
