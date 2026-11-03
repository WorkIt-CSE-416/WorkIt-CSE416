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
 * A WHITE PILL WITH A CONTROL EDGE. It is a wide rounded-full field filled
 * --color-panel, as <TextField> is, and outlined in --color-border-control,
 * so it stands off the seeker pages' grey ground and still shows by its edge
 * inside a white card or dialog. It was filled a 5% see-through ink so it
 * would "read on white and on grey alike"; on the grey ground that was one
 * shade darker than the page, and the bar blended into the Jobs page
 * (2026-11-03). With no outline, as first drawn for a white page, the wash
 * was a 1.1:1 edge on the grey ground, under WCAG 1.4.11's 3:1 for the edge
 * of a control (KAN-556). A lavender fill tinted the bar for no reason.
 * Focus draws the app's solid violet ring around the pill.
 *
 * 40px tall, the bell's and the account photo's height, so the bar's
 * controls share one height. Type is 16px below `sm` so iOS Safari does not
 * zoom the page on focus, at a 20px line so the pill stays 40px; the
 * placeholder is --color-ink-meta.
 *
 * It answers the pointer too: the edge darkens to --color-ink-meta on hover
 * (a fill that steps deeper would grey the white pill again), and the
 * magnifier darkens while the field has focus, so the field looks awake
 * while it is being typed in.
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
    <div className={cn("group/search relative", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <SearchIcon className="text-ink-meta group-focus-within/search:text-ink pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 transition-colors duration-150" />
      <input
        id={id}
        type="search"
        className="bg-panel border-border-control hover:border-ink-meta text-ink sm:text-body placeholder:text-ink-meta focus-visible:ring-brand-ring h-10 w-full rounded-full border pr-4 pl-10 text-base/5 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
        {...input}
      />
    </div>
  );
}
