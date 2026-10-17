"use client";

import { Chip } from "@/components/ui/chip";

import { CheckIcon } from "./icons";

/**
 * A fixed set of job types, any number pressed at once — <ToggleGroup> is
 * built for exactly-one-of and Base UI's multi-select variant brings the same
 * keyboard model a picker needs, which this does not: applicants tap through
 * plain buttons, not arrow-key between them. Each is a choice Chip
 * (ui/chip.tsx), so a "chosen" chip reads the same wherever it appears; it
 * drew its own pill until KAN-251.
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
          <Chip key={option} pressed={active} onClick={() => toggle(option)}>
            {active && <CheckIcon />}
            {option}
          </Chip>
        );
      })}
    </div>
  );
}
