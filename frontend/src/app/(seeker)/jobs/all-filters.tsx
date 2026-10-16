"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, use, useEffect, useState, type ComponentType, type ReactNode } from "react";

import {
  BriefcaseIcon,
  CalendarIcon,
  ClockIcon,
  CoinIcon,
  LevelIcon,
  PinIcon,
  RoleIcon,
  VisaIcon,
  workStyleIcon,
} from "@/components/icons";
import { Dialog, DialogContent, DialogTitle } from "@/components/shadcn/dialog";
import { OptionChip as Chip, SalaryPicker, SearchPicker } from "@/components/filter-controls";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import { countJobs } from "./actions";
import {
  DATE_POSTED_OPTIONS,
  EXPERIENCE_OPTIONS,
  feedQuery,
  JOB_TYPE_OPTIONS,
  NO_FILTERS,
  PAY_OPTIONS,
  payUnits,
  seasonLabel,
  VISA_OPTIONS,
  WORKPLACE_OPTIONS,
  type FeedFilters,
} from "./filter-query";
import type { JobFacets, JobLocationOption } from "./listings";

/**
 * ALL FILTERS IS ONE PANEL WITH EVERY OPTION IN VIEW (KAN-170), after
 * Airbnb's filters and LinkedIn's "All filters": a section per facet under
 * the glyph the job card draws for it, each option a chip with its job count.
 * It used to be a sheet of the row's dropdown buttons, which opened popups
 * inside a popup that landed left or right of their button depending on the
 * room. No popups in here.
 *
 * PICKS ARE A DRAFT UNTIL "SHOW 128 JOBS". The panel edits its own copy of
 * the filters; the feed is untouched until the button applies them, so a
 * dozen taps are one navigation, not a dozen. The button counts the draft as
 * it changes (GET /jobs/count through ./actions), so the seeker sees an empty
 * result before committing to it. Closing without it discards the draft.
 *
 * The body is mounted only while the panel is open, so each opening starts
 * from the filters the URL holds.
 */
