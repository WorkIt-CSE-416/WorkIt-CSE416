"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { useRouter } from "next/navigation";
import { Fragment, startTransition, useOptimistic, useState } from "react";

import { FilterIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Button } from "@/components/ui/button";
import { CheckRowBox, checkRowClasses } from "@/components/ui/check-row";
import { cn } from "@/lib/cn";

import {
  COLUMNS,
  FROZEN,
  isCustomLayout,
  setColumnLayout,
  useColumnLayout,
  type ColumnId,
} from "./column-layout";
import { ColumnsIcon } from "./icons";
import {
  applicationsHref,
  FILTER_FIELDS,
  filterCount,
  type FilterKey,
  type Filters,
} from "./query";
import { useApplicationsQuery } from "./view-switcher";

/**
 * The list's two menus in the filter bar (KAN-282): Filter, beside the stage
 * chips, and Columns, at the bar's right while the list is shown.
 *
 * Both are menus of checkbox rows (ui/check-row.tsx, the Jobs page's filter
 * rows), and a pick leaves the menu open for the next. A button picks up a
 * brand tint while its menu holds a change and is closed, as a Jobs page
 * facet does (jobs/filters.tsx), so the bar says a filter is in use.
 */
const IN_USE = "border-brand/50 bg-brand/10 text-brand hover:bg-brand/10";

const LABEL = Object.fromEntries(COLUMNS.map(({ id, label }) => [id, label])) as Record<
  ColumnId,
  string
>;

/**
 * Filters by Company, Track, Work Model and Source: one group per field,
 * listing every value the tracked applications hold (`options`, from the
 * server). Several picks in a field show any of them; picks in two fields
 * show what holds both.
 *
 * THE PICKS ARE THE URL (./query.ts), as the stage chips are, and the server
 * filters on them. A pick replaces the URL rather than pushing it, so ten
 * ticks are not ten steps of Back, and shows checked at once
 * (useOptimistic) while the narrowed list is drawn, as the Jobs page's
 * facets do. Its count beside the label says how many values are picked.
 */
export function FilterMenu({ options }: { options: Filters }) {
  const query = useApplicationsQuery();
  const router = useRouter();
  const [filters, setFilters] = useOptimistic(query.filters);
  const [open, setOpen] = useState(false);
  const count = filterCount(filters);
  const fields = FILTER_FIELDS.filter(({ key }) => options[key].length > 0);
  const inUse = count > 0 && !open;

  function toggle(key: FilterKey, value: string) {
    const picked = filters[key].includes(value)
      ? filters[key].filter((v) => v !== value)
      : [...filters[key], value];
    const next = { ...filters, [key]: picked };
    startTransition(() => {
      setFilters(next);
      router.replace(applicationsHref(query, { filters: next, app: null }), { scroll: false });
    });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        disabled={fields.length === 0}
        render={<Button variant="secondary" size="sm" className={cn(inUse && IN_USE)} />}
      >
        <FilterIcon className={inUse ? "text-brand" : "text-ink-meta"} />
        Filter
        {count > 0 && (
          <>
            <span className="tabular-nums">{count}</span>
            <span className="sr-only"> selected</span>
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-max max-w-[calc(100vw-2rem)] min-w-56">
        {fields.map(({ key, label }, i) => (
          <Fragment key={key}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel>{label}</DropdownMenuLabel>
              {options[key].map((value) => (
                <MenuPrimitive.CheckboxItem
                  key={value}
                  checked={filters[key].includes(value)}
                  onCheckedChange={() => toggle(key, value)}
                  closeOnClick={false}
                  className={checkRowClasses}
                >
                  <span className="truncate">{value}</span>
                  <CheckRowBox />
                </MenuPrimitive.CheckboxItem>
              ))}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Shows and hides the list's columns, in the table's own order, and resets
 * the layout: order, hidden columns and widths (./column-layout.ts). Company
 * and Role are listed but cannot be unticked: they are frozen.
 */
export function ColumnsMenu({ className }: { className?: string }) {
  const layout = useColumnLayout();
  const [open, setOpen] = useState(false);
  const inUse = layout.hidden.length > 0 && !open;

  function toggle(id: ColumnId, shown: boolean) {
    const hidden = layout.hidden.filter((other) => other !== id);
    setColumnLayout({ ...layout, hidden: shown ? hidden : [...hidden, id] });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={<Button variant="secondary" size="sm" className={cn(inUse && IN_USE, className)} />}
      >
        <ColumnsIcon className={inUse ? "text-brand" : "text-ink-meta"} />
        Columns
        {layout.hidden.length > 0 && (
          <span className="sr-only">, {layout.hidden.length} hidden</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Shown Columns</DropdownMenuLabel>
          {[...FROZEN, ...layout.order].map((id) => (
            <MenuPrimitive.CheckboxItem
              key={id}
              checked={!layout.hidden.includes(id)}
              disabled={FROZEN.includes(id)}
              onCheckedChange={(shown) => toggle(id, shown)}
              closeOnClick={false}
              className={checkRowClasses}
            >
              {LABEL[id]}
              <CheckRowBox />
            </MenuPrimitive.CheckboxItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!isCustomLayout(layout)}
          onClick={() => setColumnLayout(null)}
          className="font-medium"
        >
          Reset Columns
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
