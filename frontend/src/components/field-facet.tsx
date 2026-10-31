"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { useState, type ComponentType, type Ref } from "react";

import { ChevronDownIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { buttonClasses } from "@/components/ui/button";
import { CheckRowBox, checkRowClasses } from "@/components/ui/check-row";
import { cn } from "@/lib/cn";

/**
 * A filter dropdown in the Jobs page facet's look (jobs/filters.tsx): a
 * small secondary button with the field's glyph, its label and a chevron,
 * taking the brand tint while it holds a pick and is closed, over checkbox
 * rows (ui/check-row.tsx). A pick leaves it open for the next. Used by the
 * Applications filter row (KAN-282) and Live Activity's Status filter on
 * Auto Apply (KAN-285); `facetClasses` and `FacetLabel` also draw the
 * Applications page's Company dropdown, which holds a search field.
 */

export type Glyph = ComponentType<{ className?: string }>;

/** One option in a dropdown: a glyph only where it differs by option. */
export type FacetOption = {
  value: string;
  label: string;
  Icon?: Glyph;
  iconClassName?: string;
};

/** The Jobs page facet's look: a small secondary button with the brand
 *  tint while it holds a pick and its list is closed. */
export function facetClasses(active: boolean, className?: string) {
  return cn(
    buttonClasses({ variant: "secondary", size: "sm" }),
    "justify-between",
    active && "border-brand/50 bg-brand/10 text-brand hover:bg-brand/10",
    className,
  );
}

/** A dropdown button's glyph and label, and its pick count for a screen
 *  reader (the tint says it by colour alone). */
export function FacetLabel({
  Icon,
  label,
  active,
  count,
}: {
  Icon: Glyph;
  label: string;
  active: boolean;
  count: number;
}) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon
          aria-hidden
          className={cn("size-4 shrink-0", active ? "text-brand" : "text-ink-meta")}
        />
        <span className="truncate">{label}</span>
      </span>
      {count > 0 && <span className="sr-only">, {count} selected</span>}
    </>
  );
}

/** An option's row content: its glyph, if it has one, and its label. */
export function OptionLabel({ option }: { option: FacetOption }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {option.Icon && (
        <option.Icon
          aria-hidden
          className={cn("size-4 shrink-0", option.iconClassName ?? "text-ink-meta")}
        />
      )}
      <span className="truncate">{option.label}</span>
    </span>
  );
}

/** One dropdown: its options as checkbox rows, in the options' order. */
export function FieldFacet({
  ref,
  label,
  Icon,
  options,
  values,
  onChange,
  className,
}: {
  /** The trigger button, for a Clear Filters that hands focus to it. */
  ref?: Ref<HTMLButtonElement>;
  label: string;
  Icon: Glyph;
  options: FacetOption[];
  values: string[];
  onChange: (values: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const active = values.length > 0 && !open;
  // In the options' order, whatever order they were ticked in.
  const ordered = (next: string[]) => options.map((o) => o.value).filter((v) => next.includes(v));

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        ref={ref}
        disabled={options.length === 0}
        className={facetClasses(active, className)}
      >
        <FacetLabel Icon={Icon} label={label} active={active} count={values.length} />
        <ChevronDownIcon className="text-muted-foreground size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-max max-w-[calc(100vw-2rem)] min-w-(--anchor-width)"
      >
        {options.map((option) => (
          <MenuPrimitive.CheckboxItem
            key={option.value}
            checked={values.includes(option.value)}
            onCheckedChange={(on) =>
              onChange(
                ordered(on ? [...values, option.value] : values.filter((v) => v !== option.value)),
              )
            }
            closeOnClick={false}
            className={checkRowClasses}
          >
            <OptionLabel option={option} />
            <CheckRowBox />
          </MenuPrimitive.CheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
