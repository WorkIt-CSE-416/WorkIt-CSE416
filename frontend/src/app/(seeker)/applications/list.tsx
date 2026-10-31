"use client";

import {
  columnOrderingFeature,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnSizingState,
  type Header,
} from "@tanstack/react-table";
import Link from "next/link";
import {
  useState,
  type ComponentType,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  BriefcaseIcon,
  CalendarIcon,
  CoinIcon,
  ExternalLinkIcon,
  FileIcon,
  PencilIcon,
  PinIcon,
  SortIcon,
  workStyleIcon,
} from "@/components/icons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/table";
import { ClickableRow } from "@/components/clickable-row";
import { MatchBadge } from "@/components/match-badge";
import { Reflow } from "@/components/reflow";
import { useShallowPush } from "@/components/shallow-routing";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Fact } from "@/components/ui/fact";
import { cn } from "@/lib/cn";

import { STAGE_COLOR, STAGE_LABEL, STAGE_ORDER } from "../stage-colors";
import { LocalDate } from "../local-time";
import { sortKey, type Application } from "../tracker";
import { ApplicationTile } from "./application-tile";
import {
  COLUMNS,
  FROZEN,
  MAX_WIDTH,
  MIN_WIDTH,
  moveColumn,
  setColumnLayout,
  useColumnLayout,
  type ColumnId,
  type ColumnLayout,
} from "./column-layout";
import { applicationHref, applicationsHref, type Sort } from "./query";
import { useApplicationsQuery } from "./view-switcher";
import { ViewResumeButton } from "./view-resume";

/**
 * The applications as a table, one row each, in the order job trackers read
 * (KAN-256): what and who (Role, with its company under it), where it stands (Status, Date
 * Applied), how good it is (Match), the job's facts (Job Type;
 * Location; Work Model; Pay Range), where and what was sent (Source, the
 * hiring system its posting is on; Resume; Posting, open or not), and Notes /
 * Next Step last, the widest and least scanned. Role stays frozen at the
 * left while the rest scrolls. Company and Role were two frozen columns
 * (KAN-256) until they took so much width that few other columns showed;
 * stacked in one again, the company's name is still filtered and sorted on
 * as its own field.
 *
 * Notes / Next Step is a placeholder for now: nothing stores notes yet, and
 * Status can only be Saved or Applied until the API keeps later stages.
 *
 * Its frame follows the company Home's Recent Applicants
 * (company/applicants-preview.tsx): one white card, 12px grey headings,
 * rules between rows and no box around each.
 *
 * A TANSTACK TABLE V9 (KAN-282), as the company table is (company/table.tsx,
 * which says why v8 examples do not apply), so the seeker can arrange it as
 * a Notion table: drag a heading to a new place, resize a column by its
 * heading's right edge (or its arrow keys), and hide columns from the
 * Columns menu in the filter bar. That layout is this browser's
 * (./column-layout.ts); the frozen Role column cannot move or hide.
 *
 * SORTING IS IN THE URL, ?sort=, like every other choice on this page, so an
 * order can be shared and Back undoes it. A heading moves it in place
 * (components/shallow-routing.tsx): the rows are already here, and the table
 * sorts them itself. Five columns sort, each one way, the way it is read
 * (SORT_DESC): Role by its company A to Z (then by role, so a company's
 * roles sit together; `?sort=company`), Status furthest along first, Date Applied
 * latest first, Match best first, Pay Range best first. What has no value
 * to sort by goes last either way, in the order it came in. The rest do not
 * sort; the filters above the table pick those out. The heading in force
 * says so in aria-sort as well as in its chevron.
 *
 * IT SCROLLS SIDEWAYS, as a Notion table does, rather than dropping columns:
 * every column keeps its width (a fixed table layout, each width from the
 * layout) and cuts what does not fit, with the whole value on hover. A last,
 * empty column takes whatever room is left, so a resize never stretches the
 * others. A row opens its application's own page (./[jobId]) on a click
 * anywhere (components/clickable-row.tsx); the role is its link.
 */
