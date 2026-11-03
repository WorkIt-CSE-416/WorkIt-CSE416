import type { ComponentProps } from "react";

import { FIELD_CONTROL, FIELD_LABEL, RequiredMark } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

type TextAreaProps = {
  /** Grows with its text instead of scrolling (`field-sizing: content`),
   *  never shorter than `rows` lines, and has no resize handle: a written
   *  answer, a list of courses. */
  grow?: boolean;
} & Omit<ComponentProps<"textarea">, "className">;

/**
 * The bare box of <TextAreaField>, for a box whose label is not a field
 * label: Written Answers' fact box, named by the question it asks. A box
 * with a plain label is a <TextAreaField>.
 *
 * Padded as <TextField>'s input is (py-2.5), so a one-row box that grows
 * is a text field's 42px.
 */
export function TextArea({ grow, rows = 6, style, ...textarea }: TextAreaProps) {
  return (
    // resize-y, not the browser default of both: horizontal resize would
    // drag the textarea out past the card it sits in.
    <textarea
      rows={rows}
      className={cn(
        FIELD_CONTROL,
        "block px-3.5 py-2.5",
        grow ? "field-sizing-content resize-none" : "resize-y",
      )}
      // `field-sizing: content` ignores `rows`, so the floor is set here:
      // the rows' 20px lines, the padding and the border.
      style={grow ? { minHeight: `calc(${rows} * 1.25rem + 1.375rem)`, ...style } : style}
      {...textarea}
    />
  );
}

/**
 * A labelled multi-line box, drawn as <TextField> is (FIELD_CONTROL and
 * FIELD_LABEL). Promoted from the company composer on its second consumer,
 * Create Event's Note (KAN-429), which had drawn a bare <textarea> with the
 * field's classes. Every textarea with a field label is one (KAN-559).
 */
export function TextAreaField({
  id,
  label,
  hint,
  required,
  ...textarea
}: {
  id: string;
  label: string;
  /** Helper copy under the box: "Use Markdown for formatting." */
  hint?: string;
} & TextAreaProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
        {required && <RequiredMark />}
      </label>

      <TextArea
        id={id}
        required={required}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...textarea}
      />

      {hint && (
        <p id={`${id}-hint`} className="text-note text-ink-meta">
          {hint}
        </p>
      )}
    </div>
  );
}
