"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { useRef, useState, type ReactNode } from "react";

import {
  BriefcaseIcon,
  CompanyIcon,
  ExternalLinkIcon,
  SearchIcon,
  workStyleIcon,
} from "@/components/icons";
import { facetClasses, FacetLabel, type FacetOption, type Glyph } from "@/components/field-facet";
import { OptionChip as Chip, SearchPicker } from "@/components/filter-controls";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxTrigger,
} from "@/components/shadcn/combobox";
import { Dialog, DialogContent, DialogTitle } from "@/components/shadcn/dialog";
import { Button } from "@/components/ui/button";
import { CheckRowBox, checkRowClasses } from "@/components/ui/check-row";
import { cn } from "@/lib/cn";

import { STAGE_COLOR, STAGE_ICON, STAGE_LABEL, STAGE_ORDER, type StageKey } from "../stage-colors";
import { StatusIcon } from "./icons";
import {
  filterApplications,
  NO_FILTERS,
  type Filterable,
  type FilterKey,
  type Filters,
} from "./query";

/**
 * The Applications filters (KAN-282), laid out as the Jobs page lays out its
 * own (jobs/filters.tsx, jobs/all-filters.tsx): a row of dropdowns, Status
 * then one per field, then All Filters, a panel with every one of them.
 *
 * A DROPDOWN looks like a Jobs page facet: a small secondary button with the
 * field's glyph (the one its list cell draws; Status's own), its label and
 * a chevron, taking the brand tint while it holds a pick and is closed. Its
 * list is checkbox rows (ui/check-row.tsx), and a pick leaves it open for
 * the next. Status lists the four stages, each with its stage's glyph in
 * the stage's colour; the fields list every value the tracked applications
 * hold. Status was a row of chips until the row was rebuilt as dropdowns
 * (asked for 2026-10-19).
 *
 * COMPANY HAS A SEARCH FIELD at the top of its list, as the Jobs page's
 * Role dropdown does (RoleFacetOptions there), since its list grows with
 * every application: typing narrows it, and a pick keeps the search.
 *
 * ALL FILTERS holds Status and every field, each a section of option chips
 * under its glyph; Company there is a search picker. As on the Jobs page,
 * the picks are a draft until "Show 12 Applications", which counts the
 * draft in the browser (the bar holds what each tracked application is
 * filtered on), and closing without it drops the draft.
 *
 * Either way the picks become the URL (./query.ts) and the server filters on
 * them; the bar shows them at once meanwhile (`apply` in ./filter-bar.tsx).
 */

export type Picks = { stages: StageKey[]; filters: Filters };

/** Each field's glyph: the one its list cell draws. Work Model's is the
 *  Jobs page's Workplace glyph. */
export const FIELD_ICON: Record<FilterKey, Glyph> = {
  company: CompanyIcon,
  track: BriefcaseIcon,
  workModel: workStyleIcon("On-Site"),
  source: ExternalLinkIcon,
};

/** Status's options: each stage with its glyph in its own colour, as the
 *  stage chips did (KAN-256) (the text colour that reads on its tint clears 3:1
 *  on white too). */
export const STATUS_OPTIONS: FacetOption[] = STAGE_ORDER.map((stage) => ({
  value: stage,
  label: STAGE_LABEL[stage],
  Icon: STAGE_ICON[stage],
  iconClassName: STAGE_COLOR[stage].onTint,
}));

/**
 * Company's dropdown: the same button and checkbox rows, with a search field
 * at the top of the list, built as the Jobs page's Role dropdown is: a Base
 * UI Combobox, whose arrow keys and Enter work from its field (a menu's
 * cannot hold one). A pick while searching keeps the search, so "acme"
 * stays narrowed while two of its names are ticked; each opening starts
 * with an empty field.
 */
export function SearchFacet({
  label,
  Icon,
  searchLabel,
  empty,
  options,
  values,
  onChange,
  className,
}: {
  label: string;
  Icon: Glyph;
  /** The field's placeholder and accessible name: "Search companies". */
  searchLabel: string;
  /** What the list says when the search matches nothing. */
  empty: string;
  options: string[];
  values: string[];
  onChange: (values: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // Set by a pick and cleared once the press is handled (below).
  const picked = useRef(false);
  const active = values.length > 0 && !open;

  return (
    <Combobox
      items={options}
      multiple
      value={values}
      onValueChange={(next: string[]) => {
        picked.current = true;
        queueMicrotask(() => (picked.current = false));
        onChange(options.filter((v) => next.includes(v)));
      }}
      // Base UI empties the field on a pick; every other clear stands.
      inputValue={search}
      onInputValueChange={(next, details) => {
        if (details.reason === "input-clear" && picked.current) return;
        setSearch(next);
      }}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSearch("");
      }}
    >
      <ComboboxTrigger disabled={options.length === 0} className={facetClasses(active, className)}>
        <FacetLabel Icon={Icon} label={label} active={active} count={values.length} />
      </ComboboxTrigger>
      <ComboboxContent
        sideOffset={4}
        className="w-max max-w-[calc(100vw-2rem)] min-w-(--anchor-width)"
      >
        <div className="border-border focus-within:ring-brand-ring m-1 flex h-9 items-center gap-2 rounded-md border px-2.5 focus-within:ring-2">
          <SearchIcon className="text-ink-meta size-4 shrink-0" />
          <ComboboxPrimitive.Input
            aria-label={searchLabel}
            placeholder={searchLabel}
            className="text-body text-ink placeholder:text-ink-meta min-w-0 flex-1 bg-transparent outline-none"
          />
        </div>
        <ComboboxEmpty className="text-ink-meta text-body py-3">{empty}</ComboboxEmpty>
        {/* overscroll-contain: the list's own scroll stops at its ends
            instead of moving the page behind it. */}
        <ComboboxPrimitive.List className="max-h-[min(24rem,calc(var(--available-height)-3.25rem))] scroll-py-1 overflow-y-auto overscroll-contain p-1 empty:p-0">
          {(value: string) => (
            <ComboboxPrimitive.Item key={value} value={value} className={checkRowClasses}>
              <span className="truncate">{value}</span>
              <CheckRowBox />
            </ComboboxPrimitive.Item>
          )}
        </ComboboxPrimitive.List>
      </ComboboxContent>
    </Combobox>
  );
}

