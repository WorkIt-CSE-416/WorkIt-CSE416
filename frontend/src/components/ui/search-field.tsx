import type { ComponentProps } from "react";

import { SearchIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * The compact search input that lives in the app top bar.
 *
 * Separate from <TextField> rather than a flag on it: this one carries no
 * visible label and is always a search input. `label` is still required and
 * rendered for screen readers: a placeholder is not an accessible name, and
 * it disappears the moment anyone types.
 *
 * A FILLED PILL, NOT AN OUTLINED BOX. It is a wide rounded-full field filled
 * a neutral light grey (--color-app) with no border, the way the reference
 * dashboard draws its search, and the same fill as the bar's round bell (see
 * (seeker)/bar.ts), so the bar's controls read as one family of soft shapes.
 * A grey 3:1 outline here made the bar look assembled from stock form parts,
 * and a lavender fill tinted the bar for no reason. The field is still
 * unmistakable: the magnifier, the placeholder and the fill say what it is,
 * and focus draws the app's solid violet ring around the pill.
 *
 * 40px tall, the bell's and the account photo's height, so the bar's
 * controls share one height. Type is 16px below `sm` so iOS Safari does not
 * zoom the page on focus, at a 20px line so the pill stays 40px; the
 * placeholder is --color-ink-meta, 5.13:1 on the fill.
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
      <SearchIcon className="text-ink-meta pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2" />
      <input
        id={id}
        type="search"
        className="bg-app text-ink sm:text-body placeholder:text-ink-meta focus-visible:ring-brand-ring h-10 w-full rounded-full pr-4 pl-10 text-base/5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
        {...input}
      />
    </div>
  );
}
