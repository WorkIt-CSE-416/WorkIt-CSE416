"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { usePathname, useRouter } from "next/navigation";
import {
  Suspense,
  type ComponentType,
  use,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  BriefcaseIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  FilterIcon,
  PinIcon,
  RoleIcon,
  SearchIcon,
  workStyleIcon,
} from "@/components/icons";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxTrigger,
} from "@/components/shadcn/combobox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { SortMenu } from "@/components/sort-menu";
import { buttonClasses } from "@/components/ui/button";
import { CheckRowBox, checkRowClasses } from "@/components/ui/check-row";
import { IconButton } from "@/components/ui/icon-button";
import { Select, SelectCheckboxItem, SelectContent, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/cn";

import {
  facetsOn,
  FILTER_KEYS,
  filterEntries,
  isFiltered,
  JOB_TYPE_OPTIONS,
  NO_FILTERS,
  WORKPLACE_OPTIONS,
  type FeedFilters,
  SORT_OPTIONS,
  sortHref,
  type Sort,
} from "./filter-query";
import { AllFiltersPanel } from "./all-filters";
import { useFeedTransition } from "./feed-transition";
import type { JobFacets, JobLocationOption } from "./listings";

/**
 * The filter row on /jobs and on /search, built on Base UI's `Select` (via
 * `@/components/ui/select`) instead of the inert chips `FilterChip`'s own doc
 * comment said would get a menu one day; /search drew those chips until it
 * moved onto the live feed. A Select rather than a Combobox where there is
 * no search field: Base UI's Combobox handles arrow keys and Enter on its
 * input, so without one its list cannot be reached from the keyboard at all.
 * Role has one, so Role is a Combobox (RoleFacetOptions, KAN-252).
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
 * mortarboard), so the row and the card read as one vocabulary. Role, a fact
 * the card doesn't print, takes a person in a suit of its own.
 * Inside a popup an option has a glyph only where it differs by option:
 * Workplace's building, two arrows and house, exactly as the card picks them
 * (workStyleIcon), and, in All Filters, Experience Level's mortarboard and
 * check badge (levelIcon, KAN-252). The same briefcase on every Job Type row
 * would say nothing the button doesn't. Glyphs are ink-meta, as on the card, and brand once the
 * facet is in use, with its label.
 *
 * Location is a Popover rather than a Select, for its two panels
 * (LocationFacet says why). Job Type is what kind of job it is, Internship
 * among them, and Experience Level how much experience it asks for; they
 * never overlap (KAN-284). Experience's Student once meant exactly the
 * internships, so Student with Full-Time matched no job, and with Job Type
 * in the panel only the seeker never saw the pick that emptied the feed.
 */

/** The look every facet's button shares, Select or Popover: a small
 *  secondary button that picks up a brand tint once the facet has a pick and
 *  its popup is closed, the one visible signal that it is in use. The edge is
 *  solid brand, as a selected card's and a pressed chip's are (2026-11-03). */
function facetTriggerClasses(count: number, open: boolean, className?: string) {
  return cn(
    buttonClasses({ variant: "secondary", size: "sm" }),
    "h-auto justify-between",
    count > 0 && !open && "border-brand bg-brand-tint text-brand hover:bg-brand-tint",
    className,
  );
}

type Glyph = ComponentType<{ className?: string }>;

/** A facet button's glyph and label, the glyph in ink with the label until the
 *  facet is in use, then in the brand with it. */
function FacetLabel({ Icon, label, active }: { Icon: Glyph; label: string; active: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Icon aria-hidden className={cn("size-4 shrink-0", active ? "text-brand" : "text-ink")} />
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

/** The list every Select facet's popup shares (Role's Combobox draws the
 *  same rows): checkbox rows. Options are
 *  medium weight, as the buttons above them are, and carry no job count
 *  (both KAN-252): at body weight the list read thin beside the row. */
function FacetPopup({ options }: { options: readonly Option[] }) {
  return (
    // Below the button and level with its left edge, like every popup in the
    // row. Base UI's default lays the list over the button so the picked row
    // sits on it, which put each facet's list somewhere different.
    //
    // As wide as its longest option, never narrower than the button and never
    // wider than the screen, as Location's popover is. The vendored list is
    // the button's width, which wrapped Role's options onto up to four lines
    // and pushed "Infrastructure Engineer"'s checkbox out of view (KAN-252).
    <SelectContent
      alignItemWithTrigger={false}
      align="start"
      className="w-max max-w-[calc(100vw-2rem)] min-w-(--anchor-width)"
    >
      {options.map((option) => (
        <SelectCheckboxItem key={option.value} value={option.value} className="font-medium">
          <span className="flex items-center gap-2">
            {option.Icon && <option.Icon aria-hidden className="text-ink size-4 shrink-0" />}
            {option.label}
          </span>
        </SelectCheckboxItem>
      ))}
    </SelectContent>
  );
}

/** One facet. Every option is a checkbox, so the facet takes any number of
 *  picks, and picking one leaves the popup open for the next. */
function Facet({
  Icon,
  label,
  options,
  values,
  picked = values.length,
  onChange,
  className,
}: {
  Icon: Glyph;
  label: string;
  options: readonly Option[];
  values: string[];
  /** How many picks the facet holds, when some may not be among its
   *  options (a role from a link that no job holds today). */
  picked?: number;
  onChange: (values: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

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
      <FacetTrigger Icon={Icon} label={label} count={picked} open={open} className={className} />
      <FacetPopup options={options} />
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
  onToggle,
}: {
  label: string;
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
        "hover:bg-accent focus-visible:bg-accent text-body flex w-full items-center justify-between gap-3 rounded-md py-1 pr-1.5 pl-2 text-left font-medium outline-hidden",
        current && "bg-accent",
      )}
    >
      <span>{label}</span>
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
            and the states come and go. overscroll-none: a fling past the
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
              className="flex max-h-72 flex-col overflow-y-auto overscroll-none"
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

/** Role once GET /jobs/facets has answered: the `job_roles` that tag a job,
 *  in the database's order (KAN-155). Its options come from there, so unlike
 *  the other facets it waits on them, as Location waits on its places.
 *
 *  A COMBOBOX WITH ITS SEARCH FIELD IN THE POPUP, not the other facets'
 *  Select (KAN-252): forty-odd roles were too many to scroll through for one,
 *  so typing narrows the list, as the panel's Role picker does. A Select
 *  cannot: one whose rows come and go undoes an untick (LocationFacet says
 *  how), and Base UI's Combobox is the filterable Select. Everything else is
 *  the other facets': the same button, the same checkbox rows (check-row),
 *  FacetPopup's width, and a pick leaves the popup open for the next. */
function RoleFacetOptions({
  facets,
  values,
  onChange,
  className,
}: {
  facets: Promise<JobFacets>;
  values: string[];
  onChange: (values: string[]) => void;
  className?: string;
}) {
  const roles = use(facets).role;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Set by a pick and cleared once the press is handled (below).
  const picked = useRef(false);
  const byValue = new Map(roles.map((r) => [r.value, r]));
  const labelOf = (value: string) => byValue.get(value)?.label ?? value;

  return (
    <Combobox
      items={roles.map((r) => r.value)}
      itemToStringLabel={labelOf}
      multiple
      // In the list's order, whatever order they were ticked in.
      value={values}
      onValueChange={(next: string[]) => {
        picked.current = true;
        queueMicrotask(() => (picked.current = false));
        onChange(roles.map((r) => r.value).filter((v) => next.includes(v)));
      }}
      // A pick while searching keeps the search, as the panel's picker does,
      // so "engineer" stays narrowed while you tick three of them. Base UI
      // empties the field on that press; every other clear (closing) stands,
      // and each open starts with an empty field.
      inputValue={query}
      onInputValueChange={(next, details) => {
        if (details.reason === "input-clear" && picked.current) return;
        setQuery(next);
      }}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery("");
      }}
    >
      <ComboboxTrigger className={facetTriggerClasses(values.length, open, className)}>
        <FacetLabel Icon={RoleIcon} label="Role" active={values.length > 0 && !open} />
        {values.length > 0 && <span className="sr-only">, {values.length} selected</span>}
      </ComboboxTrigger>
      <ComboboxContent
        sideOffset={4}
        className="w-max max-w-[calc(100vw-2rem)] min-w-(--anchor-width)"
      >
        {/* The panel's Role picker's field (SearchPicker), at the top of
            the popup and focused when it opens. */}
        <div className="border-border focus-within:ring-brand-ring m-1 flex h-9 items-center gap-2 rounded-md border px-2.5 focus-within:ring-2">
          <SearchIcon className="text-ink-meta size-4 shrink-0" />
          <ComboboxPrimitive.Input
            aria-label="Search roles"
            placeholder="Search roles"
            className="text-body text-ink placeholder:text-ink-meta min-w-0 flex-1 bg-transparent outline-none"
          />
        </div>
        <ComboboxEmpty className="text-ink-meta text-body py-3">
          No role by that name.
        </ComboboxEmpty>
        {/* overscroll-none: the list's own scroll stops at its ends
            instead of moving the page behind it. */}
        <ComboboxPrimitive.List className="max-h-[min(24rem,calc(var(--available-height)-3.25rem))] scroll-py-1 overflow-y-auto overscroll-none p-1 empty:p-0">
          {(value: string) => (
            <ComboboxPrimitive.Item key={value} value={value} className={checkRowClasses}>
              {labelOf(value)}
              <CheckRowBox />
            </ComboboxPrimitive.Item>
          )}
        </ComboboxPrimitive.List>
      </ComboboxContent>
    </Combobox>
  );
}

function RoleFacet(props: Parameters<typeof RoleFacetOptions>[0]) {
  return (
    <Suspense
      fallback={
        <button
          type="button"
          disabled
          className={facetTriggerClasses(props.values.length, false, props.className)}
        >
          <FacetLabel Icon={RoleIcon} label="Role" active={false} />
          <ChevronDownIcon className="text-muted-foreground size-4" />
        </button>
      }
    >
      <RoleFacetOptions {...props} />
    </Suspense>
  );
}

/** A facet's fixed options as the popup's. */
function optionsOf(options: readonly { value: string | number; label: string }[]): Option[] {
  return options.map((o) => ({ value: String(o.value), label: o.label }));
}

const hasPlaces = (places: JobLocationOption[]) => places.length > 0;
const hasFacets = (facets: JobFacets) => facets.work_style.length > 0;

/** The first of a series of promises that resolves with data, held from then
 *  on; until one has, the latest. The row's places and roles don't change
 *  with the filters, so once they've loaded, the promise each later render
 *  hands down would only re-suspend Location and Role while the same lists
 *  load again. But a first load that failed (the API down, an
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
  sort,
  list,
}: {
  locations: Promise<JobLocationOption[]>;
  /** GET /jobs/facets: the Role and Start Date options, still loading. */
  facets: Promise<JobFacets>;
  filters: FeedFilters;
  /** The Jobs page's order, for the row's Sort. /search has one order. */
  sort?: Sort;
  /** The list these filters narrow, when the row sits on a job's page beside
   *  it (./jobs-rail.tsx): a pick then goes to that list, not this address. */
  list?: { path: string; query: string };
}) {
  const [allFiltersOpen, setAllFiltersOpen] = useState(false);
  // Clear Filters leaves with the last pick, so its press hands focus here.
  const allFiltersButton = useRef<HTMLButtonElement>(null);
  // The first page's places and roles, kept for as long as the row is on
  // screen. They don't depend on the filters, so the promises each filter
  // change's render hands down again would only re-suspend Location and Role
  // while the same lists load a second time.
  const locations = useHeldOnceFilled(locationsLoading, hasPlaces);
  const facets = useHeldOnceFilled(facetsLoading, hasFacets);
  const startFeedTransition = useFeedTransition();
  const router = useRouter();
  const here = usePathname();
  const pathname = list?.path ?? here;
  // The picks show checked at once; `filters` catches up when the narrowed
  // page arrives.
  const [shown, show] = useOptimistic(filters);
  const [shownSort, showSort] = useOptimistic(sort);

  /** Moves the URL's filters to these, keeping the rest of the query (?q on
   *  /search). The server draws the feed again, narrowed. */
  function apply(next: FeedFilters) {
    // The feed's transition, so the list dims the moment this starts
    // (./feed-transition).
    startFeedTransition(() => {
      show(next);
      const query = new URLSearchParams(list?.query ?? window.location.search);
      for (const key of FILTER_KEYS) query.delete(key);
      for (const [key, value] of filterEntries(next)) query.append(key, value);
      let search = query.toString();
      // Bare /jobs is a fresh visit, which the page sends on to the saved
      // preferences, so a cleared row with no ?sort (as Home's
      // week and month links open it) names the default order instead.
      if (!search && pathname === "/jobs") search = "sort=match";
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    });
  }

  /** The list in this order, under the filters as they stand. */
  function applySort(next: Sort) {
    startFeedTransition(() => {
      showSort(next);
      router.push(sortHref(next, shown), { scroll: false });
    });
  }

  const filtered = isFiltered(shown);
  const on = facetsOn(shown);

  /** One facet's change, the others as they stand. */
  const set = (change: Partial<FeedFilters>) => apply({ ...shown, ...change });

  // The row's facets, each given the width classes its place in the row needs.
  const facet = {
    // The job_roles that tag a job (KAN-155), from GET /jobs/facets, found
    // by typing here as in the panel's search picker (KAN-252).
    role: (className: string) => (
      <RoleFacet
        facets={facets}
        values={shown.roles}
        onChange={(roles) => set({ roles })}
        className={className}
      />
    ),
    workplace: (className: string) => (
      <Facet
        Icon={workStyleIcon("onsite")}
        label="Workplace"
        options={optionsOf(WORKPLACE_OPTIONS).map((o) => ({
          ...o,
          Icon: workStyleIcon(o.value),
        }))}
        values={shown.workStyles}
        onChange={(values) => set({ workStyles: values as FeedFilters["workStyles"] })}
        className={className}
      />
    ),
    jobType: (className: string) => (
      <Facet
        Icon={BriefcaseIcon}
        label="Job Type"
        options={optionsOf(JOB_TYPE_OPTIONS)}
        values={shown.jobTypes}
        onChange={(values) => set({ jobTypes: values as FeedFilters["jobTypes"] })}
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
          and All Filters stays at every width, a 36px icon named by its tooltip
          (KAN-519; in words it took 105px of the row). Each facet is at least
          144px and as wide as its label needs, Clear Filters 36, with 8px gaps,
          so the row fits them on one line from these widths of row (the page's
          @container, so an open sidebar or Scout counts): on /search Location
          and All Filters anywhere, then Role from 392px, Workplace 544 and Job
          Type 704, each a few pixels over what it needs, for a
          label that renders a little wider elsewhere. Those leave room for
          Clear Filters whether or not it shows, so a pick never pushes a
          facet out of the row or All Filters onto a second line (KAN-252).
          Job Type took Experience's place (KAN-284):
          it is where Internship is picked, and a pick out of sight emptied
          the feed (Student with Full-Time). Experience Level is in the panel
          only; until the scraper keeps experienced roles, its Entry Level
          matches every job.
          Role sits second, beside Location (KAN-171): with every field in
          one feed (KAN-172), which kind of role is the first thing a
          seeker narrows by, and software and engineering are half of it
          (1,660 of 3,507 job postings on 2026-10-10), so a marketing or
          design seeker otherwise scrolls past them all. Visa is in the
          panel only (asked for 2026-10-10), and so is Date Posted (2026-11-02),
          which left the row for the room. The row used to drop all its facets at once below 896px and stretch All
          Filters across the row, which on a laptop with the sidebar open
          left one wide bar where four filters had fit. The panel holds
          every facet, and Salary, Start Date and Date Posted, which the row has no
          room for. */}
      {/* Sort is always in the row, first, so on the Jobs page each facet steps
          out one place sooner: Sort takes Location's place on a phone. */}
      {shownSort && (
        <SortMenu
          value={shownSort}
          options={SORT_OPTIONS}
          onChange={applySort}
          className="min-w-36"
        />
      )}
      {sort ? (
        <>
          {facet.location("hidden min-w-36 @min-[24.5rem]:flex")}
          {facet.role("hidden min-w-36 @min-[34rem]:flex")}
          {facet.workplace("hidden min-w-36 @min-[44rem]:flex")}
          {facet.jobType("hidden min-w-36 @min-[53.5rem]:flex")}
        </>
      ) : (
        <>
          {facet.location("min-w-36")}
          {facet.role("hidden min-w-36 @min-[24.5rem]:flex")}
          {facet.workplace("hidden min-w-36 @min-[34rem]:flex")}
          {facet.jobType("hidden min-w-36 @min-[44rem]:flex")}
        </>
      )}

      {/* Every pick off in one press (KAN-252), shown only while there is
          one: the panel's Clear All, without opening the panel. An outlined
          X at All Filters' height, its name in the tooltip: as the words
          "Clear Filters" (93px) it cost the row a facet at every width,
          and on a phone it pushed All Filters onto a second line. It keeps
          ?sort and ?q as every pick does, and apply() keeps /jobs off the
          bare URL, so the list stays cleared rather than bringing the saved
          preferences back. The press hands focus to All Filters,
          since the button leaves with the last pick. */}
      {filtered && (
        <IconButton
          label="Clear filters"
          variant="outline"
          className="animate-fade ml-auto size-9 shrink-0"
          onClick={() => {
            allFiltersButton.current?.focus();
            apply(NO_FILTERS);
          }}
        >
          <CloseIcon className="size-4" />
        </IconButton>
      )}
      {/* Its count is the facets with a pick (KAN-569): below about 1000px of
          row some facets have stepped out, and their picks showed nowhere
          else. The count is in its name too, "All Filters, 3 on". */}
      <IconButton
        ref={allFiltersButton}
        label={on ? `All Filters, ${on} on` : "All Filters"}
        variant="outline"
        onClick={() => setAllFiltersOpen(true)}
        className={cn("relative size-9 shrink-0", !filtered && "ml-auto")}
      >
        <FilterIcon className="size-4" />
        {on > 0 && (
          <span
            aria-hidden
            className="bg-brand text-on-brand text-meta absolute -top-1.5 -right-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 font-semibold tabular-nums"
          >
            {on}
          </span>
        )}
      </IconButton>

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
