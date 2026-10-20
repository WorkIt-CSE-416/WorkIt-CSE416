"use client";

import Form from "next/form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useOptimistic, useRef, useState } from "react";

import { CloseIcon, FilterIcon, workStyleIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/cn";

import type { StageKey } from "../stage-colors";
import {
  AllFiltersPanel,
  FIELD_ICON,
  FieldFacet,
  SearchFacet,
  STATUS_OPTIONS,
  type Picks,
} from "./field-filters";
import { StatusIcon } from "./icons";
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
 * The Applications filters, in two rows (KAN-282). The first is the search
 * over role and company. The second is laid out as the Jobs page's filter
 * row: a dropdown for Status and one per field (./field-filters.tsx), then,
 * at the right, Clear Filters as a cross, All Filters (a panel with every
 * one of them) and, while the list is shown, its Columns menu. Status was a
 * row of stage chips with counts (KAN-256) until the row became dropdowns.
 *
 * EVERYTHING HERE IS A URL, like the view switcher beside the title
 * (./query.ts). The search is a GET form, a `next/form`, so pressing Enter
 * navigates with `?q=` set and the views below re-render on the server; the
 * current view, stages, field picks and sort ride along as hidden fields so
 * a search does not reset them. The field is keyed by the query it shows,
 * so it empties when Clear Filters navigates away from a search, which an
 * uncontrolled field would not do on its own. A dropdown pick replaces the
 * URL (`apply`).
 *
 * A CLIENT COMPONENT, reading the URL itself (useApplicationsQuery), because
 * the layout switch moves the URL in place and never asks the server to draw
 * this bar again: drawn there, its links and its search would carry the old
 * layout and send the page back to it. The filtering is still the server's.
 */
export function FilterBar({
  apps,
}: {
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

  const setField = (key: FilterKey, values: string[]) =>
    apply({ ...picks, filters: { ...picks.filters, [key]: values } });

  const facet = (key: FilterKey, label: string, className: string) => (
    <FieldFacet
      label={label}
      Icon={FIELD_ICON[key]}
      options={options[key].map((value) => ({
        value,
        label: value,
        // Work Model's options differ by glyph, as on the Jobs page.
        Icon: key === "workModel" ? workStyleIcon(value) : undefined,
      }))}
      values={picks.filters[key]}
      onChange={(values) => setField(key, values)}
      className={className}
    />
  );

  return (
    <div className="mt-6 flex flex-col gap-3">
      <div>
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
      </div>

      {/* THE DROPDOWNS STEP OUT ONE AT A TIME, least used first, from the
          right, as the Jobs page's facets do; All Filters, which holds them
          all, stays at every width. Each dropdown is at least 144px; the
          cross, All Filters and Columns take about 280px with their gaps, so
          this row (its own @container) fits Status from 440px, Company from
          592, Track from 744, Work Model from 896 and Source from 1048. A
          phone's row is All Filters and Columns. The cross's room is kept
          whether or not it shows, so a pick never pushes a dropdown out. */}
      <div className="@container flex items-center gap-2">
        <FieldFacet
          label="Status"
          Icon={StatusIcon}
          options={STATUS_OPTIONS}
          values={picks.stages}
          onChange={(stages) => apply({ ...picks, stages: stages as StageKey[] })}
          className="hidden min-w-36 @min-[27.5rem]:flex"
        />
        <SearchFacet
          label="Company"
          Icon={FIELD_ICON.company}
          searchLabel="Search companies"
          empty="No company by that name."
          options={options.company}
          values={picks.filters.company}
          onChange={(values) => setField("company", values)}
          className="hidden min-w-36 @min-[37rem]:flex"
        />
        {facet("track", "Track", "hidden min-w-36 @min-[46.5rem]:flex")}
        {facet("workModel", "Work Model", "hidden min-w-36 @min-[56rem]:flex")}
        {facet("source", "Source", "hidden min-w-36 @min-[65.5rem]:flex")}

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