const FEATURES = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, text: sortFn_text },
  columnOrderingFeature,
  columnPinningFeature,
  columnSizingFeature,
  columnResizingFeature,
  columnVisibilityFeature,
});

/** Which way each sortable column runs, for the sort, aria-sort and the
 *  chevron. */
const SORT_DESC: Record<Sort, boolean> = {
  company: false,
  status: true,
  applied: true,
  match: true,
  pay: true,
};

/** What a sortable column sorts by; undefined sorts last. The company
 *  sort keeps a company's roles together, A to Z within it. */
const SORT_VALUE: Record<Sort, (app: Application) => string | number | undefined> = {
  company: (app) => `${app.company}\u0000${app.role}`,
  status: (app) => STAGE_ORDER.indexOf(app.stage),
  applied: (app) => (app.appliedOn ? sortKey(app.appliedOn) : undefined),
  match: (app) => app.match ?? undefined,
  pay: (app) => app.payPerYear ?? undefined,
};

/** The sort each sortable column's heading picks. Role's is `company`: the
 *  merged column sorts by its company, the URL keeping the older name. */
const COLUMN_SORT: Partial<Record<ColumnId, Sort>> = {
  role: "company",
  status: "status",
  applied: "applied",
  match: "match",
  pay: "pay",
};

/** The column a sort is drawn on. */
const SORT_COLUMN = Object.fromEntries(
  Object.entries(COLUMN_SORT).map(([id, sort]) => [sort, id]),
) as Record<Sort, ColumnId>;

/** What a sort's heading says it sorts by, when that is not the heading. */
const SORT_HINT: Partial<Record<Sort, string>> = { company: "Sort by company, A to Z" };

/** A fact cell's value, or its missing word a step greyer. */
function FactValue({
  Icon,
  value,
  missing,
  title,
}: {
  Icon: ComponentType<{ className?: string }>;
  value: ReactNode;
  missing: string;
  title?: string;
}) {
  const has = value != null && value !== "";
  return (
    <Fact Icon={Icon} title={title} className={cn(!has && "text-ink-meta")}>
      {has ? value : missing}
    </Fact>
  );
}

/** Each column's cell. The cells are drawn as the job cards draw their facts
 *  (ui/fact.tsx); Status, Match and Posting are pills. */
const CELL: Record<ColumnId, (app: Application) => ReactNode> = {
  // The logo, then the role over its company, as the list drew it before
  // KAN-256. The role is cut to the column, the whole title on hover:
  // scraped titles run long ("... 2027 in Eurasburg / Bavaria"). The row
  // opens on a click anywhere (components/clickable-row.tsx); the role is the link a
  // keyboard reaches.
  role: (app) => (
    <div className="flex min-w-0 items-center gap-3">
      <ApplicationTile application={app} size="sm" />
      <div className="min-w-0">
        <Link
          href={applicationHref(app.id)}
          title={app.role}
          className="text-label text-ink hover:text-brand focus-visible:ring-brand-ring block truncate rounded-xs font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
        >
          {app.role}
        </Link>
        <p className="text-note text-ink-meta truncate" title={app.company}>
          {app.company}
        </p>
      </div>
    </div>
  ),
  status: (app) => <Badge tone={STAGE_COLOR[app.stage].tone}>{STAGE_LABEL[app.stage]}</Badge>,
  applied: (app) => (
    <FactValue
      Icon={CalendarIcon}
      value={app.appliedOn ? <LocalDate at={app.appliedOn} /> : null}
      missing="Not yet"
    />
  ),
  match: (app) =>
    app.match != null ? (
      <MatchBadge score={app.match} />
    ) : (
      <span className="text-ink-meta">Not scored</span>
    ),
  track: (app) => <FactValue Icon={BriefcaseIcon} value={app.track} missing="Not listed" />,
  location: (app) => (
    <FactValue
      Icon={PinIcon}
      value={app.location}
      missing="Not listed"
      title={app.location ?? undefined}
    />
  ),
  workModel: (app) => (
    <FactValue
      Icon={workStyleIcon(app.workModel ?? null)}
      value={app.workModel}
      missing="Not listed"
    />
  ),
  pay: (app) => <FactValue Icon={CoinIcon} value={app.pay} missing="Not listed" />,
  source: (app) => <FactValue Icon={ExternalLinkIcon} value={app.source} missing="Unknown" />,
  // View Resume (KAN-267): the button names the resume, filling the cell.
  resume: (app) =>
    app.sentResume ? (
      <ViewResumeButton resume={app.sentResume} className="w-full" />
    ) : (
      <FactValue Icon={FileIcon} value={null} missing="Not sent" />
    ),
  // A pill: positive is the badge's tone for a live posting, inert for one
  // that is over.
  posting: (app) =>
    app.open === false ? <Badge tone="inert">Closed</Badge> : <Badge tone="positive">Open</Badge>,
  // A placeholder until notes are stored.
  notes: () => <FactValue Icon={PencilIcon} value={null} missing="No notes yet" />,
};

