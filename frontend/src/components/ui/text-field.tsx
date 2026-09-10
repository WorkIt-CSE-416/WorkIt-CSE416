import type { ComponentProps, ComponentType, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A labelled text input, optionally with a leading icon.
 *
 * `id` is required because the label is wired to it — without one the label
 * would not be clickable and the field would be unnamed to assistive tech.
 *
 * `labelAction` fills the right side of the label row (the login form puts
 * "Forgot password?" there). When it is present the row becomes a baseline-
 * aligned pair, which is what keeps the link's text sitting on the same line as
 * the label rather than on the taller of the two boxes.
 */

/**
 * The box every field control shares, exported so the controls that are not
 * inputs can be the same box.
 *
 * A form mixing a text input, a textarea and a select has to draw one control,
 * three times — same height, radius, border, fill and focus ring — and the
 * moment those strings are retyped anywhere else they start drifting. This is
 * the same rule ui/button.tsx follows: the classes live in one place and call
 * sites compose them. Padding is deliberately left out; a single-line input
 * pads differently from a textarea, and an input with a leading glyph pads
 * differently again.
 */
export const FIELD_CONTROL =
  "w-full rounded-control border-border-subtle bg-surface text-body text-ink border " +
  "placeholder:text-ink-subtle focus-visible:border-brand focus-visible:ring-[3px] " +
  "focus-visible:ring-brand-ring focus-visible:outline-none";

/** The type style of a field's label. */
export const FIELD_LABEL = "text-label text-ink-muted";

/* Cleared for the glyph: 14px to the icon (left-3.5), a 20px icon, 10px after. */
const INPUT_WITH_ICON = "pl-11";
const INPUT_WITHOUT_ICON = "pl-3.5";

type TextFieldProps = {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  labelAction?: ReactNode;
} & Omit<ComponentProps<"input">, "id" | "className">;

export function TextField({ id, label, icon: Icon, labelAction, ...input }: TextFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      {labelAction ? (
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={id} className={FIELD_LABEL}>
            {label}
          </label>
          {labelAction}
        </div>
      ) : (
        <label htmlFor={id} className={FIELD_LABEL}>
          {label}
        </label>
      )}

      <div className="relative">
        {Icon && (
          <Icon className="text-ink-subtle pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2" />
        )}
        <input
          id={id}
          className={cn(FIELD_CONTROL, "py-2 pr-3.5", Icon ? INPUT_WITH_ICON : INPUT_WITHOUT_ICON)}
          {...input}
        />
      </div>
    </div>
  );
}
