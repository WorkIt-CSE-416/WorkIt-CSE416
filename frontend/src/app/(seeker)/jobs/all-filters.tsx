"use client";

import {
  Suspense,
  use,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import {
  BriefcaseIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  CloseIcon,
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
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
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
            levels={draft.levels}
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
 *  changing; the last one asked for wins. Null while the current picks are
 *  being counted (the button says "Show Jobs" rather than the last picks'
 *  number, which a quick click would otherwise apply under), and when the
 *  API can't give one. */
function useDraftCount(draft: FeedFilters): number | null {
  const [answer, setAnswer] = useState<{ query: string; n: number | null } | null>(null);
  const query = filtersQuery(draft);
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

type PickOption = {
  value: string;
  label: string;
  count?: number;
  /** Drawn indented under the option before it (a state under its country)
   *  while nothing is typed. */
  nested?: boolean;
};

/** A search field that opens a dropdown checklist, and what is ticked as
 *  pills under it, each with a cross to take it off: Location (every place,
 *  each country followed by its states) and Start Date (the seasons). The
 *  list opens only from the field (a click, typing or ArrowDown) and floats
 *  over the panel like any dropdown, so the sections below don't move; it
 *  stays open while options are ticked, and closes on Escape (which stops
 *  there, short of closing the panel), on a press outside, or when focus
 *  leaves it. Nothing is suggested before the seeker looks.
 *
 *  A combobox in the ARIA sense: focus stays in the field, Up and Down move
 *  the active option (aria-activedescendant), Enter ticks it, and the options
 *  are out of the Tab order, so a keyboard user leaves the list with one Tab
 *  rather than one per option. A press on any part of the field or list keeps
 *  focus in the field (preventDefault), so it never blurs the list shut.
 *
 *  Not portaled: it stays inside the panel's scroll area, which has room for
 *  it below the field. */
function SearchPicker({
  label,
  placeholder,
  empty,
  options,
  values,
  onChange,
}: {
  /** The list's accessible name, and the picks' ("Picked Places"). */
  label: string;
  placeholder: string;
  /** What the list says when the search matches nothing. */
  empty: string;
  options: PickOption[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-option-${i}`;
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const needle = search.trim().toLowerCase();
  const byValue = new Map(options.map((o) => [o.value, o]));
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  const current = Math.min(active, Math.max(shown.length - 1, 0));
  const toggle = (value: string) =>
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);

  function openList() {
    setOpen(true);
    input.current?.focus();
  }

  // A press anywhere outside the field and its list closes it.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  // Keep the active option in view as the arrows move it; only when it moves,
  // so a wheel scroll through the list isn't pulled back by a re-render.
  const activeId = optionId(current);
  useEffect(() => {
    if (open) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [open, activeId]);

  return (
    <div className="flex w-full flex-col gap-2.5">
      <div
        ref={root}
        className="relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
        onKeyDown={(event) => {
          // Closes the list, not the panel around it, wherever focus is.
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <label htmlFor={id} className="sr-only">
          {placeholder}
        </label>
        {/* A press on the field's padding or chevron opens the list and
            keeps focus in the input rather than blurring it shut. */}
        <div
          onPointerDown={(event) => {
            if (event.target !== input.current) {
              event.preventDefault();
              openList();
            }
          }}
          className="border-border focus-within:ring-brand-ring flex h-9 cursor-text items-center gap-2 rounded-md border px-2.5 focus-within:ring-2"
        >
          <SearchIcon className="text-ink-meta size-4 shrink-0" />
          <input
            ref={input}
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && shown.length > 0 ? optionId(current) : undefined}
            autoComplete="off"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onClick={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!open) return setOpen(true);
                const step = event.key === "ArrowDown" ? 1 : -1;
                setActive(Math.min(Math.max(current + step, 0), shown.length - 1));
              } else if (event.key === "Enter" && open && shown[current]) {
                event.preventDefault();
                toggle(shown[current].value);
              }
            }}
            placeholder={placeholder}
            className="text-body text-ink placeholder:text-ink-meta min-w-0 flex-1 bg-transparent outline-none"
          />
          <ChevronDownIcon
            className={cn(
              "text-ink-meta size-4 shrink-0 transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </div>

        {open && (
          // overscroll-contain: the list's own scroll stops at its ends
          // instead of moving the panel behind it.
          <div
            id={listId}
            role="listbox"
            aria-multiselectable="true"
            aria-label={label}
            // Presses anywhere in the list keep focus in the field.
            onPointerDown={(event) => event.preventDefault()}
            className="bg-popover ring-foreground/10 absolute inset-x-0 top-full z-20 mt-1 flex max-h-60 flex-col overflow-y-auto overscroll-contain rounded-md p-1 shadow-md ring-1"
          >
            {shown.length === 0 ? (
              <p className="text-note text-ink-meta px-2 py-1.5">{empty}</p>
            ) : (
              shown.map((o, i) => {
                // Indented under its parent, unless a search has pulled it
                // out of that order.
                const nested = o.nested && !needle;
                const checked = values.includes(o.value);
                return (
                  <div
                    key={o.value}
                    id={optionId(i)}
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggle(o.value)}
                    onPointerMove={() => i !== current && setActive(i)}
                    className={cn(
                      "text-body flex w-full cursor-pointer items-center gap-2.5 rounded-md py-1.5 pr-2 text-left",
                      i === current && "bg-accent",
                      nested ? "pl-7" : "pl-2",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "border-ink-meta text-primary-foreground flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                        checked && "border-primary bg-primary",
                      )}
                    >
                      <CheckIcon className={cn("size-3.5", !checked && "opacity-0")} />
                    </span>
                    <span className={cn("min-w-0 flex-1 truncate", !nested && "font-medium")}>
                      {o.label}
                    </span>
                    {o.count != null && (
                      <span className="text-note text-ink-meta tabular-nums">
                        {o.count.toLocaleString("en-US")}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {values.length > 0 && (
        <ul aria-label={`Picked ${label}`} className="flex flex-wrap gap-2">
          {values.map((value) => {
            const name = byValue.get(value)?.label ?? value;
            return (
              <li
                key={value}
                className="border-brand bg-brand-tint text-brand text-note inline-flex h-8 items-center gap-1 rounded-full border pr-1 pl-3 font-medium"
              >
                {name}
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => toggle(value)}
                  className="hover:bg-brand/10 focus-visible:ring-brand-ring flex size-6 items-center justify-center rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none active:scale-90"
                >
                  <CloseIcon className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Pay as a range, in US dollars, by the hour or the year. The presets fill
 *  the minimum for the career stage picked (hourly for internships, yearly for
 *  new grads, both otherwise) and leave the maximum open; the fields take any
 *  figures, either end left empty. A posting matches when its own pay range
 *  overlaps this one, whatever unit it was posted in (routers/jobs.py). */
function SalaryPicker({
  levels,
  minPay,
  maxPay,
  payPer,
  onChange,
}: {
  levels: FeedFilters["levels"];
  minPay: number | null;
  maxPay: number | null;
  payPer: PayPer;
  onChange: (minPay: number | null, maxPay: number | null, payPer: PayPer) => void;
}) {
  const id = useId();
  const units: PayPer[] =
    levels.length === 1 ? (levels[0] === "internship" ? ["hour"] : ["year"]) : ["hour", "year"];
  const [minText, setMinText] = useState(minPay != null ? String(minPay) : "");
  const [maxText, setMaxText] = useState(maxPay != null ? String(maxPay) : "");
  const parse = (text: string) => {
    const n = Number(text);
    return text.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
  };
  const per = payPer === "hour" ? "/hr" : "/yr";

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
            const checked = minPay === o.value && maxPay == null && payPer === unit;
            return (
              <Chip
                key={o.value}
                pressed={checked}
                onClick={() => {
                  setMinText(checked ? "" : String(o.value));
                  setMaxText("");
                  onChange(checked ? null : o.value, null, unit);
                }}
              >
                {o.label}
              </Chip>
            );
          })}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <MoneyField
          id={`${id}-min`}
          label="Minimum Pay"
          placeholder={payPer === "hour" ? "30" : "80000"}
          unit={per}
          value={minText}
          onChange={(text) => {
            setMinText(text);
            onChange(parse(text), parse(maxText), payPer);
          }}
        />
        <span aria-hidden className="text-ink-meta">
          –
        </span>
        <MoneyField
          id={`${id}-max`}
          label="Maximum Pay"
          placeholder={payPer === "hour" ? "50" : "120000"}
          unit={per}
          value={maxText}
          onChange={(text) => {
            setMaxText(text);
            onChange(parse(minText), parse(text), payPer);
          }}
        />
        <SegmentedToggle
          label="Pay Unit"
          options={[
            { value: "hour", label: "/hr", ariaLabel: "Per hour" },
            { value: "year", label: "/yr", ariaLabel: "Per year" },
          ]}
          value={payPer}
          // The figures stay; only what they are per changes.
          onValueChange={(value) => onChange(parse(minText), parse(maxText), value as PayPer)}
        />
      </div>
    </div>
  );
}

/** A dollar amount: "$" before the figure and its unit after, inside one
 *  field, so it reads as "$ 30 /hr" without a label to decode. */
function MoneyField({
  id,
  label,
  placeholder,
  unit,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="border-border focus-within:ring-brand-ring text-body flex h-8 w-36 items-center gap-1 rounded-md border px-2.5 focus-within:ring-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span aria-hidden className="text-ink-meta">
        $
      </span>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={1}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="text-ink placeholder:text-ink-meta min-w-0 flex-1 [appearance:textfield] bg-transparent tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span aria-hidden className="text-note text-ink-meta">
        {unit}
      </span>
    </div>
  );
}
