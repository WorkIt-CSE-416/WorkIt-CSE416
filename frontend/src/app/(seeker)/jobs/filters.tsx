"use client";

import { useState, type ReactNode } from "react";

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
import { Select, SelectCheckboxItem, SelectContent, SelectTrigger } from "@/components/ui/select";
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
 * The Jobs filter row, built on Base UI's `Select` (via `@/components/ui/select`)
 * instead of the inert chips `FilterChip`'s own doc comment said would get a
 * menu one day. A Select rather than a Combobox because there is no search
 * field: Base UI's Combobox handles arrow keys and Enter on its input, so
 * without one its list cannot be reached from the keyboard at all.
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
 *  facet has a pick and its popup is closed.
 *
 *  The vendored SelectTrigger is a form field, so the button's look is laid
 *  over it: `h-auto` undoes its fixed height, and `data-placeholder:text-ink`
 *  its grey label while nothing is picked. */
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
    <SelectTrigger
      className={cn(
        buttonClasses({ variant: "secondary", size: "sm" }),
        "data-placeholder:text-ink h-auto justify-between data-[size=default]:h-auto",
        hasSelection && !open && "border-brand/50 bg-brand/10 text-brand hover:bg-brand/10",
        className,
      )}
    >
      {label}
    </SelectTrigger>
  );
}

/** The checkbox list shared by every facet's popup. */
function FacetPopup({ options }: { options: readonly string[] }) {
  return (
    <SelectContent>
      {options.map((option) => (
        <SelectCheckboxItem key={option} value={option}>
          {option}
        </SelectCheckboxItem>
      ))}
    </SelectContent>
  );
}

/** One facet. Every option is a checkbox, so every facet takes any number of
 *  picks — picking one leaves the popup open for the next. */
function Facet({
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
    <Select value={values} onValueChange={onChange} onOpenChange={setOpen} multiple>
      <FacetTrigger
        label={label}
        hasSelection={values.length > 0}
        open={open}
        className={className}
      />
      <FacetPopup options={options} />
    </Select>
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
  jobType: string[];
  workplace: string[];
  experience: string[];
  datePosted: string[];
  location: string[];
  salary: string[];
  industry: string[];
};

const EMPTY_FACETS: FacetState = {
  jobType: [],
  workplace: [],
  experience: [],
  datePosted: [],
  location: [],
  salary: [],
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
      <Facet
        label="Job Type"
        options={JOB_TYPE_OPTIONS}
        values={facets.jobType}
        onChange={(values) => set("jobType", values)}
        className="w-36"
      />
      <Facet
        label="Workplace"
        options={WORKPLACE_OPTIONS}
        values={facets.workplace}
        onChange={(values) => set("workplace", values)}
        className="w-40"
      />
      <Facet
        label="Experience"
        options={EXPERIENCE_OPTIONS}
        values={facets.experience}
        onChange={(values) => set("experience", values)}
        className="w-40"
      />
      <Facet
        label="Date Posted"
        options={DATE_POSTED_OPTIONS}
        values={facets.datePosted}
        onChange={(values) => set("datePosted", values)}
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

      {/* Fully modal (Base UI's default), not `modal="trap-focus"`: only a
          true modal locks page scroll, so the options list is the one thing
          that scrolls while the sheet is open. */}
      <Sheet open={allFiltersOpen} onOpenChange={setAllFiltersOpen}>
        {/* Floats: inset from the viewport's right, top and bottom edges with
            every corner rounded, instead of the stock full-height panel flush
            against the right edge. */}
        <SheetContent className="rounded-card border data-[side=right]:inset-y-3 data-[side=right]:right-3 data-[side=right]:h-auto">
          <SheetHeader>
            <SheetTitle>All Filters</SheetTitle>
            <SheetDescription>Every facet, including the four already on the row.</SheetDescription>
          </SheetHeader>

          {/* overscroll-contain: a fling past the end of the list stops here
              instead of chaining on to the page behind. */}
          <div className="flex flex-col gap-4 overflow-y-auto overscroll-contain px-4">
            <FacetSection label="Job Type">
              <Facet
                label="Job Type"
                options={JOB_TYPE_OPTIONS}
                values={facets.jobType}
                onChange={(values) => set("jobType", values)}
                className="w-full"
              />
            </FacetSection>
            <FacetSection label="Workplace">
              <Facet
                label="Workplace"
                options={WORKPLACE_OPTIONS}
                values={facets.workplace}
                onChange={(values) => set("workplace", values)}
                className="w-full"
              />
            </FacetSection>
            <FacetSection label="Experience">
              <Facet
                label="Experience"
                options={EXPERIENCE_OPTIONS}
                values={facets.experience}
                onChange={(values) => set("experience", values)}
                className="w-full"
              />
            </FacetSection>
            <FacetSection label="Date Posted">
              <Facet
                label="Date Posted"
                options={DATE_POSTED_OPTIONS}
                values={facets.datePosted}
                onChange={(values) => set("datePosted", values)}
                className="w-full"
              />
            </FacetSection>
            <FacetSection label="Location">
              <Facet
                label="Location"
                options={LOCATION_OPTIONS}
                values={facets.location}
                onChange={(values) => set("location", values)}
                className="w-full"
              />
            </FacetSection>
            <FacetSection label="Salary">
              <Facet
                label="Salary"
                options={SALARY_OPTIONS}
                values={facets.salary}
                onChange={(values) => set("salary", values)}
                className="w-full"
              />
            </FacetSection>
            <FacetSection label="Industry">
              <Facet
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
