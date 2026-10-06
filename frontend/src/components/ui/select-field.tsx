"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FIELD_CONTROL, FIELD_LABEL, RequiredMark } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

/* Promoted from app/company/jobs/new/fields.tsx the day signup's company-size
 * picker became a second consumer. */

export type SelectOption = string | { value: string; label: string };

type SelectFieldProps = {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  /** A bare string is its own label. Pass `{ value, label }` when what is
   *  submitted is a code the user should not read ("1_50" vs "1–50"). */
  options: readonly SelectOption[];
  /** Submits the value with the enclosing form, through the hidden input
   *  Base UI renders. Omit for a picker whose parent reads `value` itself. */
  name?: string;
  /** Shown when nothing is selected. Omit for a field that opens on a value. */
  placeholder?: string;
  /** Keep the label for assistive tech but take it off the screen — for a
   *  picker whose column or neighbours already say what it sets. It is never
   *  dropped outright: an unnamed combobox is announced as its current value
   *  and nothing else. */
  hideLabel?: boolean;
  /** Visual only, same as <LocationField>'s — the trigger is a button, not a
   *  native <select>, so there is no `required` attribute to lean on. */
  required?: boolean;
  /** Marks the trigger aria-invalid, which FIELD_CONTROL draws red, the way a
   *  <TextField> takes `aria-invalid` directly. */
  invalid?: boolean;
  /** The id of the message that explains the field, usually its error. */
  describedBy?: string;
  className?: string;
};

/**
 * A labelled picker, styled to sit in a row beside <TextField> without looking
 * like it came from somewhere else.
 *
 * WHY THE LABEL IS WIRED WITH aria-labelledby AND NOT JUST htmlFor: the trigger
 * is not a <select>. Base UI renders it as a <button role="combobox">, and a
 * button takes its accessible name from its own contents — a <label for> is
 * ignored on it, which would leave this field announced as "Engineering" with
 * no hint that Engineering is a department. Pointing aria-labelledby at the
 * label is what names it; the htmlFor stays because it is what makes clicking
 * the word focus the control. `${id}-label` is Base UI's own convention for the
 * id, so the two agree if a Field wrapper is ever added around this.
 *
 * The vendored trigger's own classes are stock shadcn — 32px tall, text-sm,
 * rounded-lg — which is a different control from WorkIt's input. They are
 * overridden here rather than in src/components/shadcn/select.tsx, which
 * `shadcn add` regenerates.
 */
export function SelectField({
  id,
  label,
  value,
  onValueChange,
  options,
  placeholder,
  hideLabel = false,
  name,
  required,
  invalid,
  describedBy,
  className,
}: SelectFieldProps) {
  const items = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label id={`${id}-label`} htmlFor={id} className={cn(FIELD_LABEL, hideLabel && "sr-only")}>
        {label}
        {required && <RequiredMark />}
      </label>

      {/* `items` is what lets <SelectValue> show a label rather than the raw
          value when the two differ. onValueChange is adapted because Base
          UI's own signature widens to `string | null` — clearing is not
          reachable from this field, but the type says it is. */}
      <Select
        items={items}
        name={name}
        value={value}
        onValueChange={(next) => onValueChange(next ?? "")}
      >
        {/* THE HEIGHT OVERRIDE IS WRITTEN TWICE, and the duplicate is the
            whole point. FIELD_CONTROL has no height — it is sized by its
            padding, the way the input beside it is — but the stock trigger
            pins one, and it pins it as `data-[size=default]:h-8`. A bare
            `h-auto` does not touch that: tailwind-merge groups by variant as
            well as by property, so a plain utility and a data-variant one are
            different groups and both survive. The variant then wins on
            specificity — `.h-8[data-size="default"]` outranks `.h-auto` — and
            the picker renders 32px tall next to a 42px input. Repeating the
            override under the same variant is what puts the two in one group
            so cn() can drop the loser. This is the failure cn() cannot close
            on its own, described in lib/cn.ts and in CLAUDE.md.

            The paddings are separate groups from anything the trigger sets,
            so those are simply added. data-placeholder:text-ink-meta names the
            empty state's grey outright, the one FIELD_CONTROL gives an input's
            placeholder, rather than leaning on shadcn's muted-foreground.

            The last line takes off the stock trigger's invalid halo (a 3px
            destructive ring under `aria-invalid:ring-3`), so an invalid picker
            is outlined red and nothing else, like an invalid <TextField>
            beside it. A bare `aria-invalid:ring-0` would also kill the focus
            ring, since the aria variant sorts after focus-visible; the
            compound focus-visible:aria-invalid pair sorts after both and puts
            back the same brand ring a focused <TextField> draws. */}
        <SelectTrigger
          id={id}
          aria-labelledby={`${id}-label`}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(
            FIELD_CONTROL,
            "h-auto data-[size=default]:h-auto",
            "data-placeholder:text-ink-meta py-2.5 pr-3 pl-3.5",
            "focus-visible:aria-invalid:ring-brand-ring aria-invalid:ring-0 focus-visible:aria-invalid:ring-[3px]",
          )}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>

        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
