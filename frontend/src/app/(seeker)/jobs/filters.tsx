"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  Suspense,
  type ComponentType,
  startTransition,
  use,
  useId,
  useOptimistic,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  BriefcaseIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  CoinIcon,
  FilterIcon,
  LevelIcon,
  PinIcon,
  workStyleIcon,
} from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/shadcn/sheet";
import { Button, buttonClasses } from "@/components/ui/button";
import { SegmentedToggle } from "@/components/ui/segmented-control";
import {
  Select,
  SelectCheckboxItem,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

import {
  DATE_POSTED_OPTIONS,
  EXPERIENCE_OPTIONS,
  FILTER_KEYS,
  filterEntries,
  JOB_TYPE_OPTIONS,
  NO_FILTERS,
  PAY_OPTIONS,
  WORKPLACE_OPTIONS,
  isFiltered,
  type FeedFilters,
  type PayPer,
} from "./filter-query";
import type { JobLocationOption } from "./listings";

/**
 * The filter row on /jobs and on /search, built on Base UI's `Select` (via
 * `@/components/ui/select`) instead of the inert chips `FilterChip`'s own doc
 * comment said would get a menu one day; /search drew those chips until it
 * moved onto the live feed. A Select rather than a Combobox because there is
 * no search field: Base UI's Combobox handles arrow keys and Enter on its
 * input, so without one its list cannot be reached from the keyboard at all.
 *
 * EVERY FACET FILTERS, ON THE SERVER (KAN-170). Its picks are the page's
 * query (./filter-query owns the names, the options and the reading), so the
 * server fetches the feed narrowed to them and a reload or a shared link
 * keeps them. A pick replaces the URL rather than pushing it, so ticking five
 * boxes is not five steps of Back, and shows checked at once (useOptimistic)
 * while the narrowed feed is fetched. Each is a button that opens a list of
 * options. The button's own label never changes (a facet's picks show up as
 * checked items inside the popup, not as chips on the trigger), and the
 * trigger picks up a brand tint once a pick has been made and the popup has
 * closed, the one visible signal that a facet is in use. A screen reader hears
 * the same thing as the pick count after the label.
 *
 * EACH FACET WEARS ITS FACT'S GLYPH, the one the job card draws beside the
 * same fact (Location's pin, Salary's coin, Job Type's briefcase, Experience's
 * mortarboard), so the row and the card read as one vocabulary. Date Posted
 * takes a clock, not the card's calendar, which there means the start date.
 * Inside a popup an option has a glyph only where it differs by option:
 * Workplace's building, two arrows and house, exactly as the card picks them
 * (workStyleIcon). The same briefcase on every Job Type row would say nothing
 * the button doesn't. Glyphs are ink-meta, as on the card, and brand once the
 * facet is in use, with its label.
 *
 * Location and Salary are Popovers rather than Selects: Location for its two
 * panels (LocationFacet says why), Salary for its "At least" field
 * (SalaryFacet). Job Type is how the job is set up and Experience the career
 * stage, kept apart on purpose: "Internship" is only ever the second.
 */

/** The look every facet's button shares, Select or Popover: a small
 *  secondary button that picks up a brand tint once the facet has a pick and
 *  its popup is closed, the one visible signal that it is in use. */
function facetTriggerClasses(count: number, open: boolean, className?: string) {
  return cn(
    buttonClasses({ variant: "secondary", size: "sm" }),
    "h-auto justify-between",
    count > 0 && !open && "border-brand/50 bg-brand/10 text-brand hover:bg-brand/10",
    className,
  );
}

type Glyph = ComponentType<{ className?: string }>;

/** A facet button's glyph and label, the glyph in the card's grey until the
 *  facet is in use, then in the brand with the label. */
function FacetLabel({ Icon, label, active }: { Icon: Glyph; label: string; active: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Icon className={cn("size-4 shrink-0", active ? "text-brand" : "text-ink-meta")} />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** The button every facet opens from. Its label is static (a facet's picks
 *  never rewrite it), so the only thing that changes is the tint. The tint is
 *  colour alone, so the pick count rides after the label for a screen reader.
 *
 *  The vendored SelectTrigger is a form field, so the button's look is laid
 *  over it: `data-[size=default]:h-auto` undoes its fixed height, and
 *  `data-placeholder:text-ink` its grey label while nothing is picked. */
function FacetTrigger({
  Icon,
  label,
  count,
  open,
  className,
}: {
  Icon: Glyph;
  label: string;
  /** How many options are picked. */
  count: number;
  open: boolean;
  className?: string;
}) {
  return (
    <SelectTrigger
      className={facetTriggerClasses(
        count,
        open,
        cn("data-placeholder:text-ink data-[size=default]:h-auto", className),
      )}
    >
      <FacetLabel Icon={Icon} label={label} active={count > 0 && !open} />
      {count > 0 && <span className="sr-only">, {count} selected</span>}
    </SelectTrigger>
  );
}

type Option = { value: string; label: string; Icon?: Glyph };

/** The list shared by every facet's popup: checkbox rows where a facet takes
 *  several picks, the vendored check-mark rows where it takes one. */
function FacetPopup({ options, multiple }: { options: readonly Option[]; multiple: boolean }) {
  const Item = multiple ? SelectCheckboxItem : SelectItem;

  return (
    <SelectContent>
      {options.map((option) => (
        <Item key={option.value} value={option.value}>
          {option.Icon ? (
            <span className="flex items-center gap-2">
              <option.Icon className="text-ink-meta size-4 shrink-0" />
              {option.label}
            </span>
          ) : (
            option.label
          )}
        </Item>
      ))}
    </SelectContent>
  );
}

/** One facet. By default every option is a checkbox, so the facet takes any
 *  number of picks, and picking one leaves the popup open for the next.
 *
 *  `multiple={false}` is for nested thresholds (date posted, salary), where
 *  "Past 24 Hours" sits inside "Past Week" and ticking both says nothing. It
 *  takes one pick and closes on it. Picking the checked option again clears
 *  it: Base UI reports that press with the same value, and with no "Any"
 *  option there is otherwise no way back to no pick from the row. */
function Facet({
  Icon,
  label,
  options,
  values,
  onChange,
  multiple = true,
  className,
}: {
  Icon: Glyph;
  label: string;
  options: readonly Option[];
  values: string[];
  onChange: (values: string[]) => void;
  multiple?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = (
    <FacetTrigger
      Icon={Icon}
      label={label}
      count={values.length}
      open={open}
      className={className}
    />
  );

  if (!multiple) {
    return (
      <Select
        value={values[0] ?? null}
        onValueChange={(value) =>
          onChange(value == null || value === values[0] ? [] : [value as string])
        }
        onOpenChange={setOpen}
      >
        {trigger}
        <FacetPopup options={options} multiple={false} />
      </Select>
    );
  }

  return (
    <Select
      // In the options' order, whatever order they were ticked in.
      value={values}
      onValueChange={(next: string[]) =>
        onChange(options.map((o) => o.value).filter((v) => next.includes(v)))
      }
      onOpenChange={setOpen}
      multiple
    >
      {trigger}
      <FacetPopup options={options} multiple />
    </Select>
  );
}

/** "US" for "US-CA", and for "US" itself. */
const countryOf = (code: string) => code.split("-")[0];
const isState = (code: string) => code.includes("-");

/** The URL's places as the popup's ticks: a state ticks its country too. */
function ticksFrom(places: readonly string[]): string[] {
  return [...new Set(places.flatMap((code) => (isState(code) ? [countryOf(code), code] : [code])))];
}

/** The popup's ticks as the URL's places. A country alone means all of it; a
 *  country with states ticked means just those states. */
function placesFrom(ticks: readonly string[]): string[] {
  return ticks
    .filter((code) => !isState(code))
    .flatMap((country) => {
      const states = ticks.filter((code) => isState(code) && countryOf(code) === country);
      return states.length > 0 ? states : [country];
    });
}

/** One row of the Location popup: a label and a box, the same look as the
 *  Select facets' SelectCheckboxItem, as a real checkbox button. `current`
 *  marks the country whose states the other panel lists. */
function CheckRow({
  label,
  checked,
  current = false,
  role = "checkbox",
  onToggle,
}: {
  label: string;
  checked: boolean;
  current?: boolean;
  /** "radio" for one choice among the rows of a radiogroup (Salary). */
  role?: "checkbox" | "radio";
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        "hover:bg-accent focus-visible:bg-accent text-body flex w-full items-center justify-between gap-3 rounded-md py-1 pr-1.5 pl-2 text-left outline-hidden",
        current && "bg-accent",
      )}
    >
      {label}
      <span
        aria-hidden
        className={cn(
          "border-ink-meta text-primary-foreground flex size-4 shrink-0 items-center justify-center border transition-colors",
          role === "radio" ? "rounded-full" : "rounded-[4px]",
          checked && "border-primary bg-primary",
        )}
      >
        <CheckIcon className={cn("size-3.5", !checked && "opacity-0")} />
      </span>
    </button>
  );
}

/** A panel's small heading. */
function PanelHeading({ children }: { children: ReactNode }) {
  return <p className="text-note text-ink-meta px-2 pt-1 pb-1.5">{children}</p>;
}

/** Location once its options have arrived: a popover of two panels,
 *  countries on the left ("United States", "Other") and the states of the
 *  ticked country on the right. Ticking a country means all of it and opens
 *  its states beside it; ticking states narrows it to those. Unticking the
 *  country drops its states with it.
 *
 *  A Popover, not a Select like the other facets: a Select draws one list,
 *  and states nested in it read as one long dropdown. `values` and
 *  `onChange` speak the URL's places, never the ticks. */
function LocationFacet({
  locations,
  values,
  onChange,
  className,
}: {
  locations: Promise<JobLocationOption[]>;
  values: string[];
  onChange: (values: string[]) => void;
  className?: string;
}) {
  const options = use(locations);
  const [open, setOpen] = useState(false);
  // The country whose states the right panel lists: the last one ticked
  // that has states, else the first ticked one that does.
  const [picked, setPicked] = useState<string | null>(null);

  const ticks = ticksFrom(values);
  const countries = options.filter(({ code }) => !isState(code));
  const statesOf = (country: string) =>
    options.filter(({ code }) => isState(code) && countryOf(code) === country);
  const hasStates = (country: string) => statesOf(country).length > 0;
  const shown =
    (picked != null && ticks.includes(picked) ? picked : null) ??
    countries.find(({ code }) => ticks.includes(code) && hasStates(code))?.code ??
    null;

  function toggleCountry(country: string) {
    if (ticks.includes(country)) {
      onChange(placesFrom(ticks.filter((code) => countryOf(code) !== country)));
    } else {
      if (hasStates(country)) setPicked(country);
      onChange(placesFrom([...ticks, country]));
    }
  }

  function toggleState(state: string) {
    onChange(
      placesFrom(
        ticks.includes(state) ? ticks.filter((code) => code !== state) : [...ticks, state],
      ),
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={options.length === 0}
        className={facetTriggerClasses(ticks.length, open, className)}
      >
        <FacetLabel Icon={PinIcon} label="Location" active={ticks.length > 0 && !open} />
        {ticks.length > 0 && <span className="sr-only">, {ticks.length} selected</span>}
        <ChevronDownIcon className="text-muted-foreground size-4" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="Location"
        className="w-auto max-w-[calc(100vw-2rem)] flex-col gap-0 p-1 sm:flex-row"
      >
        <div role="group" aria-label="Countries" className="flex min-w-40 flex-col">
          <PanelHeading>Country</PanelHeading>
          {countries.map(({ code, label }) => (
            <CheckRow
              key={code}
              label={label}
              checked={ticks.includes(code)}
              current={code === shown}
              onToggle={() => toggleCountry(code)}
            />
          ))}
        </div>

        <div className="bg-border my-1 h-px sm:mx-1 sm:my-0 sm:h-auto sm:w-px" />

        {/* Fixed width, so the popup keeps its size as countries are ticked
            and the states come and go. overscroll-contain: a fling past the
            end of the states stops here instead of scrolling the page. */}
        <div className="flex w-full flex-col sm:w-56">
          <PanelHeading>State</PanelHeading>
          {shown == null ? (
            <p className="text-body text-ink-meta px-2 pb-2">
              Tick a country to narrow it by state.
            </p>
          ) : (
            <div
              role="group"
              aria-label={`States in ${countries.find(({ code }) => code === shown)?.label}`}
              className="flex max-h-72 flex-col overflow-y-auto overscroll-contain"
            >
              {statesOf(shown).map(({ code, label }) => (
                <CheckRow
                  key={code}
                  label={label}
                  checked={ticks.includes(code)}
                  onToggle={() => toggleState(code)}
                />
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Location's facet, standing disabled in its own place until the options
 *  arrive, so the row paints at once and nothing moves when they land. */
function Location(props: Parameters<typeof LocationFacet>[0]) {
  return (
    <Suspense
      fallback={
        <button
          type="button"
          disabled
          className={facetTriggerClasses(ticksFrom(props.values).length, false, props.className)}
        >
          <FacetLabel Icon={PinIcon} label="Location" active={false} />
          <ChevronDownIcon className="text-muted-foreground size-4" />
        </button>
      }
    >
      <LocationFacet {...props} />
    </Suspense>
  );
}

/** Which pay options to offer: an internship's by the hour and a new-grad
 *  role's by the year, as each is mostly paid, and both when the Experience
 *  facet picks neither or both. */
function payUnitsFor(levels: FeedFilters["levels"]): PayPer[] {
  if (levels.length === 1) return levels[0] === "internship" ? ["hour"] : ["year"];
  return ["hour", "year"];
}

const PAY_UNIT_LABEL: Record<PayPer, string> = { hour: "Hourly", year: "Yearly" };

/** Salary: a minimum, never a range (nobody wants to hide a job for paying
 *  more). The presets for the career stage picked, or both sets, as one
 *  radio group; then "At least", for a figure the presets don't have, with
 *  its unit on a segmented toggle. Picking the checked preset again clears
 *  it. The API compares every posting's pay as a yearly figure, so an
 *  hourly minimum still finds a role paid by the month (routers/jobs.py). */
function SalaryFacet({
  levels,
  minPay,
  payPer,
  onChange,
  className,
}: {
  levels: FeedFilters["levels"];
  minPay: number | null;
  payPer: PayPer;
  onChange: (minPay: number | null, payPer: PayPer) => void;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const units = payUnitsFor(levels);
  const preset = minPay != null && PAY_OPTIONS[payPer].some((o) => o.value === minPay);
  // The field holds a custom minimum, never a preset's.
  const [draft, setDraft] = useState(minPay != null && !preset ? String(minPay) : "");
  const [draftPer, setDraftPer] = useState<PayPer>(payPer);
  const amount = Number(draft);
  const valid = draft.trim() !== "" && Number.isFinite(amount) && amount > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) onChange(amount, draftPer);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={facetTriggerClasses(minPay != null ? 1 : 0, open, className)}>
        <FacetLabel Icon={CoinIcon} label="Salary" active={minPay != null && !open} />
        {minPay != null && <span className="sr-only">, 1 selected</span>}
        <ChevronDownIcon className="text-muted-foreground size-4" />
      </PopoverTrigger>
      <PopoverContent align="start" aria-label="Salary" className="w-64 flex-col gap-0 p-1">
        {units.map((unit) => (
          <div key={unit} role="radiogroup" aria-label={`${PAY_UNIT_LABEL[unit]} Minimum`}>
            <PanelHeading>{PAY_UNIT_LABEL[unit]}</PanelHeading>
            {PAY_OPTIONS[unit].map((option) => {
              const checked = minPay === option.value && payPer === unit;
              return (
                <CheckRow
                  key={option.value}
                  role="radio"
                  label={option.label}
                  checked={checked}
                  onToggle={() => {
                    setDraft("");
                    onChange(checked ? null : option.value, unit);
                  }}
                />
              );
            })}
          </div>
        ))}

        <div className="bg-border my-1 h-px" />

        <form onSubmit={submit} className="flex flex-col gap-2 px-2 pt-1 pb-2">
          <TextField
            id={`${id}-pay`}
            label="At Least"
            type="number"
            inputMode="decimal"
            min={1}
            placeholder={draftPer === "hour" ? "42" : "95000"}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            <SegmentedToggle
              label="Pay Unit"
              options={[
                { value: "hour", label: "/hr", ariaLabel: "Per hour" },
                { value: "year", label: "/yr", ariaLabel: "Per year" },
              ]}
              value={draftPer}
              onValueChange={(value) => setDraftPer(value as PayPer)}
            />
            <Button type="submit" size="sm" disabled={!valid}>
              Apply
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** The facet row plus the All Filters sheet for everything that doesn't fit.
 *  `locations` is the Location facet's options, still loading; `filters` the
 *  picks the page was opened with (./filter-query). */
export function JobFilters({
  locations,
  filters,
}: {
  locations: Promise<JobLocationOption[]>;
  filters: FeedFilters;
}) {
  const [allFiltersOpen, setAllFiltersOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  // The picks show checked at once; `filters` catches up when the narrowed
  // page arrives.
  const [shown, show] = useOptimistic(filters);

  /** Moves the URL's filters to these, keeping the rest of the query (?q on
   *  /search). The server draws the feed again, narrowed. */
  function apply(next: FeedFilters) {
    startTransition(() => {
      show(next);
      const query = new URLSearchParams(window.location.search);
      for (const key of FILTER_KEYS) query.delete(key);
      for (const [key, value] of filterEntries(next)) query.append(key, value);
      const search = query.toString();
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    });
  }

  /** One facet's change, the others as they stand. */
  const set = (change: Partial<FeedFilters>) => apply({ ...shown, ...change });

  // Each facet is drawn twice, in the row and in the sheet, with the same props.
  const facets = {
    jobType: (className: string) => (
      <Facet
        Icon={BriefcaseIcon}
        label="Job Type"
        options={JOB_TYPE_OPTIONS}
        values={shown.jobTypes}
        onChange={(values) => set({ jobTypes: values as FeedFilters["jobTypes"] })}
        className={className}
      />
    ),
    workplace: (className: string) => (
      <Facet
        Icon={workStyleIcon("onsite")}
        label="Workplace"
        options={WORKPLACE_OPTIONS.map((o) => ({ ...o, Icon: workStyleIcon(o.value) }))}
        values={shown.workStyles}
        onChange={(values) => set({ workStyles: values as FeedFilters["workStyles"] })}
        className={className}
      />
    ),
    experience: (className: string) => (
      <Facet
        Icon={LevelIcon}
        label="Experience"
        options={EXPERIENCE_OPTIONS}
        values={shown.levels}
        onChange={(values) => set({ levels: values as FeedFilters["levels"] })}
        className={className}
      />
    ),
    datePosted: (className: string) => (
      <Facet
        Icon={ClockIcon}
        label="Date Posted"
        options={DATE_POSTED_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
        values={shown.postedWithin != null ? [String(shown.postedWithin)] : []}
        onChange={([value]) => set({ postedWithin: value != null ? Number(value) : null })}
        multiple={false}
        className={className}
      />
    ),
    location: (className: string) => (
      <Location
        locations={locations}
        values={shown.places}
        onChange={(places) => set({ places })}
        className={className}
      />
    ),
    salary: (className: string) => (
      <SalaryFacet
        // Remounted on every change, so the "At least" field starts from
        // the minimum the URL holds (empty after Clear All or a preset).
        key={`${shown.minPay}-${shown.payPer}`}
        levels={shown.levels}
        minPay={shown.minPay}
        payPer={shown.payPer}
        onChange={(minPay, payPer) => set({ minPay, payPer })}
        className={className}
      />
    ),
  };

  return (
    <>
      {/* THE FACETS STEP OUT ONE AT A TIME, least used first, from the right,
          and All Filters stays a normal button at every width. Each facet is
          144px and the button about 120, so the row fits them on one line
          from these widths of row (the page's @container, so an open sidebar
          or Scout counts): Location and All Filters anywhere, then
          Workplace from 448px, Experience 672, Date Posted 768 and Job Type
          896. It used to drop all five at once below 896px and stretch All
          Filters across the row, which on a laptop with the sidebar open
          left one wide bar where four filters had fit. The sheet holds
          every facet, and Salary, which the row has no room for. */}
      {facets.location("w-36")}
      {facets.workplace("hidden w-36 @md:flex")}
      {facets.experience("hidden w-36 @2xl:flex")}
      {facets.datePosted("hidden w-36 @3xl:flex")}
      {facets.jobType("hidden w-36 @4xl:flex")}

      <Button
        variant="secondary"
        size="sm"
        onClick={() => setAllFiltersOpen(true)}
        className="ml-auto"
      >
        <FilterIcon className="size-4" />
        All Filters
      </Button>

      {/* Fully modal (Base UI's default), not `modal="trap-focus"`: only a
          true modal locks page scroll, so the options list is the one thing
          that scrolls while the sheet is open. */}
      <Sheet open={allFiltersOpen} onOpenChange={setAllFiltersOpen}>
        {/* Floats: inset from the viewport's right, top and bottom edges with
            every corner rounded, instead of the stock full-height panel flush
            against the right edge. */}
        <SheetContent className="rounded-card border data-[side=right]:inset-y-3 data-[side=right]:right-3 data-[side=right]:h-auto">
          <SheetHeader>
            <SheetTitle className="text-subtitle font-semibold">All Filters</SheetTitle>
            <SheetDescription>Narrow the feed by role, place and pay.</SheetDescription>
          </SheetHeader>

          {/* overscroll-contain: a fling past the end of the list stops here
              instead of chaining on to the page behind. */}
          <div className="flex flex-col gap-2 overflow-y-auto overscroll-contain px-4">
            {facets.jobType("w-full")}
            {facets.workplace("w-full")}
            {facets.experience("w-full")}
            {facets.datePosted("w-full")}
            {facets.location("w-full")}
            {facets.salary("w-full")}
          </div>

          <SheetFooter className="flex-row justify-between">
            <Button
              variant="secondary"
              size="sm"
              disabled={!isFiltered(shown)}
              onClick={() => apply(NO_FILTERS)}
            >
              Clear All
            </Button>
            <SheetClose render={<Button size="sm">Done</Button>} />
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
