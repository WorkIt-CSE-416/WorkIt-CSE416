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
import { CANDIDATES, ROLES, STAGES, type Candidate, type Stage } from "./data";

/** Module constants: a fresh array identity rebuilds every row model. */
const helper = createColumnHelper<typeof FEATURES, Candidate>();

/** Only an offer is a finished good outcome; a rejection is finished and not. */
function toneFor(stage: Stage) {
  if (stage === "Offer") return "positive" as const;
  if (stage === "Rejected") return "neutral" as const;

  return "brand" as const;
}

const columns = helper.columns([
  helper.display({
    id: "select",
    meta: { className: "w-12" },
    header: ({ table }) => <SelectAllHeader table={table} />,
    cell: ({ row }) => <SelectRowCell row={row} label={row.original.name} />,
  }),

  helper.accessor("name", {
    header: ({ column }) => <SortHeader column={column}>Candidate</SortHeader>,
    sortFn: "alphanumeric",
    filterFn: "includesString",
    cell: ({ row }) => (
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar name={row.original.name} className="size-7 shrink-0 text-[0.625rem]" />
        <div className="min-w-0">
          <RowLink href={`/company/candidates/${row.original.id}`} className="text-label">
            {row.original.name}
          </RowLink>
          <p className="text-meta text-ink-meta mt-0.5 truncate">{row.original.location}</p>
        </div>
      </div>
    ),
  }),

  helper.accessor("role", {
    meta: { className: "w-64" },
    header: ({ column }) => <SortHeader column={column}>Applied to</SortHeader>,
    sortFn: "alphanumeric",
    filterFn: "arrIncludesSome",
    cell: ({ getValue }) => <span className="text-ink-meta block truncate">{getValue()}</span>,
  }),

  helper.accessor("stage", {
    meta: { className: "w-32" },
    header: ({ column }) => <SortHeader column={column}>Stage</SortHeader>,
    /* Sorted by pipeline position, not alphabetically — Applied before
     * Screening before Interview, rather than Applied, Interview, Offer.
     * A custom function passed inline needs no registration in FEATURES. */
    sortFn: (a, b) => STAGES.indexOf(a.original.stage) - STAGES.indexOf(b.original.stage),
    filterFn: "arrIncludesSome",
    cell: ({ getValue }) => {
      const stage = getValue();

      return (
        <Badge variant="status" tone={toneFor(stage)}>
          {stage}
        </Badge>
      );
    },
  }),

  helper.accessor("match", {
    meta: { className: "w-24 text-right" },
    header: ({ column }) => (
      <SortHeader column={column} align="end">
        Match
      </SortHeader>
    ),
    sortFn: "basic",
    sortDescFirst: true,
    cell: ({ getValue }) => <span className="block text-right tabular-nums">{getValue()}%</span>,
  }),

  helper.accessor("applied", {
    meta: { className: "w-36" },
    header: ({ column }) => <SortHeader column={column}>Applied</SortHeader>,
    sortFn: "datetime",
    sortDescFirst: true,
    cell: ({ getValue }) => (
      <span className="text-ink-meta whitespace-nowrap">{formatDate(getValue())}</span>
    ),
  }),
]);

const FILTERS: FilterSpec[] = [
  { columnId: "stage", label: "Stage", options: STAGES },
  { columnId: "role", label: "Roles", options: ROLES },
];

export function CandidatesTable() {
  const table = useTable({ features: FEATURES, columns, data: CANDIDATES });

  return (
    <div className="flex flex-col gap-4">
      <TableToolbar
        table={table}
        searchColumnId="name"
        searchPlaceholder="Search candidates"
        filters={FILTERS}
      />
      <DataTable table={table} empty="No candidates match those filters." />
    </div>
  );
}
