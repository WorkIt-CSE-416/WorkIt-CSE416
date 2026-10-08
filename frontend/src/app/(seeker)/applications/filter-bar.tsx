"use client";

import Form from "next/form";
import Link from "next/link";

import { CloseIcon } from "@/components/icons";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/cn";

import { STAGE_COLOR, STAGE_LABEL, STAGE_ORDER, type StageKey } from "../stage-colors";
import { applicationsHref, DEFAULT_SORT, DEFAULT_VIEW } from "./query";
import { useApplicationsQuery } from "./view-switcher";

/**
 * The Applications filters: a search over role and company, then one chip
 * per stage. It replaced a Filter button that opened nothing.
 *
 * EVERYTHING HERE IS A URL, like the view switcher beside the title (./query.ts).
 * The search is a GET form, a `next/form`, so pressing Enter navigates with
 * `?q=` set and the views below re-render on the server; the current view,
 * stages and sort ride along as hidden fields so a search does not reset
 * them. The field is keyed by the query it shows, so it empties when Clear
 * Filters navigates away from a search, which an uncontrolled field would not
 * do on its own.
 *
 * A stage chip is a link that toggles its stage in `?stage=`. Several can be
 * on at once, and none on shows every stage. On, a chip takes its stage's
 * tint and a cross; off, it is a white outline with the stage's dot, so the
 * stage colours read the same here as on the board. Its count is how many
 * applications the search leaves in that stage, so a chip says what turning
 * it on will show. The chip is its own small link rather than
 * ui/filter-chip.tsx, whose chevron promises a menu.
 *
 * A CLIENT COMPONENT, reading the URL itself (useApplicationsQuery), because
 * the layout switch moves the URL in place and never asks the server to draw
 * this bar again: drawn there, its chips and its search would carry the old
 * layout and send the page back to it. The counts still come from the
 * server, which does the filtering.
 */
export function FilterBar({ counts }: { counts: Record<StageKey, number> }) {
  const query = useApplicationsQuery();
  const filtered = query.stages.length > 0 || query.q !== "";

  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
      <Form action="/applications" className="w-full @lg/main:w-64">
        {query.view !== DEFAULT_VIEW && <input type="hidden" name="view" value={query.view} />}
        {query.stages.length > 0 && (
          <input type="hidden" name="stage" value={query.stages.join(",")} />
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

          return (
            <Link
              key={stage}
              href={applicationsHref(query, { stages, app: null })}
              scroll={false}
              className={cn(
                // Its tint fades in or out as it is turned on or off, and it
                // presses in on the click like every button.
                "text-note focus-visible:ring-brand-ring ease-glide inline-flex h-8 items-center gap-1.5 rounded-full border px-3 font-medium transition-[color,background-color,border-color,transform] duration-200 focus-visible:ring-2 focus-visible:outline-none active:scale-95",
                active
                  ? cn("border-transparent", STAGE_COLOR[stage].tint, STAGE_COLOR[stage].onTint)
                  : "border-border-subtle bg-panel text-ink-meta hover:border-border hover:text-ink",
              )}
            >
              <span
                aria-hidden="true"
                className={cn("size-2 shrink-0 rounded-full", STAGE_COLOR[stage].fill)}
              />
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
            </Link>
          );
        })}
      </div>

      {filtered && (
        <ClearFiltersLink className="text-label text-brand hover:text-brand-hover focus-visible:ring-brand-ring animate-fade rounded-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none" />
      )}
    </div>
  );
}

/** Drops the stages and the search, keeping the layout the URL names now:
 *  the bar's own link, and the empty state's button. */
export function ClearFiltersLink({ className }: { className: string }) {
  const query = useApplicationsQuery();

  return (
    <Link
      href={applicationsHref(query, { stages: [], q: "", app: null })}
      scroll={false}
      className={className}
    >
      Clear Filters
    </Link>
  );
}
