"use client";

import { usePathname, useRouter } from "next/navigation";
import { Suspense, startTransition, use, useOptimistic, useState } from "react";

import { FilterIcon } from "@/components/icons";
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
  INDUSTRY_OPTIONS,
  JOB_TYPE_OPTIONS,
  SALARY_OPTIONS,
  WORKPLACE_OPTIONS,
} from "./data";
import type { JobLocationOption } from "./listings";

/**
 * The filter row on /jobs and on /search, built on Base UI's `Select` (via
 * `@/components/ui/select`) instead of the inert chips `FilterChip`'s own doc
 * comment said would get a menu one day; /search drew those chips until it
 * moved onto the live feed. A Select rather than a Combobox because there is
 * no search field: Base UI's Combobox handles arrow keys and Enter on its
 * input, so without one its list cannot be reached from the keyboard at all.
 *
 * Location is the one facet that filters. Its options are the places that
 * have jobs (`GET /jobs/locations`, with names, never ISO codes), and its
 * picks are the page's `?location=` codes, so the server fetches the feed
 * narrowed to them and a reload or a shared link keeps them. A pick replaces
 * the URL rather than pushing it, so ticking five places is not five steps of
 * Back. The rest stay inert on purpose, matching every other control on the
 * cards: each is a button that opens a list of options. The button's own
 * label never changes (a facet's picks show up as checked items inside the
 * popup, not as chips on the trigger), and the trigger picks up a brand tint
 * once a pick has been made and the popup has closed, the one visible signal
 * that a facet is in use. A screen reader hears the same thing as the pick
 * count after the label.
 *
 * The inert facets' state lives here: nothing outside this file reads it.
 */

/** The button every facet opens from. Its label is static (a facet's picks
 *  never rewrite it), so the only thing that changes is the tint once the
 *  facet has a pick and its popup is closed. The tint is colour alone, so the
 *  pick count rides after the label for a screen reader.
 *
 *  The vendored SelectTrigger is a form field, so the button's look is laid
 *  over it: `h-auto` undoes its fixed height, and `data-placeholder:text-ink`
 *  its grey label while nothing is picked. */
function FacetTrigger({
  label,
  count,
  open,
  className,
}: {
  label: string;
  /** How many options are picked. */
  count: number;
  open: boolean;
  className?: string;
}) {
  return (
    <SelectTrigger
      className={cn(
        buttonClasses({ variant: "secondary", size: "sm" }),
        "data-placeholder:text-ink h-auto justify-between data-[size=default]:h-auto",
        count > 0 && !open && "border-brand/50 bg-brand/10 text-brand hover:bg-brand/10",
        className,
      )}
    >
      {label}
      {count > 0 && <span className="sr-only">, {count} selected</span>}
    </SelectTrigger>
  );
}

/** An option whose value is what it says, or a value with its own label
 *  (a location's code, "US-CA", shown as "California"), its row's own
 *  classes (a state's indent under its country), and whether it is folded
 *  away for now (a state under an unticked country). */
type FacetOption = string | { value: string; label: string; className?: string; folded?: boolean };

/** The list shared by every facet's popup: checkbox rows where a facet takes
 *  several picks, the vendored check-mark rows where it takes one. */
