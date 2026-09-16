"use client";

import { useState, type ReactNode } from "react";

import { FilterIcon } from "@/components/icons";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/shadcn/combobox";
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
import { cn } from "@/lib/cn";

import {
  DATE_POSTED_OPTIONS,
  EXPERIENCE_OPTIONS,
  INDUSTRY_OPTIONS,
  JOB_TYPE_OPTIONS,
  LOCATION_OPTIONS,
  SALARY_OPTIONS,
  WORKPLACE_OPTIONS,
} from "./data";

/**
 * The Jobs filter row, built on shadcn's real `Combobox` (`@base-ui/react`,
 * via `@/components/shadcn/combobox`) instead of the inert chips
 * `FilterChip`'s own doc comment said would get a menu one day.
 *
 * Stays inert against `RECOMMENDATIONS` on purpose — nothing here re-filters
 * the feed, matching every other control on this screen. What's real is the
 * UI: each facet is a button that opens a checkbox list. The button's own
 * label never changes — a facet's picks show up as checked items inside the
 * popup, not as chips on the trigger — and the trigger picks up a blue tint
 * once a pick has been made and the popup has closed, the one signal that a
 * facet is in use.
 *
 * State lives here, not lifted to the page: nothing outside this file reads
 * a filter's value, so there is nothing to lift it for yet.
 */

/** The button every facet opens from. Its label is static — a facet's picks
 *  never rewrite it — so the only thing that changes is the tint once the
 *  facet has a pick and its popup is closed. */
function FacetTrigger({
  label,
  hasSelection,
  open,
  className,
}: {
  label: string;
  hasSelection: boolean;
  open: boolean;
  className?: string;
}) {
  return (
    <ComboboxTrigger
      className={cn(
        buttonClasses({ variant: "secondary", size: "sm" }),
        "justify-between",
        hasSelection && !open && "border-brand/50 bg-brand/10 text-brand hover:bg-brand/10",
        className,
      )}
    >
      {label}
    </ComboboxTrigger>
  );
}

/** The search field plus checkbox list shared by every facet's popup. */
function FacetPopup({ label, showClear }: { label: string; showClear: boolean }) {
  return (
    <ComboboxContent>
      <ComboboxInput placeholder={`Search ${label}`} showTrigger={false} showClear={showClear} />
      <ComboboxEmpty>No matches.</ComboboxEmpty>
      <ComboboxList>
        {(option: string) => (
          <ComboboxItem key={option} value={option}>
            {option}
          </ComboboxItem>
        )}
      </ComboboxList>
    </ComboboxContent>
  );
}

/** One facet, one pick. */
function SingleFacet({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: readonly string[];
  value: string | null;
  onChange: (value: string | null) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Combobox items={options} value={value} onValueChange={onChange} onOpenChange={setOpen}>
      <FacetTrigger label={label} hasSelection={value !== null} open={open} className={className} />
      <FacetPopup label={label} showClear={value !== null} />
    </Combobox>
  );
}

/** One facet, many picks — every option renders as a checkbox in the popup
 *  list, and picking one leaves the popup open for the next pick. */
function MultiFacet({
  label,
  options,
  values,
  onChange,
  className,
}: {
  label: string;
  options: readonly string[];
  values: string[];
  onChange: (values: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Combobox
      items={options}
      value={values}
      onValueChange={onChange}
      onOpenChange={setOpen}
      multiple
    >
      <FacetTrigger
        label={label}
        hasSelection={values.length > 0}
        open={open}
        className={className}
      />
      <FacetPopup label={label} showClear={values.length > 0} />
    </Combobox>
  );
}

/** A labeled row inside the All Filters sheet. */
function FacetSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <p className="text-meta text-ink-meta font-medium">{label}</p>
      {children}
    </div>
  );
}

type FacetState = {
  jobType: string | null;
  workplace: string[];
  experience: string[];
  datePosted: string | null;
  location: string | null;
  salary: string | null;
  industry: string[];
};

