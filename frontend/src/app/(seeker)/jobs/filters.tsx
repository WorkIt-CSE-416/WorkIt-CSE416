"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  Suspense,
  type ComponentType,
  use,
  useEffect,
  useOptimistic,
  useState,
  type ReactNode,
} from "react";

import {
  BriefcaseIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  FilterIcon,
  LevelIcon,
  PinIcon,
  RoleIcon,
  workStyleIcon,
} from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { Button, buttonClasses } from "@/components/ui/button";
import {
  Select,
  SelectCheckboxItem,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/cn";

import {
  DATE_POSTED_OPTIONS,
  EXPERIENCE_OPTIONS,
  FILTER_KEYS,
  filterEntries,
  JOB_TYPE_OPTIONS,
  ROLE_OPTIONS,
  WORKPLACE_OPTIONS,
  type FeedFilters,
} from "./filter-query";
import { AllFiltersPanel } from "./all-filters";
import { useFeedTransition } from "./feed-transition";
import type { JobFacets, JobLocationOption } from "./listings";

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
 * takes a clock, not the card's calendar, which there means the start date,
 * and Role, a fact the card doesn't print, takes shapes of its own.
 * Inside a popup an option has a glyph only where it differs by option:
 * Workplace's building, two arrows and house, exactly as the card picks them
 * (workStyleIcon). The same briefcase on every Job Type row would say nothing
 * the button doesn't. Glyphs are ink-meta, as on the card, and brand once the
 * facet is in use, with its label.
 *
 * Location is a Popover rather than a Select, for its two panels
 * (LocationFacet says why). Job Type is how the job is set up and Experience the career
 * stage. Internship is both: the card shows it as an internship's job type
 * (KAN-171), and the API matches the other types among non-internships.
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

type Option = { value: string; label: string; Icon?: Glyph; count?: ReactNode };

/** The list shared by every facet's popup: checkbox rows where a facet takes
 *  several picks, the vendored check-mark rows where it takes one. */
function FacetPopup({ options, multiple }: { options: readonly Option[]; multiple: boolean }) {
  const Item = multiple ? SelectCheckboxItem : SelectItem;

  return (
    // Below the button and level with its left edge, like every popup in the
    // row. Base UI's default lays the list over the button so the picked row
    // sits on it, which put each facet's list somewhere different.
    <SelectContent alignItemWithTrigger={false} align="start">
      {options.map((option) => (
        <Item key={option.value} value={option.value}>
          <span className="flex items-center gap-2">
            {option.Icon && <option.Icon className="text-ink-meta size-4 shrink-0" />}
            {option.label}
            {option.count}
          </span>
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
  count,
  checked,
  current = false,
  onToggle,
}: {
  label: string;
  /** How many jobs the option holds, after the label. */
  count?: number;
  checked: boolean;
  current?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        "hover:bg-accent focus-visible:bg-accent text-body flex w-full items-center justify-between gap-3 rounded-md py-1 pr-1.5 pl-2 text-left outline-hidden",
        current && "bg-accent",
      )}
    >
      <span>
        {label}
        {count != null && <JobCount n={count} />}
      </span>
      <span
        aria-hidden
        className={cn(
          "border-ink-meta text-primary-foreground flex size-4 shrink-0 items-center justify-center border transition-colors",
          "rounded-[4px]",
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
        {/* The URL's places, not the ticks: picking California ticks the
            United States too, and should still say 1. */}
        {values.length > 0 && <span className="sr-only">, {values.length} selected</span>}
        <ChevronDownIcon className="text-muted-foreground size-4" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="Location"
        className="w-auto max-w-[calc(100vw-2rem)] flex-col gap-0 p-1 sm:flex-row"
      >
        <div role="group" aria-label="Countries" className="flex min-w-40 flex-col">
          <PanelHeading>Country</PanelHeading>
          {countries.map(({ code, label, jobs }) => (
            <CheckRow
              key={code}
              label={label}
              count={jobs}
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
              {statesOf(shown).map(({ code, label, jobs }) => (
                <CheckRow
                  key={code}
                  label={label}
                  count={jobs}
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
          className={facetTriggerClasses(props.values.length, false, props.className)}
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

/** A job count after an option's label, in the row's quiet grey. Counts are
 *  across the whole feed, not narrowed by the other filters (GET
 *  /jobs/facets), so they say how big an option is, not how many of the
 *  current results it holds. */
function JobCount({ n }: { n: number }) {
  return <span className="text-ink-meta ml-1.5 tabular-nums">{n.toLocaleString("en-US")}</span>;
}

type FacetGroup = keyof JobFacets;

/** An option's count once GET /jobs/facets has answered; nothing until then,
 *  or for a value the feed holds none of, so the row never waits on it. */
function OptionCount({
  facets,
  group,
  value,
}: {
  facets: Promise<JobFacets>;
  group: FacetGroup;
  value: string;
}) {
  return (
    <Suspense fallback={null}>
      <OptionCountValue facets={facets} group={group} value={value} />
    </Suspense>
  );
}

function OptionCountValue({
  facets,
  group,
  value,
}: {
  facets: Promise<JobFacets>;
  group: FacetGroup;
  value: string;
}) {
  const n = use(facets)[group].find((c) => c.value === value)?.jobs;
  return n == null ? null : <JobCount n={n} />;
}

/** A facet's static options with their counts beside them. */
function counted(
  options: readonly { value: string | number; label: string }[],
  facets: Promise<JobFacets>,
  group: FacetGroup,
): Option[] {
  return options.map((o) => ({
    value: String(o.value),
    label: o.label,
    count: <OptionCount facets={facets} group={group} value={String(o.value)} />,
  }));
}

const hasPlaces = (places: JobLocationOption[]) => places.length > 0;
const hasCounts = (counts: JobFacets) => counts.work_style.length > 0;

/** The first of a series of promises that resolves with data, held from then
 *  on; until one has, the latest. The row's places and counts don't change
 *  with the filters, so once they've loaded, the promise each later render
 *  hands down would only re-suspend Location and blank the counts while the
 *  same figures load again. But a first load that failed (the API down, an
 *  empty answer) mustn't stick for the visit: Next caches only good answers,
 *  so a later render's promise is worth taking until one comes back filled. */
function useHeldOnceFilled<T>(latest: Promise<T>, filled: (value: T) => boolean): Promise<T> {
  const [held, setHeld] = useState(latest);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (settled) return;
    let alive = true;
    held.then((value) => {
      if (!alive) return;
      if (filled(value)) setSettled(true);
      else if (latest !== held) setHeld(latest);
    });
    return () => {
      alive = false;
    };
  }, [held, latest, settled, filled]);
  return held;
}

/** The facet row plus the All Filters panel (./all-filters), which holds every
 *  facet, and Salary, Start Date and Visa, which the row leaves to it.
 *  `locations` is the Location facet's options, still loading; `filters` the
 *  picks the page was opened with (./filter-query). */
export function JobFilters({
  locations: locationsLoading,
  facets: facetsLoading,
  filters,
}: {
  locations: Promise<JobLocationOption[]>;
  /** Every option's count and the Start Date options, still loading. */
  facets: Promise<JobFacets>;
  filters: FeedFilters;
}) {
  const [allFiltersOpen, setAllFiltersOpen] = useState(false);
  // The first page's places and counts, kept for as long as the row is on
  // screen. They don't depend on the filters, so the promises each filter
  // change's render hands down again would only re-suspend Location and blank
  // every count while the same figures load a second time.
  const locations = useHeldOnceFilled(locationsLoading, hasPlaces);
  const facets = useHeldOnceFilled(facetsLoading, hasCounts);
  const startFeedTransition = useFeedTransition();
  const router = useRouter();
  const pathname = usePathname();
  // The picks show checked at once; `filters` catches up when the narrowed
  // page arrives.
  const [shown, show] = useOptimistic(filters);

  /** Moves the URL's filters to these, keeping the rest of the query (?q on
   *  /search). The server draws the feed again, narrowed. */
  function apply(next: FeedFilters) {
    // The feed's transition, so the list dims the moment this starts
    // (./feed-transition).
    startFeedTransition(() => {
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

  // The row's facets, each given the width classes its place in the row needs.
  const facet = {
    role: (className: string) => (
      <Facet
        Icon={RoleIcon}
        label="Role"
        options={counted(ROLE_OPTIONS, facets, "role")}
        values={shown.roles}
        onChange={(values) => set({ roles: values as FeedFilters["roles"] })}
        className={className}
      />
    ),
    jobType: (className: string) => (
      <Facet
        Icon={BriefcaseIcon}
        label="Job Type"
        options={counted(JOB_TYPE_OPTIONS, facets, "job_type")}
        values={shown.jobTypes}
        onChange={(values) => set({ jobTypes: values as FeedFilters["jobTypes"] })}
        className={className}
      />
    ),
    workplace: (className: string) => (
      <Facet
        Icon={workStyleIcon("onsite")}
        label="Workplace"
        options={counted(WORKPLACE_OPTIONS, facets, "work_style").map((o) => ({
          ...o,
          Icon: workStyleIcon(o.value),
        }))}
        values={shown.workStyles}
        onChange={(values) => set({ workStyles: values as FeedFilters["workStyles"] })}
        className={className}
      />
    ),
    experience: (className: string) => (
      <Facet
        Icon={LevelIcon}
        label="Experience"
        options={counted(EXPERIENCE_OPTIONS, facets, "experience")}
        values={shown.levels}
        onChange={(values) => set({ levels: values as FeedFilters["levels"] })}
        className={className}
      />
    ),
    datePosted: (className: string) => (
      <Facet
        Icon={ClockIcon}
        label="Date Posted"
        options={counted(DATE_POSTED_OPTIONS, facets, "posted_within")}
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
  };

  return (
    <>
      {/* THE FACETS STEP OUT ONE AT A TIME, least used first, from the right,
          and All Filters stays a normal button at every width. Each facet is
          144px and the button about 110, so the row fits them on one line
          from these widths of row (the page's @container, so an open sidebar
          or Scout counts): Location and All Filters anywhere, then Role from
          448px, Workplace 672, Experience 768, Date Posted 896 and Job Type
          1024.
          Role sits second, beside Location (KAN-171): with five disciplines
          in one feed, which kind of role is the first thing a seeker narrows
          by, and half the roles are software (806 of 1,635 kept postings
          on 2026-10-10), so a quant or product seeker otherwise scrolls past
          them all. Visa is in the panel only (asked for 2026-10-10). The
          row used to drop all its facets at once below 896px and stretch All
          Filters across the row, which on a laptop with the sidebar open
          left one wide bar where four filters had fit. The panel holds
          every facet, and Salary and Start Date, which the row has no room for. */}
      {facet.location("w-36")}
      {facet.role("hidden w-36 @md:flex")}
      {facet.workplace("hidden w-36 @2xl:flex")}
      {facet.experience("hidden w-36 @3xl:flex")}
      {facet.datePosted("hidden w-36 @4xl:flex")}
      {facet.jobType("hidden w-36 @5xl:flex")}

      <Button
        variant="secondary"
        size="sm"
        onClick={() => setAllFiltersOpen(true)}
        className="ml-auto"
      >
        <FilterIcon className="size-4" />
        All Filters
      </Button>

      <AllFiltersPanel
        open={allFiltersOpen}
        onOpenChange={setAllFiltersOpen}
        filters={shown}
        locations={locations}
        facets={facets}
        onApply={apply}
      />
    </>
  );
}