function FacetPopup({
  options,
  multiple,
  className,
}: {
  options: readonly FacetOption[];
  multiple: boolean;
  className?: string;
}) {
  const Item = multiple ? SelectCheckboxItem : SelectItem;

  return (
    <SelectContent className={className}>
      {options.map((option) => {
        const { value, label, className, folded } =
          typeof option === "string" ? { value: option, label: option } : option;
        // A folded row stays mounted, hidden and disabled (so arrow keys and
        // typeahead skip it), never removed: Base UI 1.7 prunes the selection
        // when the item list shrinks, against the value from before the press,
        // so unticking a country put it straight back
        // (select/positioner/SelectPositioner.js, onMapChange).
        return (
          <Item
            key={value}
            value={value}
            disabled={folded}
            className={cn(className, folded && "hidden")}
          >
            {label}
          </Item>
        );
      })}
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
  label,
  options,
  values,
  onChange,
  multiple = true,
  disabled = false,
  className,
  popupClassName,
}: {
  label: string;
  options: readonly FacetOption[];
  values: string[];
  onChange: (values: string[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
  popupClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = (
    <FacetTrigger label={label} count={values.length} open={open} className={className} />
  );

  if (!multiple) {
    return (
      <Select
        value={values[0] ?? null}
        onValueChange={(value) =>
          onChange(value == null || value === values[0] ? [] : [value as string])
        }
        onOpenChange={setOpen}
        disabled={disabled}
      >
        {trigger}
        <FacetPopup options={options} multiple={false} className={popupClassName} />
      </Select>
    );
  }

  return (
    <Select
      value={values}
      onValueChange={onChange}
      onOpenChange={setOpen}
      disabled={disabled}
      multiple
    >
      {trigger}
      <FacetPopup options={options} multiple className={popupClassName} />
    </Select>
  );
}

type FacetState = {
  jobType: string[];
  workplace: string[];
  experience: string[];
  datePosted: string[];
  salary: string[];
  industry: string[];
};

const EMPTY_FACETS: FacetState = {
  jobType: [],
  workplace: [],
  experience: [],
  datePosted: [],
  salary: [],
  industry: [],
};

/** "US" for "US-CA", and for "US" itself. */
const countryOf = (code: string) => code.split("-")[0];
const isState = (code: string) => code.includes("-");

/** The URL's places as the popup's ticks: a state ticks its country too, since
 *  a country's states only show while it is ticked. */
function ticksFrom(places: readonly string[]): string[] {
  return [...new Set(places.flatMap((code) => (isState(code) ? [countryOf(code), code] : [code])))];
}

/** The popup's ticks as the URL's places. A country alone means all of it; a
 *  country with states ticked means just those states. A state whose country
 *  was just unticked goes with it. */
function placesFrom(ticks: readonly string[]): string[] {
  return ticks
    .filter((code) => !isState(code))
    .flatMap((country) => {
      const states = ticks.filter((code) => isState(code) && countryOf(code) === country);
      return states.length > 0 ? states : [country];
    });
}

/** Location's facet once its options have arrived. Lists the countries
 *  ("United States", "Other"); ticking one opens its states beneath it,
 *  indented, to narrow it further. `values` and `onChange` speak the URL's
 *  places, never the ticks. Wider than its trigger, so "District of Columbia"
 *  keeps to one line. */
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
  const ticks = ticksFrom(values);

  return (
    <Facet
      label="Location"
      options={options.map(({ code, label }) => ({
        value: code,
        label,
        className: isState(code) ? "pl-6" : undefined,
        folded: isState(code) && !ticks.includes(countryOf(code)),
      }))}
      values={ticks}
      onChange={(next) => onChange(placesFrom(next))}
      disabled={options.length === 0}
      className={className}
      popupClassName="w-auto max-w-80 min-w-(--anchor-width)"
    />
  );
}

/** Location's facet, standing disabled in its own place until the options
 *  arrive, so the row paints at once and nothing moves when they land. */
function Location(props: Parameters<typeof LocationFacet>[0]) {
  return (
    <Suspense
      fallback={
        <Facet
          label="Location"
          options={[]}
          values={ticksFrom(props.values)}
          onChange={props.onChange}
          disabled
          className={props.className}
        />
      }
    >
      <LocationFacet {...props} />
    </Suspense>
  );
}

/** The facet row plus the All Filters sheet for everything that doesn't fit.
 *  `locations` is the Location facet's options, still loading; `places` the
 *  `?location=` codes the page was opened with. */
export function JobFilters({
  locations,
  places,
}: {
  locations: Promise<JobLocationOption[]>;
  places: string[];
}) {
  const [facets, setFacets] = useState<FacetState>(EMPTY_FACETS);
  const [allFiltersOpen, setAllFiltersOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  // The picks show checked at once; `places` catches up when the narrowed
  // page arrives.
  const [shownPlaces, showPlaces] = useOptimistic(places);

  function set<K extends keyof FacetState>(key: K, value: FacetState[K]) {
    setFacets((prev) => ({ ...prev, [key]: value }));
  }

  /** Moves `?location=` to these codes, keeping the rest of the query (?q on
   *  /search). The server draws the feed again, narrowed. */
  function setPlaces(values: string[]) {
    startTransition(() => {
      showPlaces(values);
      const query = new URLSearchParams(window.location.search);
      query.delete("location");
      for (const value of values) query.append("location", value);
      const search = query.toString();
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    });
  }

  return (
    <>
      <Facet
        label="Job Type"
        options={JOB_TYPE_OPTIONS}
        values={facets.jobType}
        onChange={(values) => set("jobType", values)}
        className="hidden w-36 @4xl:flex"
      />
      <Facet
        label="Workplace"
        options={WORKPLACE_OPTIONS}
        values={facets.workplace}
        onChange={(values) => set("workplace", values)}
        className="hidden w-36 @4xl:flex"
      />
      <Facet
        label="Experience"
        options={EXPERIENCE_OPTIONS}
        values={facets.experience}
        onChange={(values) => set("experience", values)}
        className="hidden w-36 @4xl:flex"
      />
      <Facet
        label="Date Posted"
        options={DATE_POSTED_OPTIONS}
        values={facets.datePosted}
        onChange={(values) => set("datePosted", values)}
        multiple={false}
        className="hidden w-36 @4xl:flex"
      />
      <Location
        locations={locations}
        values={shownPlaces}
        onChange={setPlaces}
        className="hidden w-36 @4xl:flex"
      />

      {/* Under 896px of row (the page's @container, so an open sidebar
          counts) the five facets step out and this is the whole row. Five
          144px facets and this button need about 870px, so whenever the facets
          show they sit on one line; at a window's breakpoints they wrapped
          into a ragged block whenever the sidebar was open. The sheet it
          opens holds every one of them. */}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setAllFiltersOpen(true)}
        className="ml-auto @max-4xl:ml-0 @max-4xl:w-full"
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
            <Facet
              label="Job Type"
              options={JOB_TYPE_OPTIONS}
              values={facets.jobType}
              onChange={(values) => set("jobType", values)}
              className="w-full"
            />
            <Facet
              label="Workplace"
              options={WORKPLACE_OPTIONS}
              values={facets.workplace}
              onChange={(values) => set("workplace", values)}
              className="w-full"
            />
            <Facet
              label="Experience"
              options={EXPERIENCE_OPTIONS}
              values={facets.experience}
              onChange={(values) => set("experience", values)}
              className="w-full"
            />
            <Facet
              label="Date Posted"
              options={DATE_POSTED_OPTIONS}
              values={facets.datePosted}
              onChange={(values) => set("datePosted", values)}
              multiple={false}
              className="w-full"
            />
            <Location
              locations={locations}
              values={shownPlaces}
              onChange={setPlaces}
              className="w-full"
            />
            <Facet
              label="Salary"
              options={SALARY_OPTIONS}
              values={facets.salary}
              onChange={(values) => set("salary", values)}
              multiple={false}
              className="w-full"
            />
            <Facet
              label="Industry"
              options={INDUSTRY_OPTIONS}
              values={facets.industry}
              onChange={(values) => set("industry", values)}
              className="w-full"
            />
          </div>

          <SheetFooter className="flex-row justify-between">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setFacets(EMPTY_FACETS);
                if (shownPlaces.length > 0) setPlaces([]);
              }}
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
