"use client";

import { RadioButtonIcon } from "@phosphor-icons/react/ssr";
import { useRef } from "react";

import { FieldFacet, type FacetOption } from "@/components/field-facet";
import { CloseIcon, FilterIcon } from "@/components/icons";
import { useShallowParams, useShallowPush } from "@/components/shallow-routing";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { useRunnerJob } from "@/lib/autofill-extension";

import { ActivityTable, GROUPS, sortItems, STATUS, type ActivityItem } from "./activity-list";
import { activityHref, parseActivityQuery, STATUS_FILTERS, type StatusFilter } from "./query";

const STATUS_OPTIONS: FacetOption[] = STATUS_FILTERS.map((group) => ({
  value: group,
  label: GROUPS[group].label,
  Icon: GROUPS[group].Icon,
  iconClassName: GROUPS[group].ink,
}));

/**
 * Live Activity (KAN-285): the Status filter and the table of applications
 * (./activity-list.tsx).
 *
 * It adds the one row the server cannot know: the queued job posting open
 * in the extension's run tab reads Working in Browser (useRunnerJob), in
 * flight, and has a glyph that goes to the tab instead of the cross, since
 * taking it out of the queue would leave the tab on a job that is gone.
 * Every other row is as the server drew it.
 *
 * THE FILTER AND THE SORT ARE THE URL'S (./query.ts), read through shallow
 * routing so a pick redraws in the next frame: the rows are all here, so
 * this filters and sorts them itself and never asks the server. The Status
 * dropdown is the Applications page's (components/field-facet.tsx), its
 * options the status groups, each with its glyph in its colour; Clear Filters is an outlined
 * cross while a status is picked. Both Clear Filters, the cross and the empty
 * state's button, hand focus back to the dropdown: each leaves the page as
 * it clears, and focus would otherwise fall to the top of the page.
 * A row of counts by status sat above the table until the user asked for
 * it to go (2026-10-20).
 */
export function LiveActivity({ items }: { items: ActivityItem[] }) {
  const query = parseActivityQuery(useShallowParams());
  const push = useShallowPush();
  const runnerJob = useRunnerJob();
  const statusButton = useRef<HTMLButtonElement>(null);

  const rows = items.map((item) =>
    item.status === "queued" && item.id === runnerJob
      ? { ...item, status: "browser" as const, detail: "Open in a background tab" }
      : item,
  );
  const shown = sortItems(
    query.statuses.length === 0
      ? rows
      : rows.filter((item) => query.statuses.includes(STATUS[item.status].group)),
    query.sort,
  );

  const setStatuses = (statuses: string[]) =>
    push(activityHref(query, { statuses: statuses as StatusFilter[] }), undefined, {
      replace: true,
    });
  const clearFilters = () => {
    statusButton.current?.focus();
    setStatuses([]);
  };

  return (
    <>
      {/* The filter row, as the Applications page's starts: the Status
          dropdown, then Clear Filters as an outlined cross while a status
          is picked. */}
      <div className="mt-3 flex items-center gap-2">
        <FieldFacet
          ref={statusButton}
          label="Status"
          Icon={RadioButtonIcon}
          options={STATUS_OPTIONS}
          values={query.statuses}
          onChange={setStatuses}
          className="min-w-36"
        />
        {query.statuses.length > 0 && (
          <IconButton
            label="Clear filters"
            variant="outline"
            className="animate-fade size-9 shrink-0"
            onClick={clearFilters}
          >
            <CloseIcon className="size-4" />
          </IconButton>
        )}
      </div>

      {shown.length > 0 ? (
        <ActivityTable
          items={shown}
          sort={query.sort}
          onSort={(sort) => push(activityHref(query, { sort }))}
        />
      ) : (
        <EmptyState
          Icon={FilterIcon}
          title="No Jobs With That Status"
          className="mt-3"
          action={
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              Clear Filters
            </Button>
          }
        >
          Pick another status, or show them all.
        </EmptyState>
      )}
    </>
  );
}
