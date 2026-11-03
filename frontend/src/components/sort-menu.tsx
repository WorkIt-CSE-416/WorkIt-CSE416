"use client";

import { ArrowsDownUpIcon } from "@phosphor-icons/react/ssr";

import { FacetLabel, facetClasses } from "@/components/field-facet";
import { ChevronDownIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";

/**
 * A list's Sort dropdown (the Resumes page, KAN-366; the Jobs page, KAN-519):
 * drawn as a filter's dropdown is (`facetClasses`), its button naming the order
 * in force. It never takes the filter's brand tint, which marks a filter
 * holding a pick: an order is always in force. A dropdown, not pills: pills in
 * a header beside another switch read as one kind of choice.
 */
export function SortMenu<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  className?: string;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Sort by ${current.label}`}
        className={facetClasses(false, className ?? "min-w-36")}
      >
        <FacetLabel Icon={ArrowsDownUpIcon} label={current.label} active={false} count={0} />
        <ChevronDownIcon className="text-muted-foreground size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-max min-w-(--anchor-width)">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
