import type { ComponentProps, ReactNode } from "react";

/**
 * The one radio, and the row a list of one-pick answers draws it in. The
 * sibling of ui/check-row.tsx, which is a menu's several-pick row; this is a
 * form's.
 *
 * `Radio` is the native input in the brand accent. Every one-pick list in
 * the app draws it: the rows below, and the resume pickers' cards
 * (`pickRowClasses`, (seeker)/jobs/resume-picker.tsx), which hold more than a
 * label. A native radio keeps the arrow keys and the one tab stop a radio
 * group needs with no script. Each screen drew its own `<input
 * type="radio">` until KAN-559; change the radio here and every list moves.
 *
 * `RadioRow` is an answer offered as a bordered row, its border brand once
 * picked: the uninstall survey's reasons and Written Answers' one-pick
 * questions. `OPTION_ROW` is its box, for the same row holding a checkbox
 * (Written Answers' several-pick questions, which sit in the same list),
 * so the two kinds of answer look alike. The whole row is the label, so the
 * whole row takes the press.
 *
 * Still open: the native radio is 13px beside the 16px shadcn Checkbox, and
 * the audit asked for a drawn 20px one (resumes and marketing, Lows).
 */
export function Radio(props: Omit<ComponentProps<"input">, "type" | "className">) {
  return <input type="radio" className="accent-brand shrink-0" {...props} />;
}

/** `has-data-checked` is the Checkbox's picked state, `has-checked` the radio's. */
export const OPTION_ROW =
  "hover:bg-hover has-checked:border-brand has-data-checked:border-brand border-border rounded-control text-body text-ink flex cursor-pointer items-center gap-3 border px-3 py-2";

export function RadioRow({
  children,
  ...radio
}: { children: ReactNode } & Omit<ComponentProps<"input">, "type" | "className" | "children">) {
  return (
    <label className={OPTION_ROW}>
      <Radio {...radio} />
      <span className="min-w-0 break-words">{children}</span>
    </label>
  );
}
