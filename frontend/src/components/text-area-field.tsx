import type { ComponentProps } from "react";

import { FIELD_CONTROL, FIELD_LABEL, RequiredMark } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

/**
 * A labelled multi-line box, drawn as <TextField> is (FIELD_CONTROL and
 * FIELD_LABEL). Promoted from the company composer on its second consumer,
 * Create Event's Note (KAN-429), which had drawn a bare <textarea> with the
 * field's classes.
 */
export function TextAreaField({
  id,
  label,
  hint,
  rows = 6,
  required,
  ...textarea
}: {
  id: string;
  label: string;
  /** Helper copy under the box: "Use Markdown for formatting." */
  hint?: string;
} & Omit<ComponentProps<"textarea">, "id" | "className">) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
        {required && <RequiredMark />}
      </label>

      {/* resize-y, not the browser default of both: horizontal resize would
          drag the textarea out past the card it sits in. */}
      <textarea
        id={id}
        rows={rows}
        required={required}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={cn(FIELD_CONTROL, "resize-y px-3.5 py-2")}
        {...textarea}
      />

      {hint && (
        <p id={`${id}-hint`} className="text-meta text-ink-meta">
          {hint}
        </p>
      )}
    </div>
  );
}