/** The panel with every field, as a Dialog; its body mounts only while it is
 *  open, so each opening starts from the picks the URL holds. */
export function AllFiltersPanel({
  open,
  onOpenChange,
  picks,
  apps,
  q,
  options,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  picks: Picks;
  /** Every tracked application, for the draft's count. */
  apps: Filterable[];
  /** The search, which the count respects as the list does. */
  q: string;
  options: Filters;
  onApply: (picks: Picks) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(44rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <div className="border-border-subtle flex items-center border-b px-5 py-3.5 pr-12">
          <DialogTitle className="text-subtitle font-semibold">All Filters</DialogTitle>
        </div>
        {open && (
          <PanelBody
            picks={picks}
            apps={apps}
            q={q}
            options={options}
            onApply={(next) => {
              onApply(next);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PanelBody({
  picks,
  apps,
  q,
  options,
  onApply,
}: {
  picks: Picks;
  apps: Filterable[];
  q: string;
  options: Filters;
  onApply: (picks: Picks) => void;
}) {
  const [draft, setDraft] = useState(picks);
  // Bumped by Clear All: the company picker keeps its search in its own
  // state, so it is remounted empty.
  const [cleared, setCleared] = useState(0);
  const count = filterApplications(apps, { ...draft, q }).length;

  const setField = (key: FilterKey, values: string[]) =>
    setDraft((d) => ({ ...d, filters: { ...d.filters, [key]: values } }));
  const toggle = (key: FilterKey, value: string) => {
    const values = draft.filters[key];
    // In the options' order, whatever order they were ticked in.
    const next = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
    setField(
      key,
      options[key].filter((v) => next.includes(v)),
    );
  };
  const toggleStage = (stage: StageKey) =>
    setDraft((d) => ({
      ...d,
      stages: STAGE_ORDER.filter((s) =>
        s === stage ? !d.stages.includes(s) : d.stages.includes(s),
      ),
    }));

  return (
    <>
      {/* overscroll-contain: a fling past the end stops here instead of
          scrolling the page behind. */}
      <div data-panel-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
        <Section Icon={StatusIcon} label="Status" first>
          {STAGE_ORDER.map((stage) => (
            <Chip
              key={stage}
              Icon={STAGE_ICON[stage]}
              pressed={draft.stages.includes(stage)}
              onClick={() => toggleStage(stage)}
            >
              {STAGE_LABEL[stage]}
            </Chip>
          ))}
        </Section>

        <Section Icon={FIELD_ICON.company} label="Company">
          <SearchPicker
            key={`company-${cleared}`}
            label="Companies"
            placeholder="Search a company"
            empty="No company by that name in your applications."
            options={options.company.map((value) => ({ value, label: value, nested: false }))}
            values={draft.filters.company}
            onChange={(values) => setField("company", values)}
          />
        </Section>

        <div className="grid gap-x-6 sm:grid-cols-2">
          {chipSection("track", "Job Type")}
          {chipSection("workModel", "Work Model")}
        </div>
        {chipSection("source", "Source")}
      </div>

      <div className="border-border-subtle flex items-center justify-between gap-3 border-t px-5 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDraft({ stages: [], filters: NO_FILTERS });
            setCleared((n) => n + 1);
          }}
        >
          Clear All
        </Button>
        <Button size="sm" onClick={() => onApply(draft)}>
          {`Show ${count} ${count === 1 ? "Application" : "Applications"}`}
        </Button>
      </div>
    </>
  );

  /** A field whose values are few enough to show as chips. A function, not
   *  a component: one defined in here would remount on every pick and drop
   *  the pressed chip's focus. */
  function chipSection(field: FilterKey, label: string) {
    return (
      <Section Icon={FIELD_ICON[field]} label={label}>
        {options[field].length === 0 ? (
          <p className="text-note text-ink-meta">None of your applications says.</p>
        ) : (
          options[field].map((value) => (
            <Chip
              key={value}
              Icon={field === "workModel" ? workStyleIcon(value) : undefined}
              pressed={draft.filters[field].includes(value)}
              onClick={() => toggle(field, value)}
            >
              {value}
            </Chip>
          ))
        )}
      </Section>
    );
  }
}

/** One field's section: its glyph and name over its options, as in the Jobs
 *  page's panel. */
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
        <Icon aria-hidden className="text-ink-meta size-4 shrink-0" />
        {label}
      </h3>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </section>
  );
}
