import type { ComponentProps } from "react";

import { SearchIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * The compact search input that lives in the app top bar.
 *
 * Separate from <TextField> rather than a flag on it: this one carries no
 * visible label, sits on a 33px line rather than a form's 40px one, and is
 * always a search input. `label` is still required and rendered for screen
 * readers — a placeholder is not an accessible name, and it disappears the
 * moment anyone types.
 *
 * type="search" is deliberate. It gives the field a clear button and the
 * Escape-to-clear behaviour people expect, which matters more here than the
 * small cross-browser difference in how that button is drawn.
 */
type SearchFieldProps = {
  id: string;
  label: string;
  className?: string;
} & Omit<ComponentProps<"input">, "id" | "className" | "type">;

export function SearchField({ id, label, className, ...input }: SearchFieldProps) {
  return (
    <div className={cn("relative", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <SearchIcon className="text-ink-meta pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <input
        id={id}
        type="search"
        className="border-border-subtle bg-panel rounded-control text-label text-ink placeholder:text-ink-meta focus-visible:border-brand focus-visible:ring-brand-ring h-[33px] w-full border py-0 pr-3 pl-9 font-normal focus-visible:ring-[3px] focus-visible:outline-none"
        {...input}
      />
    </div>
  );
}