const helper = createColumnHelper<typeof FEATURES, Application>();

/** Built once: `columns` must keep its identity between renders. */
const COLUMN_DEFS = helper.columns(
  COLUMNS.map(({ id, label, width }) =>
    helper.accessor((app) => (COLUMN_SORT[id] ? SORT_VALUE[COLUMN_SORT[id]](app) : undefined), {
      id,
      header: label,
      size: width,
      minSize: MIN_WIDTH,
      maxSize: MAX_WIDTH,
      enableSorting: COLUMN_SORT[id] != null,
      sortFn: COLUMN_SORT[id] === "company" ? "text" : "basic",
      sortUndefined: "last",
    }),
  ),
);

const PINNING = { start: FROZEN, end: [] };

const TH = "px-4 text-note text-ink-meta font-medium";
/** A plain fact cell: one line of note text in ink, as easy to read as the
 *  role; it was grey, which read as disabled (KAN-256). */
const TD = "px-4 text-note text-ink";
/** A frozen cell paints the row's own background (white, the hover tint
 *  with the row) so scrolled cells don't show through. FROZEN FROM 672PX OF
 *  PAGE UP: Role starts at 320px, about a phone's whole table, so frozen
 *  there it covered it and the scroll showed nothing else; below that it
 *  scrolls with the rest. 672px, not 768px, so a 1024px laptop window
 *  still freezes it. Its place is a custom property, not `left`, which
 *  would shift a narrow page's `relative` heading. */
const FROZEN_CELL = "z-1 bg-panel @2xl/main:sticky @2xl/main:left-(--frozen-left)";
/** The last frozen column draws the edge the scrolled cells pass under: a
 *  shadow, since a collapsed table's borders don't move with a sticky cell. */
const FROZEN_EDGE = "@2xl/main:shadow-[1px_0_0_var(--color-border-subtle)]";
const FROZEN_HOVER = "group-hover/row:bg-hover transition-colors";

/** How far one arrow key press resizes a column. */
const KEY_STEP = 16;

