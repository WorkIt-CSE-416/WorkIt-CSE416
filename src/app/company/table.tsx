"use client";

import {
  columnFilteringFeature,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_arrIncludesSome,
  filterFn_includesString,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  tableFeatures,
  type ReactTable,
  type RowData,
} from "@tanstack/react-table";
import Link from "next/link";
import type { ReactNode } from "react";

import { Checkbox } from "@/components/shadcn/checkbox";
import { Input } from "@/components/shadcn/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import { SortIcon } from "./icons";

/**
 * The table the two list screens share: /company/jobs and /company/candidates.
 *
 * It lives here rather than in src/components because nothing outside /company
 * uses it — the same reasoning that keeps placeholder.tsx beside these routes.
 *
 * TANSTACK V9, NOT V8, and the difference is not cosmetic. Every shadcn
 * data-table example in circulation is v8: `useReactTable`, row models passed
 * as `getCoreRowModel: getCoreRowModel()`, features always present. v9 replaced
 * that with `useTable` and explicit registration — a feature's state and
 * methods do not exist until you put it in `tableFeatures`, and the sort and
 * filter functions are registered by name so unused ones stay out of the
 * bundle. Pasting a v8 example here produces something that type-checks
 * against nothing and fails at runtime. The library ships its own guides in
 * node_modules/@tanstack/react-table/skills; read those, not a blog post.
 */
/**
 * Per-column presentation, applied by DataTable to the header cell and every
 * body cell of that column.
 *
 * Width lives here rather than on the cells because a table column is one
 * thing: setting it in the renderer would mean stating it twice and letting
 * the two drift. v9 takes a typed `columnMeta` slot on the feature set, so this
 * needs no global declaration merging.
 */
export type ColumnMeta = {
  /** Applied to <th> and <td> alike — width, alignment, numerals. */
  className?: string;
};

export const FEATURES = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
  },
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: {
    includesString: filterFn_includesString,
    arrIncludesSome: filterFn_arrIncludesSome,
  },
  rowSelectionFeature,
  columnMeta: {} as ColumnMeta,
});

export type CompanyTable<T extends RowData> = ReactTable<typeof FEATURES, T>;

/**
 * `features`, `columns` and `data` must keep the same identity between
 * renders — a new array invalidates every model built from it. Column
 * definitions and fixtures are therefore module constants, never inline.
 */

/* Selection ---------------------------------------------------------------
 *
 * SELECT ALL MEANS ALL FILTERED ROWS, NOT ALL ROWS. That is the whole reason
 * this is worth being careful about: with a filter applied, a header checkbox
 * that quietly selects rows the reader cannot see is how someone rejects
 * fifty candidates they never looked at. getIsAllRowsSelected and its toggle
 * read the filtered row model, so narrowing the list narrows what the header
 * checkbox controls, and the count in the toolbar always matches what is on
 * screen. */

type SelectAllTable = {
  getIsAllRowsSelected: () => boolean;
  getIsSomeRowsSelected: () => boolean;
  toggleAllRowsSelected: (value?: boolean) => void;
};

/**
 * Structural, not `CompanyTable`: a column's header context is handed the core
 * table, which has no FlexRender or Subscribe on it. Naming the three methods
 * this actually calls keeps it usable from both sides.
 */
export function SelectAllHeader({ table }: { table: SelectAllTable }) {
  const all = table.getIsAllRowsSelected();

  return (
    <Checkbox
      checked={all}
      indeterminate={!all && table.getIsSomeRowsSelected()}
      onCheckedChange={(checked) => table.toggleAllRowsSelected(checked)}
      aria-label="Select all rows"
    />
  );
}

type SelectableRow = {
  getIsSelected: () => boolean;
  toggleSelected: (value?: boolean) => void;
};

export function SelectRowCell({ row, label }: { row: SelectableRow; label: string }) {
  return (
    <Checkbox
      checked={row.getIsSelected()}
      onCheckedChange={(checked) => row.toggleSelected(checked)}
      aria-label={`Select ${label}`}
    />
  );
}

/* Sorting ----------------------------------------------------------------- */

type SortableColumn = {
  getCanSort: () => boolean;
  getIsSorted: () => false | "asc" | "desc";
  getToggleSortingHandler: () => ((event: unknown) => void) | undefined;
};

/**
 * A sortable column heading.
 *
 * The whole heading is the control rather than a separate icon button, because
 * a 14px arrow is a poor click target and the label is already the thing a
 * reader points at. `w-full` extends that to the rest of the cell. aria-sort
 * goes on the <th> in DataTable, so the state is announced once by the cell
 * rather than twice by the cell and its button.
 *
 * WHY `flex` AND NOT `inline-flex`, which is the obvious choice for something
 * sitting in a table heading: an inline-level box is positioned within its line
 * box by its baseline, and a flex container takes its baseline from the first
 * flex item in VISUAL order. `flex-row-reverse` makes that the icon rather than
 * the label, and an <svg> has no text baseline, so the browser falls back to
 * its bottom margin edge. The end-aligned headings were being aligned by the
 * arrow while every other heading was aligned by its text, which is why
 * Applicants and Unreviewed sat higher than Role and Status. A block-level flex
 * container takes no part in baseline alignment, so the mismatch cannot arise:
 * every heading is then the same 16px box, centred by the cell's align-middle.
 *
 * `flex-row-reverse` also does the horizontal work for a numeric column. In a
 * reversed row main-start IS the right edge, so the pair packs right and sits
 * under the right-aligned digits, and the arrow lands inboard of the label
 * rather than outboard — which keeps the label's right edge flush with the
 * numbers instead of pushing it off by the width of an arrow.
 */
