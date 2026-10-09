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

/** Where: a search field that opens a dropdown checklist of every place that
 *  has a job, each country followed by its states, as GET /jobs/locations
 *  orders them; typing narrows it by name. The list opens only from the field
 *  and floats over the panel like any dropdown, so the sections below don't
 *  move; it stays open while places are ticked, and closes on Escape, on a
 *  click outside or when focus leaves it. What is ticked shows under the
 *  field as pills, each with a cross to take it off. Nothing is suggested
 *  before the seeker looks.
 *
 *  Not portaled: it stays inside the panel's scroll area, which has room for
 *  it below the field, the first thing in the panel. A combobox in the ARIA
 *  sense: the field owns the list (aria-controls) and a pointer press on a
 *  row keeps focus in the field (preventDefault), so ticking doesn't close
 *  it. */
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
  const listId = `${id}-list`;
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const needle = search.trim().toLowerCase();
  const byCode = new Map(options.map((o) => [o.code, o]));
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  const toggle = (code: string) =>
    onChange(values.includes(code) ? values.filter((v) => v !== code) : [...values, code]);

  // A press anywhere outside the field and its list closes it.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return (
    <div className="flex w-full flex-col gap-2.5">
      <div
        ref={root}
        className="relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
      >
        <label htmlFor={id} className="sr-only">
          Search a State or Country
        </label>
        <div className="border-border focus-within:ring-brand-ring flex h-9 items-center gap-2 rounded-md border px-2.5 focus-within:ring-2">
          <SearchIcon className="text-ink-meta size-4 shrink-0" />
          <input
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setOpen(true);
            }}
            onClick={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && open) {
                // Closes the list, not the panel around it.
                event.stopPropagation();
                setOpen(false);
              }
              if (event.key === "ArrowDown") setOpen(true);
            }}
            placeholder="Search a state or country"
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
            aria-label="Places"
            className="bg-popover ring-foreground/10 absolute inset-x-0 top-full z-20 mt-1 flex max-h-60 flex-col overflow-y-auto overscroll-contain rounded-md p-1 shadow-md ring-1"
          >
            {shown.length === 0 ? (
              <p className="text-note text-ink-meta px-2 py-1.5">No place by that name has jobs.</p>
            ) : (
              shown.map((o) => {
                // A state sits indented under its country, unless a search
                // has pulled it out of that order.
                const nested = o.code.includes("-") && !needle;
                const checked = values.includes(o.code);
                return (
                  <button
                    key={o.code}
                    type="button"
                    role="option"
                    aria-selected={checked}
                    // Keep focus in the field, so the list stays open.
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => toggle(o.code)}
                    className={cn(
                      "hover:bg-accent focus-visible:bg-accent text-body flex w-full items-center gap-2.5 rounded-md py-1.5 pr-2 text-left outline-hidden",
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
                    <span className="text-note text-ink-meta tabular-nums">
                      {o.jobs.toLocaleString("en-US")}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {values.length > 0 && (
        <ul aria-label="Picked Places" className="flex flex-wrap gap-2">
          {values.map((code) => {
            const label = byCode.get(code)?.label ?? code;
            return (
              <li
                key={code}
                className="border-brand bg-brand-tint text-brand text-note inline-flex h-8 items-center gap-1 rounded-full border pr-1 pl-3 font-medium"
              >
                {label}
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  onClick={() => toggle(code)}
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
