"use client";

import { cn } from "@/lib/cn";

import { CheckIcon } from "./icons";

/**
 * A fixed set of job types, any number pressed at once — <ToggleGroup> is
 * built for exactly-one-of and Base UI's multi-select variant brings the same
 * keyboard model a picker needs, which this does not: applicants tap through
 * plain buttons, not arrow-key between them. The pressed style matches the
 * login screen's account-type switcher (brand tint, brand-ink label) so a
 * "chosen" chip reads the same wherever it appears.
 */
export function JobTypeField({
  labelledBy,
  values,
  onChange,
  options,
}: {
  labelledBy: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: readonly string[];
}) {
  function toggle(option: string) {
    onChange(values.includes(option) ? values.filter((v) => v !== option) : [...values, option]);
  }

  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = values.includes(option);

        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(option)}
            className={cn(
              "text-label focus-visible:ring-brand-ring inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-medium focus-visible:ring-2 focus-visible:outline-none",
              active
                ? "border-brand bg-brand-tint text-brand-ink"
                : "border-border-subtle text-ink-meta hover:border-border-strong hover:text-ink",
            )}
          >
            {active && <CheckIcon className="size-3.5" />}
            {option}
          </button>
        );
      })}
    </div>
  );
}