export function SortHeader({
  column,
  children,
  align = "start",
}: {
  column: SortableColumn;
  children: ReactNode;
  align?: "start" | "end";
}) {
  if (!column.getCanSort()) {
    return <span className={cn("block", align === "end" && "text-right")}>{children}</span>;
  }

  const sorted = column.getIsSorted();

  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      className={cn(
        "text-note text-ink-meta hover:text-ink focus-visible:ring-brand-ring flex w-full items-center gap-1 rounded-xs font-medium focus-visible:ring-2 focus-visible:outline-none",
        align === "end" && "flex-row-reverse",
      )}
    >
      {children}
      <SortIcon
        className={cn("size-3.5 shrink-0", sorted ? "text-brand" : "text-ink-faint")}
        direction={sorted || undefined}
      />
    </button>
  );
}

/* Toolbar ----------------------------------------------------------------- */

export type FilterSpec = {
  /** Column id the value is applied to. */
  columnId: string;
  label: string;
  options: string[];
};

const ALL = "__all__";

/**
 * Search box, one dropdown per filter, and the selection summary.
 *
 * The summary only appears once something is selected: a row that says
 * "0 selected" on every screen is chrome that never earns its space.
 */
export function TableToolbar<T extends RowData>({
  table,
  searchColumnId,
  searchPlaceholder,
  filters = [],
}: {
  table: CompanyTable<T>;
  searchColumnId: string;
  searchPlaceholder: string;
  filters?: FilterSpec[];
}) {
  const selected = table.getSelectedRowIds?.() ?? {};
  const selectedCount = Object.keys(selected).length;
  const shown = table.getRowModel().rows.length;
  const total = table.getPreFilteredRowModel().rows.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={(table.getColumn(searchColumnId)?.getFilterValue() as string) ?? ""}
          onChange={(e) => table.getColumn(searchColumnId)?.setFilterValue(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="h-8 w-full sm:max-w-64"
        />

        {filters.map(({ columnId, label, options }) => {
          const column = table.getColumn(columnId);
          const value = (column?.getFilterValue() as string[] | undefined)?.[0] ?? ALL;

          return (
            <Select
              key={columnId}
              value={value}
              onValueChange={(next) =>
                column?.setFilterValue(next === ALL ? undefined : [next as string])
              }
            >
              <SelectTrigger className="h-8 w-full sm:w-40" aria-label={label}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All {label.toLowerCase()}</SelectItem>
                {options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        })}
      </div>

      <div className="text-note text-ink-meta flex flex-wrap items-center gap-3">
        <span>{shown === total ? `${total} total` : `${shown} of ${total}`}</span>

        {selectedCount > 0 && (
          <>
            <span className="text-ink">{selectedCount} selected</span>
            <Button variant="ghost" onClick={() => table.resetRowSelection()}>
              Clear
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/* Row links ---------------------------------------------------------------- */

/**
 * The primary cell of a row — the name or the role that opens the record.
 *
 * Ink, not brand. <TextLink> is for a link inside a sentence, where brand
 * colour is what distinguishes the few linked words from the prose around
 * them. A table where every row's first cell is the same blue has no such
 * contrast to draw: the colour stops marking anything, because it marks every
 * row, and it fights the status badges that are trying to use colour to mean
 * something. So the text reads as ink like the rest of the row and turns brand
 * on hover and focus, where the affordance is actually needed.
 *
 * truncate rather than wrap: every cell in this table is one line tall, and a
 * long role title must not be the thing that decides row height.
 */
export function RowLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "text-ink hover:text-brand focus-visible:ring-brand-ring block truncate rounded-xs font-medium focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/* Dates -------------------------------------------------------------------- */

/**
 * Formats a date-only ISO string (`2026-08-04`) for display.
 *
 * BOTH OPTIONS BELOW ARE DOING REAL WORK. Drop either and it breaks.
 *
 * `timeZone: "UTC"` is why the date shown is the date written. `new Date()`
 * parses a date-only string as UTC midnight, and a viewer east of Greenwich —
 * or in this case west, at UTC-4 — renders that instant on the previous
 * evening, so every date came out a day early. Formatting in UTC keeps a value
 * that has no time component from being pushed across a boundary by one.
 *
 * The explicit `en-US` is why the server and the client agree. An unqualified
 * toLocaleDateString picks up whatever locale the runtime has, which is not the
 * same in Node and in a browser, and React reports the difference as a
 * hydration mismatch.
 */
export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/* Table ------------------------------------------------------------------- */

export function DataTable<T extends RowData>({
  table,
  empty,
}: {
  table: CompanyTable<T>;
  empty: string;
}) {
  const rows = table.getRowModel().rows;
  const columnCount = table.getAllLeafColumns().length;

  return (
    /* overflow-hidden, not overflow-x-auto: shadcn's <Table> already wraps
     * itself in a scroller, and a second one here would nest two scrollbars.
     * This wrapper only needs to clip the rounded corners. */
    <div className="border-border-subtle bg-panel rounded-card overflow-hidden border">
      {/* table-fixed, because auto layout sizes each column to its content and
          then hands every spare pixel to the widest text column. That is what
          left the short numeric and date columns collapsed against one another
          at the right edge while Role sprawled. Fixed layout takes the widths
          declared in each column's meta and gives the remainder to the one
          column that declares none, so spacing is stated rather than inferred
          from whatever the fixtures happen to contain. min-w keeps it from
          being squeezed below its natural size on a narrow viewport — the
          scroller inside <Table> takes over there instead. */}
      <Table className="min-w-[56rem] table-fixed">
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted?.();

                return (
                  <TableHead
                    key={header.id}
                    className={header.column.columnDef.meta?.className}
                    aria-sort={
                      sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined
                    }
                  >
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="text-note text-ink-meta h-24 text-center">
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id} data-state={row.getIsSelected() ? "selected" : undefined}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
