"use client";

import {
  Suspense,
  use,
  useEffect,
  useId,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import {
  BriefcaseIcon,
  CalendarIcon,
  ClockIcon,
  CoinIcon,
  LevelIcon,
  PinIcon,
  SearchIcon,
  VisaIcon,
  workStyleIcon,
} from "@/components/icons";
import { Dialog, DialogContent, DialogTitle } from "@/components/shadcn/dialog";
import { Button } from "@/components/ui/button";
import { SegmentedToggle } from "@/components/ui/segmented-control";
import { cn } from "@/lib/cn";

import { countJobs } from "./actions";
import {
  DATE_POSTED_OPTIONS,
  EXPERIENCE_OPTIONS,
  filtersQuery,
  JOB_TYPE_OPTIONS,
  NO_FILTERS,
  PAY_OPTIONS,
  seasonLabel,
  VISA_OPTIONS,
  WORKPLACE_OPTIONS,
  type FeedFilters,
  type PayPer,
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
  const count = useDraftCount(draft);

  const set = (change: Partial<FeedFilters>) => setDraft((d) => ({ ...d, ...change }));
  const countOf = (group: keyof JobFacets, value: string | number) =>
    counts[group].find((c) => c.value === String(value))?.jobs;

  return (
    <>
      {/* overscroll-contain: a fling past the end stops here instead of
          scrolling the page behind. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
        <Section Icon={PinIcon} label="Location" first>
          <LocationPicker
            options={places}
            values={draft.places}
            onChange={(next) => set({ places: next })}
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
            levels={draft.levels}
            minPay={draft.minPay}
            payPer={draft.payPer}
            onChange={(minPay, payPer) => set({ minPay, payPer })}
          />
        </Section>

        <div className="grid gap-x-6 sm:grid-cols-2">
          <Section Icon={CalendarIcon} label="Start Date">
            {counts.start_term.length === 0 ? (
              <p className="text-note text-ink-meta">No start dates in the feed yet.</p>
            ) : (
              counts.start_term.map((t) => (
                <Chip
                  key={t.value}
                  pressed={draft.startTerms.includes(t.value)}
                  count={t.jobs}
                  onClick={() =>
                    set({
                      startTerms: draft.startTerms.includes(t.value)
                        ? draft.startTerms.filter((v) => v !== t.value)
                        : [...draft.startTerms, t.value],
                    })
                  }
                >
                  {seasonLabel(t.value)}
                </Chip>
              ))
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
        <Button variant="ghost" size="sm" onClick={() => setDraft(NO_FILTERS)}>
          Clear All
        </Button>
        <Button size="sm" onClick={() => onApply(withoutCoveredStates(draft))}>
          {count == null
            ? "Show Jobs"
            : `Show ${count.toLocaleString("en-US")} ${count === 1 ? "Job" : "Jobs"}`}
        </Button>
      </div>
    </>
  );
}

/** The draft's job count, asked for a quarter second after the picks stop
 *  changing; the last one asked for wins. Null until the first answer, or
 *  when the API can't give one. */
function useDraftCount(draft: FeedFilters): number | null {
  const [count, setCount] = useState<number | null>(null);
  const query = filtersQuery(draft);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      countJobs(query).then((n) => {
        if (current) setCount(n);
      });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);
  return count;
}

/** `values` with `value` added or removed, kept in the options' order. */
function toggle<T>(values: T[], value: T, options: readonly { value: T }[]): T[] {
  const next = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
  return options.map((o) => o.value).filter((v) => next.includes(v));
}

/** A state whose country is also picked adds nothing: the country holds it. */
function withoutCoveredStates(filters: FeedFilters): FeedFilters {
  const countries = new Set(filters.places.filter((p) => !p.includes("-")));
  return {
    ...filters,
    places: filters.places.filter((p) => !p.includes("-") || !countries.has(p.split("-")[0])),
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

/** One option: a pill that is pressed or not, with its job count after the
 *  label. Pressed is the brand's tint, as a picked facet button is in the row. */
function Chip({
  pressed,
  count,
  Icon,
  onClick,
  children,
}: {
  pressed: boolean;
  count?: number;
  Icon?: Glyph;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "text-note focus-visible:ring-brand-ring inline-flex h-8 items-center gap-1.5 rounded-full border px-3 font-medium transition-[background-color,border-color,color,scale] duration-150 focus-visible:ring-2 focus-visible:outline-none active:scale-96",
        pressed
          ? "border-brand bg-brand-tint text-brand"
          : "border-border bg-panel text-ink hover:bg-well",
      )}
    >
      {Icon && <Icon className={cn("size-3.5 shrink-0", !pressed && "text-ink-meta")} />}
      {children}
      {count != null && (
        <span className={cn("tabular-nums", pressed ? "text-brand/70" : "text-ink-meta")}>
          {count.toLocaleString("en-US")}
        </span>
      )}
    </button>
  );
}

/** Where: a search over every place that has a job, and the places as chips.
 *  With nothing typed it shows the picks and the busiest places; typing finds
 *  any country or state by name. */
function LocationPicker({
  options,
  values,
  onChange,
}: {
  options: JobLocationOption[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const byCode = new Map(options.map((o) => [o.code, o]));
  const shown = needle
    ? options.filter((o) => o.label.toLowerCase().includes(needle)).slice(0, 12)
    : [
        ...values.map((v) => byCode.get(v)).filter((o) => o != null),
        ...[...options]
          .filter((o) => !values.includes(o.code))
          .sort((a, b) => b.jobs - a.jobs)
          .slice(0, 8),
      ];

  return (
    <div className="flex w-full flex-col gap-2.5">
      <label htmlFor={id} className="sr-only">
        Search a State or Country
      </label>
      <div className="border-border focus-within:ring-brand-ring flex h-9 items-center gap-2 rounded-md border px-2.5 focus-within:ring-2">
        <SearchIcon className="text-ink-meta size-4 shrink-0" />
        <input
          id={id}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search a state or country"
          className="text-body text-ink placeholder:text-ink-meta min-w-0 flex-1 bg-transparent outline-none"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {shown.length === 0 ? (
          <p className="text-note text-ink-meta">No place by that name has jobs.</p>
        ) : (
          shown.map((o) => (
            <Chip
              key={o.code}
              pressed={values.includes(o.code)}
              count={o.jobs}
              onClick={() =>
                onChange(
                  values.includes(o.code)
                    ? values.filter((v) => v !== o.code)
                    : [...values, o.code],
                )
              }
            >
              {o.label}
            </Chip>
          ))
        )}
      </div>
    </div>
  );
}

/** Pay: the presets for the career stage picked (hourly for internships,
 *  yearly for new grads, both otherwise), or "at least" any figure, with its
 *  unit. A preset and the field are one choice: picking either replaces the
 *  other. */
function SalaryPicker({
  levels,
  minPay,
  payPer,
  onChange,
}: {
  levels: FeedFilters["levels"];
  minPay: number | null;
  payPer: PayPer;
  onChange: (minPay: number | null, payPer: PayPer) => void;
}) {
  const id = useId();
  const units: PayPer[] =
    levels.length === 1 ? (levels[0] === "internship" ? ["hour"] : ["year"]) : ["hour", "year"];
  const preset = minPay != null && PAY_OPTIONS[payPer].some((o) => o.value === minPay);
  const [draft, setDraft] = useState(minPay != null && !preset ? String(minPay) : "");

  function typed(value: string, per: PayPer) {
    setDraft(value);
    const amount = Number(value);
    onChange(value.trim() !== "" && Number.isFinite(amount) && amount > 0 ? amount : null, per);
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {units.map((unit) => (
        <div key={unit} className="flex flex-wrap items-center gap-2">
          {units.length > 1 && (
            <span className="text-note text-ink-meta w-14">
              {unit === "hour" ? "Hourly" : "Yearly"}
            </span>
          )}
          {PAY_OPTIONS[unit].map((o) => {
            const checked = minPay === o.value && payPer === unit;
            return (
              <Chip
                key={o.value}
                pressed={checked}
                onClick={() => {
                  setDraft("");
                  onChange(checked ? null : o.value, unit);
                }}
              >
                {o.label}
              </Chip>
            );
          })}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-note text-ink-meta">
          Or At Least
        </label>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={1}
          value={draft}
          onChange={(event) => typed(event.target.value, payPer)}
          placeholder={payPer === "hour" ? "42" : "95000"}
          className="border-border text-body text-ink focus-visible:ring-brand-ring placeholder:text-ink-meta h-8 w-28 rounded-md border px-2.5 outline-none focus-visible:ring-2"
        />
        <SegmentedToggle
          label="Pay Unit"
          options={[
            { value: "hour", label: "/hr", ariaLabel: "Per hour" },
            { value: "year", label: "/yr", ariaLabel: "Per year" },
          ]}
          value={payPer}
          onValueChange={(value) => typed(draft, value as PayPer)}
        />
      </div>
    </div>
  );
}
