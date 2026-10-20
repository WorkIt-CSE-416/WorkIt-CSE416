"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { useState, type ComponentType, type ReactNode } from "react";

import {
  BriefcaseIcon,
  ChevronDownIcon,
  CompanyIcon,
  ExternalLinkIcon,
  workStyleIcon,
} from "@/components/icons";
import { OptionChip as Chip, SearchPicker } from "@/components/filter-controls";
import { Dialog, DialogContent, DialogTitle } from "@/components/shadcn/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Button, buttonClasses } from "@/components/ui/button";
import { CheckRowBox, checkRowClasses } from "@/components/ui/check-row";
import { cn } from "@/lib/cn";

import { STAGE_ICON, STAGE_LABEL, STAGE_ORDER, type StageKey } from "../stage-colors";
import { StatusIcon } from "./icons";
import {
  filterApplications,
  NO_FILTERS,
  type Filterable,
  type FilterKey,
  type Filters,
} from "./query";

/**
 * The Applications filters past the stage chips (KAN-282), laid out as the
 * Jobs page lays out its own (jobs/filters.tsx, jobs/all-filters.tsx): a row
 * of dropdowns, one per field, then All Filters, a panel with every field.
 *
 * A FIELD'S DROPDOWN looks like a Jobs page facet: a small secondary button
 * with the field's glyph (the one its list cell draws), its label and a
 * chevron, taking the brand tint while it holds a pick and is closed. Its
 * menu is checkbox rows (ui/check-row.tsx), every value the tracked
 * applications hold, and a pick leaves it open for the next.
 *
 * ALL FILTERS holds Status (the stage chips' choice) and every field, each a
 * section of option chips under its glyph; Company, whose list grows with
 * every application, is a search picker. As on the Jobs page, the picks are
 * a draft until "Show 12 Applications", which counts the draft in the
 * browser (the bar holds what each tracked application is filtered on), and
 * closing without it drops the draft.
 *
 * Either way the picks become the URL (./query.ts) and the server filters on
 * them; the bar shows them at once meanwhile (`apply` in ./filter-bar.tsx).
 */

export type Picks = { stages: StageKey[]; filters: Filters };

type Glyph = ComponentType<{ className?: string }>;

/** Each field's glyph: the one its list cell draws. Work Model's is the
 *  Jobs page's Workplace glyph. */
export const FIELD_ICON: Record<FilterKey, Glyph> = {
  company: CompanyIcon,
  track: BriefcaseIcon,
  workModel: workStyleIcon("On-Site"),
  source: ExternalLinkIcon,
};

/** The Jobs page facet's look: a small secondary button with the brand
 *  tint while it holds a pick and its menu is closed. */
function facetClasses(active: boolean, className?: string) {
  return cn(
    buttonClasses({ variant: "secondary", size: "sm" }),
    "justify-between",
    active && "border-brand/50 bg-brand/10 text-brand hover:bg-brand/10",
    className,
  );
}

/** One field as a dropdown in the row. */
export function FieldFacet({
  label,
  Icon,
  options,
  values,
  onChange,
  className,
}: {
  label: string;
  Icon: Glyph;
  options: string[];
  values: string[];
  onChange: (values: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const active = values.length > 0 && !open;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        disabled={options.length === 0}
        className={facetClasses(active, className)}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon className={cn("size-4 shrink-0", active ? "text-brand" : "text-ink-meta")} />
          <span className="truncate">{label}</span>
        </span>
        {values.length > 0 && <span className="sr-only">, {values.length} selected</span>}
        <ChevronDownIcon className="text-muted-foreground size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-max max-w-[calc(100vw-2rem)] min-w-(--anchor-width)"
      >
        {options.map((value) => (
          <MenuPrimitive.CheckboxItem
            key={value}
            checked={values.includes(value)}
            onCheckedChange={(on) =>
              onChange(on ? [...values, value] : values.filter((v) => v !== value))
            }
            closeOnClick={false}
            className={checkRowClasses}
          >
            <span className="truncate">{value}</span>
            <CheckRowBox />
          </MenuPrimitive.CheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
          {chipSection("track", "Track")}
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
        <Icon className="text-ink-meta size-4 shrink-0" />
        {label}
      </h3>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </section>
  );
}
