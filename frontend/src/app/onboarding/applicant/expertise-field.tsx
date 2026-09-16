"use client";

import { useState, type KeyboardEvent } from "react";

import { CloseIcon } from "@/components/icons";
import { FIELD_CONTROL } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

/**
 * "Choose or type" for a field with no fixed vocabulary — expertise is
 * whatever the applicant says it is, so unlike <SelectField> this never closes
 * off free text. Enter or a comma commits whatever is typed; Backspace on an
 * empty box drops the most recent tag, which is the shorthand every tag input
 * with a text box teaches.
 *
 * `suggestions` are just pre-filled commits: clicking one calls the same
 * `onAdd` a typed value would. Already-chosen suggestions are hidden rather
 * than disabled, so the row shrinks as the applicant works through it instead
 * of filling with struck-through chips.
 */
type ExpertiseFieldProps = {
  id: string;
  labelledBy: string;
  values: string[];
  onChange: (values: string[]) => void;
  suggestions: readonly string[];
};

export function ExpertiseField({
  id,
  labelledBy,
  values,
  onChange,
  suggestions,
}: ExpertiseFieldProps) {
  const [input, setInput] = useState("");

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (values.some((value) => value.toLowerCase() === trimmed.toLowerCase())) {
      setInput("");
      return;
    }
    onChange([...values, trimmed]);
    setInput("");
  }

  function remove(value: string) {
    onChange(values.filter((v) => v !== value));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(input);
      return;
    }
    if (event.key === "Backspace" && input === "" && values.length > 0) {
      remove(values[values.length - 1]);
    }
  }

  const remaining = suggestions.filter(
    (suggestion) => !values.some((value) => value.toLowerCase() === suggestion.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-2.5">
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <li key={value}>
              <span className="bg-brand-tint text-ink-muted text-note inline-flex items-center gap-1 rounded-full py-1 pr-1.5 pl-2.5">
                {value}
                <button
                  type="button"
                  aria-label={`Remove ${value}`}
                  onClick={() => remove(value)}
                  className="hover:bg-brand/10 focus-visible:ring-brand-ring rounded-full p-0.5 focus-visible:ring-2 focus-visible:outline-none"
                >
                  <CloseIcon className="size-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <input
        id={id}
        aria-labelledby={labelledBy}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="e.g. Frontend Development"
        className={cn(FIELD_CONTROL, "px-3.5 py-2")}
      />

      {remaining.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {remaining.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => commit(suggestion)}
              className="border-border-subtle text-ink-meta hover:border-brand hover:text-brand text-note focus-visible:ring-brand-ring rounded-full border px-2.5 py-1 focus-visible:ring-2 focus-visible:outline-none"
            >
              + {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