export function ApplicationsList({ applications }: { applications: Application[] }) {
  const query = useApplicationsQuery();
  const push = useShallowPush();
  const layout = useColumnLayout();
  const [drag, setDrag] = useState<{ id: ColumnId; over: ColumnId | null } | null>(null);

  const table = useTable({
    features: FEATURES,
    columns: COLUMN_DEFS,
    data: applications,
    getRowId: (app) => app.id,
    columnResizeMode: "onChange",
    state: {
      sorting: [{ id: SORT_COLUMN[query.sort], desc: SORT_DESC[query.sort] }],
      columnPinning: PINNING,
      columnOrder: [...FROZEN, ...layout.order],
      columnVisibility: Object.fromEntries(layout.hidden.map((id) => [id, false])),
      columnSizing: layout.widths as ColumnSizingState,
    },
    // The resize handles write here; the layout keeps it.
    onColumnSizingChange: (updater) => {
      const widths = typeof updater === "function" ? updater(layout.widths) : updater;
      setColumnLayout({ ...layout, widths: widths as ColumnLayout["widths"] });
    },
  });

  const lastFrozen = FROZEN[FROZEN.length - 1];

  /** A frozen column's sticky place, after the frozen columns before it:
   *  today Role alone, at the left edge. */
  function frozenStyle(id: ColumnId) {
    const column = table.getColumn(id);
    return column?.getIsPinned()
      ? ({ "--frozen-left": `${column.getStart("start")}px` } as CSSProperties)
      : undefined;
  }

  function frozenClasses(id: ColumnId) {
    return FROZEN.includes(id) && cn(FROZEN_CELL, id === lastFrozen && FROZEN_EDGE);
  }

  return (
    <Card padding="none" className="mt-4 overflow-hidden">
      <Table
        className="table-fixed"
        // At least as wide as the card; past that, as wide as its columns.
        style={{ width: table.getTotalSize(), minWidth: "100%" }}
      >
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => (
                <HeadCell
                  key={header.id}
                  header={header}
                  label={header.column.columnDef.header as string}
                  sort={query.sort}
                  onSort={(sort) => push(applicationsHref(query, { sort, app: null }))}
                  drag={drag}
                  onDrag={setDrag}
                  onDrop={(id, target) => setColumnLayout(moveColumn(layout, id, target))}
                  order={layout.order}
                  className={cn(frozenClasses(header.column.id as ColumnId))}
                  style={frozenStyle(header.column.id as ColumnId)}
                />
              ))}
              {/* The rest of the card's width, so a resize never stretches
                  the other columns. */}
              <TableHead aria-hidden />
            </TableRow>
          ))}
        </TableHeader>

        <TableBody>
          {table.getRowModel().rows.map((row, i) => (
            // Fades in down the table on arrival (a row cannot rise: its
            // transform does not reliably paint), 25ms apart, and glides to
            // its new place when the sort or a filter moves it.
            <Reflow key={row.id}>
              <ClickableRow
                href={applicationHref(row.id)}
                className="hover:bg-hover animate-fade"
                style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
              >
                {row.getVisibleCells().map((cell) => {
                  const id = cell.column.id as ColumnId;
                  return (
                    <TableCell
                      key={cell.id}
                      // A click in the resume cell around View Resume is a
                      // near miss, not a wish to open the application:
                      // ClickableRow leaves a prevented click alone.
                      onClick={
                        id === "resume" && row.original.sentResume
                          ? (event) => event.preventDefault()
                          : undefined
                      }
                      className={cn(
                        TD,
                        "overflow-hidden",
                        id === "role" && "py-3",
                        frozenClasses(id),
                        FROZEN.includes(id) && FROZEN_HOVER,
                      )}
                      style={frozenStyle(id)}
                    >
                      {CELL[id](row.original)}
                    </TableCell>
                  );
                })}
                <TableCell aria-hidden />
              </ClickableRow>
            </Reflow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

type Drag = { id: ColumnId; over: ColumnId | null } | null;

/**
 * One column heading: its label (a sort button where the column sorts), a
 * drag to move it, and a resize handle on its right edge.
 *
 * DRAGGING IS THE BROWSER'S OWN (HTML drag and drop) on the label, not the
 * whole cell, so a press on the resize handle never starts a move. While a
 * heading is dragged over another, a brand bar marks the side it will land
 * on. Frozen columns neither drag nor take a drop. A drag needs a mouse;
 * a phone keeps the default order, which the Columns menu can reset to.
 *
 * THE RESIZE HANDLE is TanStack's resize handler on mouse and touch, a
 * double click back to the default width, and the arrow keys for a
 * keyboard (a focusable separator with its width as its value). Its mouse
 * press cancels the browser's own default, and no move starts while a
 * column resizes: a resize moves the headings under a still-pressed
 * pointer, and Chrome then began a drag of the heading that slid under it,
 * which swallowed the mouse-up and left the resize following the pointer.
 */
function HeadCell({
  header,
  label,
  sort,
  onSort,
  drag,
  onDrag,
  onDrop,
  order,
  className,
  style,
}: {
  header: Header<typeof FEATURES, Application, unknown>;
  label: string;
  sort: Sort;
  onSort: (sort: Sort) => void;
  drag: Drag;
  onDrag: (drag: Drag) => void;
  onDrop: (id: ColumnId, target: ColumnId) => void;
  order: ColumnId[];
  className?: string;
  style?: CSSProperties;
}) {
  const column = header.column;
  const id = column.id as ColumnId;
  const movable = !FROZEN.includes(id);
  const columnSort = COLUMN_SORT[id];
  const active = columnSort != null && sort === columnSort;
  const direction = columnSort ? (SORT_DESC[columnSort] ? "desc" : "asc") : undefined;
  const resize = header.getResizeHandler();
  const width = header.getSize();

  // Where the dragged column lands, beside this one.
  const over = drag != null && drag.over === id && drag.id !== id;
  const side = over && order.indexOf(drag.id) < order.indexOf(id) ? "right" : "left";

  function onKeyDown(event: KeyboardEvent) {
    const step = event.key === "ArrowLeft" ? -KEY_STEP : event.key === "ArrowRight" ? KEY_STEP : 0;
    if (!step) return;
    event.preventDefault();
    column.table.setColumnSizing((sizing) => ({
      ...sizing,
      [id]: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width + step)),
    }));
  }

  const dragProps = movable
    ? {
        draggable: true,
        onDragStart: (event: DragEvent) => {
          if (column.table.getAllLeafColumns().some((other) => other.getIsResizing())) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", id);
          onDrag({ id, over: null });
        },
        onDragEnd: () => onDrag(null),
      }
    : {};

  return (
    <TableHead
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : undefined}
      className={cn(TH, "relative", className)}
      style={{ width, ...style }}
      onDragOver={(event) => {
        if (!drag || !movable) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (drag.over !== id) onDrag({ ...drag, over: id });
      }}
      onDrop={(event) => {
        if (!drag || !movable) return;
        event.preventDefault();
        onDrop(drag.id, id);
        onDrag(null);
      }}
    >
      <div
        {...dragProps}
        className={cn(
          "flex min-w-0 items-center",
          movable && "cursor-grab active:cursor-grabbing",
          drag?.id === id && "opacity-50",
        )}
      >
        {columnSort ? (
          <button
            type="button"
            onClick={() => onSort(columnSort)}
            title={SORT_HINT[columnSort]}
            className="hover:text-ink focus-visible:ring-brand-ring inline-flex min-w-0 items-center gap-1 rounded-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            <span className="truncate">{label}</span>
            {/* Keyed on its state, so the glyph pops in when the column
                takes the sort rather than swapping in place. */}
            <SortIcon
              key={active ? direction : "none"}
              className={cn(
                "animate-pop size-3.5 shrink-0",
                active ? "text-brand" : "text-ink-faint",
              )}
              direction={active ? direction : undefined}
            />
          </button>
        ) : (
          <span className="truncate">{label}</span>
        )}
      </div>

      {over && (
        <span
          aria-hidden
          className={cn(
            "bg-brand pointer-events-none absolute inset-y-1 w-0.5 rounded-full",
            side === "left" ? "left-0" : "right-0",
          )}
        />
      )}

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label}`}
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        title="Drag to resize, double-click to reset"
        onMouseDown={(event) => {
          event.preventDefault();
          resize(event);
        }}
        onTouchStart={resize}
        onDoubleClick={() => column.resetSize()}
        onKeyDown={onKeyDown}
        className={cn(
          "group/resize focus-visible:ring-brand-ring absolute inset-y-0 -right-1 z-2 flex w-2 cursor-col-resize touch-none justify-center select-none focus-visible:ring-2 focus-visible:outline-none",
        )}
      >
        <span
          className={cn(
            "h-full w-0.5 transition-colors",
            column.getIsResizing() ? "bg-brand" : "group-hover/resize:bg-border-control",
          )}
        />
      </div>
    </TableHead>
  );
}
