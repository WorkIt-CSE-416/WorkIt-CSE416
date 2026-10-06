import type { ComponentProps } from "react";

import { SearchIcon } from "@/components/icons";
import { FIELD_CONTROL } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

/**
 * The compact search input that lives in the app top bar.
 *
 * Separate from <TextField> rather than a flag on it: this one carries no
 * visible label and is always a search input. `label` is still required and
 * rendered for screen readers: a placeholder is not an accessible name, and
 * it disappears the moment anyone types.
 *
 * THE SAME BOX AS EVERY OTHER FIELD. It is drawn from TextField's
 * FIELD_CONTROL and padded as a TextField with a leading icon is, so it is
 * 42px tall, outlined in --color-border-control (3:1 or better) and puts its
 * glyph where a form field puts one. It used to be a 40px box sized to the
 * top bar, outlined in --color-border-subtle at 1.19:1, which made the one
 * field on every screen the faintest and the only one drawn differently.
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
      <SearchIcon className="text-ink-meta pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2" />
      <input
        id={id}
        type="search"
        className={cn(FIELD_CONTROL, "py-2.5 pr-3.5 pl-11")}
        {...input}
      />
    </div>
  );
}
