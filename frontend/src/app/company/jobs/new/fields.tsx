import type { ComponentProps } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FIELD_CONTROL, FIELD_LABEL } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

/**
 * The two controls this form needs that <TextField> is not: a multi-line box
 * and a picker.
 *
 * They live beside the route rather than in src/components/ui because this is
 * the only screen that has one of each — the repo promotes on the second
 * consumer, not in anticipation of one. What they do not do is restate the
 * styling: both build on FIELD_CONTROL and FIELD_LABEL from ui/text-field.tsx,
 * so the three controls on this form are one box drawn three times rather than
 * three boxes that currently agree. Move the file, not the classes, when a
 * second form wants them.
 */

type TextAreaFieldProps = {
  id: string;
  label: string;
  /** Helper copy under the box — "Use Markdown for formatting." */
  hint?: string;
} & Omit<ComponentProps<"textarea">, "id" | "className">;

export function TextAreaField({ id, label, hint, rows = 6, ...textarea }: TextAreaFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>

      {/* resize-y, not the browser default of both: horizontal resize would
          drag the textarea out past the card it sits in. */}
      <textarea
        id={id}
        rows={rows}
        className={cn(FIELD_CONTROL, "resize-y px-3.5 py-2")}
        {...textarea}
      />

      {hint && (
        <p id={`${id}-hint`} className="text-meta text-ink-faint">
          {hint}
        </p>
      )}
    </div>
  );
}

type SelectFieldProps = {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly string[];
  /** Shown when nothing is selected. Omit for a field that opens on a value. */
  placeholder?: string;
  /** Keep the label for assistive tech but take it off the screen — for a
   *  picker whose column or neighbours already say what it sets. It is never
   *  dropped outright: an unnamed combobox is announced as its current value
   *  and nothing else. */
  hideLabel?: boolean;
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
  className,
}: SelectFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label id={`${id}-label`} htmlFor={id} className={cn(FIELD_LABEL, hideLabel && "sr-only")}>
        {label}
      </label>

      {/* No `items` prop: it exists so <SelectValue> can render a label for a
          value that is not itself display text, and here the two are the same
          string. onValueChange is adapted because Base UI's own signature
          widens to `string | null` — clearing is not reachable from this
          field, but the type says it is. */}
      <Select value={value} onValueChange={(next) => onValueChange(next ?? "")}>
        {/* THE HEIGHT OVERRIDE IS WRITTEN TWICE, and the duplicate is the
            whole point. FIELD_CONTROL has no height — it is sized by its
            padding, the way the input beside it is — but the stock trigger
            pins one, and it pins it as `data-[size=default]:h-8`. A bare
            `h-auto` does not touch that: tailwind-merge groups by variant as
            well as by property, so a plain utility and a data-variant one are
            different groups and both survive. The variant then wins on
            specificity — `.h-8[data-size="default"]` outranks `.h-auto` — and
            the picker renders 32px tall next to a 38px input. Repeating the
            override under the same variant is what puts the two in one group
            so cn() can drop the loser. This is the failure cn() cannot close
            on its own, described in lib/cn.ts and in CLAUDE.md.

            The paddings are separate groups from anything the trigger sets,
            so those are simply added. */}
        <SelectTrigger
          id={id}
          aria-labelledby={`${id}-label`}
          className={cn(FIELD_CONTROL, "h-auto data-[size=default]:h-auto", "py-2 pr-3 pl-3.5")}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>

        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
