"use client";

import Form from "next/form";
import Link from "next/link";

import { CloseIcon } from "@/components/icons";
import { ChipLink } from "@/components/ui/chip";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/cn";

import { STAGE_COLOR, STAGE_ICON, STAGE_LABEL, STAGE_ORDER, type StageKey } from "../stage-colors";
import { ColumnsMenu, FilterMenu } from "./list-controls";
import {
  applicationsHref,
  DEFAULT_SORT,
  DEFAULT_VIEW,
  FILTER_FIELDS,
  filterCount,
  NO_FILTERS,
  type Filters,
} from "./query";
import { useApplicationsQuery } from "./view-switcher";

/**
 * The Applications filters: a search over role and company, one chip per
 * stage, and the Filter button's menu of Company, Track, Work Model and
 * Source (./list-controls.tsx, KAN-282). While the list is shown, its
 * Columns menu sits at the bar's right end. An earlier Filter button opened
 * nothing and was dropped for the chips; KAN-282 brought it back with a menu.
 *
 * EVERYTHING HERE IS A URL, like the view switcher beside the title (./query.ts).
 * The search is a GET form, a `next/form`, so pressing Enter navigates with
 * `?q=` set and the views below re-render on the server; the current view,
 * stages and sort ride along as hidden fields so a search does not reset
 * them (the Filter button's picks too). The field is keyed by the query it shows, so it empties when Clear
 * Filters navigates away from a search, which an uncontrolled field would not
 * do on its own.
 *
 * A stage chip is a link that toggles its stage in `?stage=`. Several can be
 * on at once, and none on shows every stage. Each chip leads with its
 * stage's glyph in the stage's colour (STAGE_ICON, KAN-256), the glyph the
 * detail panel and the Dashboard's Up Next use, so a stage is told by shape
 * as well as colour; it replaced a coloured dot, which said the stage by
 * colour alone. On, a chip takes its stage's tint and a cross; off, it is a
 * white outline. Its count is how many
 * applications the search and the Filter button leave in that stage, so a
 * chip says what turning
 * it on will show. The chip is a ChipLink (ui/chip.tsx, KAN-251) rather
 * than ui/filter-chip.tsx, whose chevron promises a menu.
 *
 * A CLIENT COMPONENT, reading the URL itself (useApplicationsQuery), because
 * the layout switch moves the URL in place and never asks the server to draw
 * this bar again: drawn there, its chips and its search would carry the old
 * layout and send the page back to it. The counts still come from the
 * server, which does the filtering.
 */
export function FilterBar({
  counts,
  options,
}: {
  counts: Record<StageKey, number>;
  /** What the Filter button can pick, per field. */
  options: Filters;
}) {
  const query = useApplicationsQuery();
  const filtered = query.stages.length > 0 || query.q !== "" || filterCount(query.filters) > 0;

  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
      <Form action="/applications" className="w-full @lg/main:w-64">
        {query.view !== DEFAULT_VIEW && <input type="hidden" name="view" value={query.view} />}
        {query.stages.length > 0 && (
          <input type="hidden" name="stage" value={query.stages.join(",")} />
        )}
        {FILTER_FIELDS.flatMap(({ key, param }) =>
          query.filters[key].map((value) => (
            <input key={`${param}:${value}`} type="hidden" name={param} value={value} />
          )),
        )}
        {query.sort !== DEFAULT_SORT && <input type="hidden" name="sort" value={query.sort} />}
        <SearchField
          key={query.q}
          id="applications-search"
          label="Search Applications"
          name="q"
          placeholder="Search role or company"
          defaultValue={query.q}
          enterKeyHint="search"
        />
      </Form>

      <div role="group" aria-label="Filter by Stage" className="flex flex-wrap items-center gap-2">
        {STAGE_ORDER.map((stage) => {
          const active = query.stages.includes(stage);
          const stages = active
            ? query.stages.filter((s) => s !== stage)
            : STAGE_ORDER.filter((s) => s === stage || query.stages.includes(s));

          const StageIcon = STAGE_ICON[stage];

          return (
            <ChipLink
              key={stage}
              href={applicationsHref(query, { stages, app: null })}
              scroll={false}
              pressed={active}
              // On, it takes its stage's tint rather than the brand's: a
              // stage owns its colour (docs/design.md). The one chip that
              // paints its own pressed look.
              className={
                active
                  ? cn("border-transparent", STAGE_COLOR[stage].tint, STAGE_COLOR[stage].onTint)
                  : undefined
              }
            >
              {/* The text colour that reads on the stage's tint, which clears
                  3:1 on the white of an off chip too. */}
              <span aria-hidden="true" className={cn("flex", STAGE_COLOR[stage].onTint)}>
                <StageIcon />
              </span>
              {STAGE_LABEL[stage]}
              <span className={cn("tabular-nums", !active && "text-ink-subtle")}>
                {counts[stage]}
              </span>
              {active && (
                <>
                  {/* Pops in when the chip turns on: the one thing that
                      appears, so it is the one thing that springs. */}
                  <span className="animate-pop flex">
                    <CloseIcon className="size-3" />
                  </span>
                  <span className="sr-only">, filter on</span>
                </>
              )}
            </ChipLink>
          );
        })}
      </div>

      <FilterMenu options={options} />

      {filtered && (
        <ClearFiltersLink className="text-label text-brand hover:text-brand-hover focus-visible:ring-brand-ring animate-fade rounded-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none" />
      )}

      {/* The list's own control: the grid has no columns. */}
      {query.view === "list" && <ColumnsMenu className="ml-auto" />}
    </div>
  );
}

/** Drops the stages, the search and the Filter button's picks, keeping the layout the URL names now:
 *  the bar's own link, and the empty state's button. */
export function ClearFiltersLink({ className }: { className: string }) {
  const query = useApplicationsQuery();

  return (
    <Link
      href={applicationsHref(query, { stages: [], q: "", filters: NO_FILTERS, app: null })}
      scroll={false}
      className={className}
    >
      Clear Filters
    </Link>
  );
}