const EMPTY_FACETS: FacetState = {
  jobType: null,
  workplace: [],
  experience: [],
  datePosted: null,
  location: null,
  salary: null,
  industry: [],
};

/** The facet row plus the All Filters sheet for everything that doesn't fit. */
export function JobFilters() {
  const [facets, setFacets] = useState<FacetState>(EMPTY_FACETS);
  const [allFiltersOpen, setAllFiltersOpen] = useState(false);

  function set<K extends keyof FacetState>(key: K, value: FacetState[K]) {
    setFacets((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <>
      <SingleFacet
        label="Job Type"
        options={JOB_TYPE_OPTIONS}
        value={facets.jobType}
        onChange={(value) => set("jobType", value)}
        className="w-36"
      />
      <MultiFacet
        label="Workplace"
        options={WORKPLACE_OPTIONS}
        values={facets.workplace}
        onChange={(values) => set("workplace", values)}
        className="w-40"
      />
      <MultiFacet
        label="Experience"
        options={EXPERIENCE_OPTIONS}
        values={facets.experience}
        onChange={(values) => set("experience", values)}
        className="w-40"
      />
      <SingleFacet
        label="Date Posted"
        options={DATE_POSTED_OPTIONS}
        value={facets.datePosted}
        onChange={(value) => set("datePosted", value)}
        className="w-40"
      />

      <Button
        variant="secondary"
        size="sm"
        onClick={() => setAllFiltersOpen(true)}
        className="bg-panel hover:bg-panel ml-auto"
      >
        <FilterIcon className="size-4" />
        All Filters
      </Button>

      <Sheet open={allFiltersOpen} onOpenChange={setAllFiltersOpen} modal="trap-focus">
        <SheetContent>
          <SheetHeader>
            <SheetTitle>All Filters</SheetTitle>
            <SheetDescription>Every facet, including the four already on the row.</SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-4 overflow-y-auto px-4">
            <FacetSection label="Job Type">
              <SingleFacet
                label="Job Type"
                options={JOB_TYPE_OPTIONS}
                value={facets.jobType}
                onChange={(value) => set("jobType", value)}
                className="w-full"
              />
            </FacetSection>
            <FacetSection label="Workplace">
              <MultiFacet
                label="Workplace"
                options={WORKPLACE_OPTIONS}
                values={facets.workplace}
                onChange={(values) => set("workplace", values)}
                className="w-full"
              />
            </FacetSection>
            <FacetSection label="Experience">
              <MultiFacet
                label="Experience"
                options={EXPERIENCE_OPTIONS}
                values={facets.experience}
                onChange={(values) => set("experience", values)}
                className="w-full"
              />
            </FacetSection>
            <FacetSection label="Date Posted">
              <SingleFacet
                label="Date Posted"
                options={DATE_POSTED_OPTIONS}
                value={facets.datePosted}
                onChange={(value) => set("datePosted", value)}
                className="w-full"
              />
            </FacetSection>
            <FacetSection label="Location">
              <SingleFacet
                label="Location"
                options={LOCATION_OPTIONS}
                value={facets.location}
                onChange={(value) => set("location", value)}
                className="w-full"
              />
            </FacetSection>
            <FacetSection label="Salary">
              <SingleFacet
                label="Salary"
                options={SALARY_OPTIONS}
                value={facets.salary}
                onChange={(value) => set("salary", value)}
                className="w-full"
              />
            </FacetSection>
            <FacetSection label="Industry">
              <MultiFacet
                label="Industry"
                options={INDUSTRY_OPTIONS}
                values={facets.industry}
                onChange={(values) => set("industry", values)}
                className="w-full"
              />
            </FacetSection>
          </div>

          <SheetFooter className="flex-row justify-between">
            <Button variant="secondary" size="sm" onClick={() => setFacets(EMPTY_FACETS)}>
              Clear all
            </Button>
            <SheetClose render={<Button size="sm">Done</Button>} />
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
