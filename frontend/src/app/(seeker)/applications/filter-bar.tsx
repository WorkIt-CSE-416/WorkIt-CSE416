"use client";

import Form from "next/form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useOptimistic, useRef, useState } from "react";

import { CloseIcon, FilterIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ChipLink } from "@/components/ui/chip";
import { IconButton } from "@/components/ui/icon-button";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/cn";

import { STAGE_COLOR, STAGE_ICON, STAGE_LABEL, STAGE_ORDER, type StageKey } from "../stage-colors";
import { AllFiltersPanel, FIELD_ICON, FieldFacet, type Picks } from "./field-filters";
import { ColumnsMenu } from "./list-controls";
import {
  applicationsHref,
  DEFAULT_SORT,
  DEFAULT_VIEW,
  FILTER_FIELDS,
  filterCount,
  filterOptions,
  NO_FILTERS,
  type Filterable,
  type FilterKey,
} from "./query";
import { useApplicationsQuery } from "./view-switcher";

/**
 * The Applications filters, in two rows. The first: a search over role and
 * company, and one chip per stage. The second, laid out as the Jobs page's
 * filter row (KAN-282): a dropdown per field (Company, Track, Work Model,
 * Source; ./field-filters.tsx), then, at the right, Clear Filters as a cross,
 * All Filters (a panel with Status and every field) and, while the list is
 * shown, its Columns menu.
 *
 * EVERYTHING HERE IS A URL, like the view switcher beside the title (./query.ts).
 * The search is a GET form, a `next/form`, so pressing Enter navigates with
 * `?q=` set and the views below re-render on the server; the current view,
 * stages and sort ride along as hidden fields so a search does not reset
 * them (the field filters' picks too). The field is keyed by the query it shows, so it empties when Clear
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
 * applications the search and the field filters leave in that stage, so a
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
  apps,
}: {
  counts: Record<StageKey, number>;
  /** Every tracked application, as the filters read it: the fields'
   *  options, and All Filters' count. */
  apps: Filterable[];
}) {
  const query = useApplicationsQuery();
  const router = useRouter();
  // The picks show at once; the URL's catch up when the filtered page lands.
  const [picks, show] = useOptimistic<Picks>({ stages: query.stages, filters: query.filters });
  const [allOpen, setAllOpen] = useState(false);
  // Clear Filters leaves with the last pick, so its press hands focus here.
  const allButton = useRef<HTMLButtonElement>(null);
  const options = filterOptions(apps, picks.filters);
  const filtered = picks.stages.length > 0 || query.q !== "" || filterCount(picks.filters) > 0;

  /** Moves the URL to these picks; the server filters again. It replaces
   *  the URL, as the Jobs page's facets do, so ten ticks are not ten steps
   *  of Back. */
  function apply(next: Picks, q = query.q) {
    startTransition(() => {
      show(next);
      router.replace(applicationsHref(query, { ...next, q, app: null }), { scroll: false });
    });
  }

  const facet = (key: FilterKey, label: string, className: string) => (
    <FieldFacet
      label={label}
      Icon={FIELD_ICON[key]}
      options={options[key]}
      values={picks.filters[key]}
      onChange={(values) => apply({ ...picks, filters: { ...picks.filters, [key]: values } })}
      className={className}
    />
  );

  return (
    <div className="mt-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Form action="/applications" className="w-full @lg/main:w-64">
          {query.view !== DEFAULT_VIEW && <input type="hidden" name="view" value={query.view} />}
          {picks.stages.length > 0 && (
            <input type="hidden" name="stage" value={picks.stages.join(",")} />
          )}
          {FILTER_FIELDS.flatMap(({ key, param }) =>
            picks.filters[key].map((value) => (
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

        <div
          role="group"
          aria-label="Filter by Stage"
          className="flex flex-wrap items-center gap-2"
        >
          {STAGE_ORDER.map((stage) => {
            const active = picks.stages.includes(stage);
            const stages = active
              ? picks.stages.filter((s) => s !== stage)
              : STAGE_ORDER.filter((s) => s === stage || picks.stages.includes(s));

            const StageIcon = STAGE_ICON[stage];

            return (
              <ChipLink
                key={stage}
                href={applicationsHref({ ...query, filters: picks.filters }, { stages, app: null })}
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
      </div>

      {/* THE FIELDS STEP OUT ONE AT A TIME, least used first, from the right,
          as the Jobs page's facets do; All Filters, which holds them all,
          stays at every width. Each dropdown is at least 144px; the cross,
          All Filters and Columns take about 280px with their gaps, so this
          row (its own @container) fits Company from 448px, Track from 600,
          Work Model from 752 and Source from 904. The cross's room is kept
          whether or not it shows, so a pick never pushes a field out. */}
      <div className="@container flex items-center gap-2">
        {facet("company", "Company", "hidden min-w-36 @min-[28rem]:flex")}
        {facet("track", "Track", "hidden min-w-36 @min-[37.5rem]:flex")}
        {facet("workModel", "Work Model", "hidden min-w-36 @min-[47rem]:flex")}
        {facet("source", "Source", "hidden min-w-36 @min-[56.5rem]:flex")}

        {/* Every pick and the search off in one press, shown only while
            there is one: an outlined cross, its name in the tooltip, as on
            the Jobs page. The press hands focus to All Filters, since the
            cross leaves with the last pick. */}
        {filtered && (
          <IconButton
            label="Clear filters"
            variant="outline"
            className="animate-fade ml-auto size-9 shrink-0"
            onClick={() => {
              allButton.current?.focus();
              apply({ stages: [], filters: NO_FILTERS }, "");
            }}
          >
            <CloseIcon className="size-4" />
          </IconButton>
        )}
        <Button
          ref={allButton}
          variant="secondary"
          size="sm"
          onClick={() => setAllOpen(true)}
          className={cn("shrink-0", !filtered && "ml-auto")}
        >
          <FilterIcon className="size-4" />
          All Filters
        </Button>
        {/* The list's own control: the grid has no columns. */}
        {query.view === "list" && <ColumnsMenu className="shrink-0" />}
      </div>

      <AllFiltersPanel
        open={allOpen}
        onOpenChange={setAllOpen}
        picks={picks}
        apps={apps}
        q={query.q}
        options={options}
        onApply={apply}
      />
    </div>
  );
}

/** Drops the stages, the search and the field filters' picks, keeping the layout the URL names now:
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