export function AllFiltersPanel({
  open,
  onOpenChange,
  filters,
  locations,
  facets,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: FeedFilters;
  locations: Promise<JobLocationOption[]>;
  facets: Promise<JobFacets>;
  onApply: (filters: FeedFilters) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(44rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <div className="border-border-subtle flex items-center border-b px-5 py-3.5 pr-12">
          <DialogTitle className="text-subtitle font-semibold">All Filters</DialogTitle>
        </div>
        <Suspense
          fallback={<p className="text-body text-ink-meta px-5 py-8">Loading the filters…</p>}
        >
          <PanelBody
            filters={filters}
            locations={locations}
            facets={facets}
            onApply={(next) => {
              onApply(next);
              onOpenChange(false);
            }}
          />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}

type Glyph = ComponentType<{ className?: string }>;

function PanelBody({
  filters,
  locations,
  facets,
  onApply,
}: {
  filters: FeedFilters;
  locations: Promise<JobLocationOption[]>;
  facets: Promise<JobFacets>;
  onApply: (filters: FeedFilters) => void;
}) {
  const places = use(locations);
  const counts = use(facets);
  const [draft, setDraft] = useState(filters);
  // Bumped by Clear All: the pickers below keep what is typed in them (a
  // search, a salary figure) in their own state, so they are remounted empty.
  const [cleared, setCleared] = useState(0);
  const count = useDraftCount(draft);

  const set = (change: Partial<FeedFilters>) => setDraft((d) => ({ ...d, ...change }));
  const countOf = (group: keyof JobFacets, value: string | number) =>
    counts[group].find((c) => c.value === String(value))?.jobs;

  return (
    <>
      {/* overscroll-contain: a fling past the end stops here instead of
          scrolling the page behind. */}
      <div data-panel-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
        <Section Icon={PinIcon} label="Location" first>
          <SearchPicker
            key={`places-${cleared}`}
            label="Places"
            placeholder="Search a state or country"
            empty="No place by that name has jobs."
            options={places.map((p) => ({
              value: p.code,
              label: p.label,
              count: p.jobs,
              nested: p.code.includes("-"),
            }))}
            values={draft.places}
            onChange={(next) => set({ places: next })}
          />
        </Section>

        {/* Full width, as Location: its names are long, and the row puts it
            second. The job_roles that tag a job, in the database's order,
            from GET /jobs/facets (KAN-155). */}
        <Section Icon={RoleIcon} label="Role">
          <SearchPicker
            key={`roles-${cleared}`}
            label="Roles"
            placeholder="Search a role"
            empty="No role by that name."
            options={counts.role.map((o) => ({
              value: o.value,
              label: o.label,
              count: o.jobs,
              nested: false,
            }))}
            values={draft.roles}
            onChange={(next) => set({ roles: next })}
          />
        </Section>

        <div className="grid gap-x-6 sm:grid-cols-2">
          <Section Icon={BriefcaseIcon} label="Job Type">
            {JOB_TYPE_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                pressed={draft.jobTypes.includes(o.value)}
                count={countOf("job_type", o.value)}
                onClick={() => set({ jobTypes: toggle(draft.jobTypes, o.value, JOB_TYPE_OPTIONS) })}
              >
                {o.label}
              </Chip>
            ))}
          </Section>

          <Section Icon={workStyleIcon("onsite")} label="Workplace">
            {WORKPLACE_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                Icon={workStyleIcon(o.value)}
                pressed={draft.workStyles.includes(o.value)}
                count={countOf("work_style", o.value)}
                onClick={() =>
                  set({ workStyles: toggle(draft.workStyles, o.value, WORKPLACE_OPTIONS) })
                }
              >
                {o.label}
              </Chip>
            ))}
          </Section>

          <Section Icon={LevelIcon} label="Experience">
            {EXPERIENCE_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                pressed={draft.levels.includes(o.value)}
                count={countOf("experience", o.value)}
                onClick={() => set({ levels: toggle(draft.levels, o.value, EXPERIENCE_OPTIONS) })}
              >
                {o.label}
              </Chip>
            ))}
          </Section>

          <Section Icon={ClockIcon} label="Date Posted">
            <Chip pressed={draft.postedWithin == null} onClick={() => set({ postedWithin: null })}>
              Any Time
            </Chip>
            {DATE_POSTED_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                pressed={draft.postedWithin === o.value}
                count={countOf("posted_within", o.value)}
                onClick={() =>
                  set({ postedWithin: draft.postedWithin === o.value ? null : o.value })
                }
              >
                {o.label}
              </Chip>
            ))}
          </Section>
        </div>

        <Section Icon={CoinIcon} label="Salary">
          <SalaryPicker
            key={`pay-${cleared}`}
            units={payUnits(draft.jobTypes)}
            presets={PAY_OPTIONS}
            minPay={draft.minPay}
            maxPay={draft.maxPay}
            payPer={draft.payPer}
            onChange={(minPay, maxPay, payPer) => set({ minPay, maxPay, payPer })}
          />
        </Section>

        <div className="grid gap-x-6 sm:grid-cols-2">
          <Section Icon={CalendarIcon} label="Start Date">
            {counts.start_term.length === 0 ? (
              <p className="text-note text-ink-meta">No start dates in the feed yet.</p>
            ) : (
              <SearchPicker
                key={`seasons-${cleared}`}
                label="Start Dates"
                placeholder="Search a season"
                empty="No season by that name has jobs."
                options={counts.start_term.map((t) => ({
                  value: t.value,
                  label: seasonLabel(t.value),
                  count: t.jobs,
                }))}
                values={draft.startTerms}
                onChange={(next) => set({ startTerms: next })}
              />
            )}
          </Section>

          <Section Icon={VisaIcon} label="Visa">
            {VISA_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                pressed={draft.visa === o.value}
                count={countOf("visa", o.value)}
                onClick={() => set({ visa: draft.visa === o.value ? null : o.value })}
              >
                {o.label}
              </Chip>
            ))}
          </Section>
        </div>
      </div>

      <div className="border-border-subtle flex items-center justify-between gap-3 border-t px-5 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDraft(NO_FILTERS);
            setCleared((n) => n + 1);
          }}
        >
          Clear All
        </Button>
        <Button size="sm" onClick={() => onApply(statesNarrowCountries(draft))}>
          {count == null
            ? "Show Jobs"
            : `Show ${count.toLocaleString("en-US")} ${count === 1 ? "Job" : "Jobs"}`}
        </Button>
      </div>
    </>
  );
}

/** The draft's job count, asked for a quarter second after the picks stop
 *  changing; the last one asked for wins. On /search it counts within the
 *  search's words (`?q`), as the results there are. Null while the current picks are
 *  being counted (the button says "Show Jobs" rather than the last picks'
 *  number, which a quick click would otherwise apply under), and when the
 *  API can't give one. */
function useDraftCount(draft: FeedFilters): number | null {
  const [answer, setAnswer] = useState<{ query: string; n: number | null } | null>(null);
  const query = feedQuery(draft, useSearchParams().get("q") ?? "");
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      countJobs(query)
        .catch(() => null)
        .then((n) => {
          if (current) setAnswer({ query, n });
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);
  return answer?.query === query ? answer.n : null;
}

/** `values` with `value` added or removed, kept in the options' order. */
function toggle<T>(values: T[], value: T, options: readonly { value: T }[]): T[] {
  const next = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
  return options.map((o) => o.value).filter((v) => next.includes(v));
}

/** A picked state narrows its country: United States and California is
 *  California, the same rule as the row's Location (ticksFrom/placesFrom in
 *  ./filters), so the two give one feed for the same picks. */
function statesNarrowCountries(filters: FeedFilters): FeedFilters {
  return {
    ...filters,
    places: filters.places.filter(
      (p) => p.includes("-") || !filters.places.some((q) => q.startsWith(`${p}-`)),
    ),
  };
}

/** One facet's section: its card glyph and name over its chips. */
function Section({
  Icon,
  label,
  first = false,
  children,
}: {
  Icon: Glyph;
  label: string;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={cn("py-4", !first && "border-border-subtle border-t")}>
      <h3 className="text-body text-ink mb-2.5 flex items-center gap-2 font-semibold">
        <Icon className="text-ink-meta size-4 shrink-0" />
        {label}
      </h3>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </section>
  );
}
