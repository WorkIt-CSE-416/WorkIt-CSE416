"use client";

import { Plus, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SelectField } from "@/components/ui/select-field";
import { FIELD_CONTROL, FIELD_LABEL, TextField } from "@/components/ui/text-field";
import type { BankEntry, EndKind } from "@/lib/bank-actions";
import { cn } from "@/lib/cn";

import { savable, sectionOf, type EntryDraft } from "./sections";

/**
 * The one entry editor (spec: one screen for forms, intake and import). It
 * edits a draft and hands the whole draft to `onSave`; the caller decides
 * whether that is a new entry or an edit, so intake and import can reuse it
 * with drafts that were never saved. Each section shows its own fields:
 * Education its degree, field of study, GPA and scale, coursework and honors;
 * Projects a link; Certifications an issuer; Awards one date in place of the
 * start and end.
 *
 * Only the title is required, so a student can save an entry with a section
 * and a title and add the rest later. The API checks everything again.
 *
 * THE LAYOUT (KAN-257) is two columns at every width. A pair of short
 * fields shares a row (the start and end, a degree and its field, a GPA and
 * its scale) and a long one takes the row; the organization and location
 * pair up where the form is wide. A school leads with its degree, dates and
 * GPA, the facts a resume prints first, and its optional college and
 * location follow. In Scout's panel the form was one column of up to
 * thirteen boxes, with the college and location ahead of the dates intake
 * was asking about. An empty month prints its dashes in the placeholder
 * grey, coursework wraps in a box that grows, and a GPA has no spin arrows.
 */

const END_OPTIONS = [
  { value: "none", label: "No End Date" },
  { value: "month", label: "Ended" },
  { value: "present", label: "Present" },
  { value: "expected", label: "Expected" },
];

/** "" is "not given", which the API reads as null. */
const text = (value: string) => (value.trim() === "" ? null : value);
const number = (value: string) => (value.trim() === "" ? null : Number(value));

export function EntryEditor({
  initial,
  onSave,
  onCancel,
  saving = false,
  error,
  duplicate,
  onSaveAsNew,
  onChange,
  cancelLabel = "Cancel",
}: {
  initial: EntryDraft;
  onSave: (draft: EntryDraft) => void;
  onCancel: () => void;
  saving?: boolean;
  error?: string | null;
  /** The bank entry this draft matches (same section, title and
   *  organization, ignoring case). The editor then warns "This looks like
   *  <entry>" and offers Save as New, which hands the draft to
   *  `onSaveAsNew`, or Cancel. */
  duplicate?: Pick<BankEntry, "title" | "organization"> | null;
  onSaveAsNew?: (draft: EntryDraft) => void;
  /** Every edit, as the whole draft: intake sends the card's edits back to
   *  the model with each turn. */
  onChange?: (draft: EntryDraft) => void;
  cancelLabel?: string;
}) {
  const [draft, setDraft] = useState(initial);
  const uid = useId();
  const section = sectionOf(draft.section);
  const set = (changes: Partial<EntryDraft>) => {
    const next = { ...draft, ...changes };
    setDraft(next);
    onChange?.(next);
  };
  const field = (name: string) => `${uid}-${name}`;

  /** A new bullet box at the end, or back to the last one while it is empty. */
  function addBullet() {
    const last = draft.bullets.length - 1;
    if (last >= 0 && draft.bullets[last].text.trim() === "") {
      document.getElementById(field(`bullet-${last}`))?.focus();
    } else {
      set({ bullets: [...draft.bullets, { text: "" }] });
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave(savable(draft));
  }

  const education = draft.section === "education";

  // Stacked where the form is narrow (Scout's panel), side by side where it
  // is wide (the bank page).
  const place = (
    <>
      <div className="col-span-2 @lg/main:col-span-1">
        <TextField
          id={field("organization")}
          label={section.organization}
          maxLength={200}
          value={draft.organization ?? ""}
          onChange={(e) => set({ organization: text(e.target.value) })}
        />
      </div>
      <div className="col-span-2 @lg/main:col-span-1">
        <TextField
          id={field("location")}
          label="Location"
          maxLength={200}
          placeholder="City, State"
          value={draft.location ?? ""}
          onChange={(e) => set({ location: text(e.target.value) })}
        />
      </div>
    </>
  );

  const dates =
    draft.section === "awards" ? (
      <MonthField
        id={field("award-date")}
        label="Award Date"
        value={draft.award_date}
        onChange={(award_date) => set({ award_date })}
      />
    ) : (
      <>
        <MonthField
          id={field("start")}
          label="Start Month"
          value={draft.start_month}
          onChange={(start_month) => set({ start_month })}
        />
        <SelectField
          id={field("end-kind")}
          label="End"
          options={END_OPTIONS}
          value={draft.end_kind ?? "none"}
          onValueChange={(v) => set({ end_kind: v === "none" ? null : (v as EndKind) })}
        />
        {/* Under End, the choice it belongs to. */}
        {draft.end_kind && draft.end_kind !== "present" && (
          <div className="col-start-2">
            <MonthField
              id={field("end")}
              label={draft.end_kind === "expected" ? "Expected Month" : "End Month"}
              required
              value={draft.end_month}
              onChange={(end_month) => set({ end_month })}
            />
          </div>
        )}
      </>
    );

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {/* No spin arrows on a GPA: nobody steps through one. */}
      <div className="grid grid-cols-2 gap-3 [&_input::-webkit-inner-spin-button]:appearance-none [&_input::-webkit-outer-spin-button]:appearance-none [&_input[type=number]]:[appearance:textfield]">
        <div className="col-span-2">
          <TextField
            id={field("title")}
            label={section.title}
            required
            maxLength={200}
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
          />
        </div>

        {education && (
          <>
            <TextField
              id={field("degree")}
              label="Degree"
              placeholder="B.S."
              maxLength={200}
              value={draft.degree ?? ""}
              onChange={(e) => set({ degree: text(e.target.value) })}
            />
            <TextField
              id={field("field-of-study")}
              label="Field of Study"
              maxLength={200}
              value={draft.field_of_study ?? ""}
              onChange={(e) => set({ field_of_study: text(e.target.value) })}
            />
          </>
        )}
        {!education && place}
        {dates}

        {education && (
          <>
            <TextField
              id={field("gpa")}
              label="GPA"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={draft.gpa ?? ""}
              onChange={(e) => set({ gpa: number(e.target.value) })}
            />
            <TextField
              id={field("gpa-scale")}
              label="GPA Scale"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              placeholder="4.0"
              value={draft.gpa_scale ?? ""}
              onChange={(e) => set({ gpa_scale: number(e.target.value) })}
            />
            {place}
            <div className="col-span-2">
              <ListField
                id={field("coursework")}
                label="Coursework"
                value={draft.coursework}
                onChange={(coursework) => set({ coursework })}
              />
            </div>
            <div className="col-span-2">
              <TextField
                id={field("honors")}
                label="Honors"
                placeholder="Dean's List, cum laude"
                maxLength={500}
                value={draft.honors ?? ""}
                onChange={(e) => set({ honors: text(e.target.value) })}
              />
            </div>
          </>
        )}
        {draft.section === "projects" && (
          <div className="col-span-2">
            <TextField
              id={field("link")}
              label="Link"
              type="url"
              placeholder="https://"
              maxLength={500}
              value={draft.link ?? ""}
              onChange={(e) => set({ link: text(e.target.value) })}
            />
          </div>
        )}
        {draft.section === "certifications" && (
          <div className="col-span-2">
            <TextField
              id={field("issuer")}
              label="Issuer"
              maxLength={200}
              value={draft.issuer ?? ""}
              onChange={(e) => set({ issuer: text(e.target.value) })}
            />
          </div>
        )}
      </div>

      {/* Each bullet is a box with its bullet mark drawn in, so it reads as
          the list it makes; the last row is a dashed box of the same size,
          Add Bullet Point, whose + sits under the marks. Add Bullet used to
          be bare brand text under the label, which read as crowded against
          it. A box Add Bullet Point makes takes the cursor, and while the
          last box is empty the button goes back to it rather than stacking
          another empty one.
          A box grows with its text (field-sizing, as the resume editor's
          lines do), so a long bullet wraps in view rather than scrolling
          sideways in a one-line input; its mark and × stay on the first
          line. A bullet is one line on the resume, so it never holds a line
          break: Enter goes to the next box, as Add Bullet Point does from
          the last, and a pasted break becomes a space. */}
      <div role="group" aria-labelledby={field("bullets")} className="flex flex-col gap-1">
        <span id={field("bullets")} className={FIELD_LABEL}>
          Bullets
        </span>
        <div className="flex flex-col gap-2">
          {draft.bullets.map((bullet, i) => (
            <div key={bullet.id ?? `new-${i}`} className="flex items-start gap-2">
              <div className="relative min-w-0 flex-1">
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-0 left-3.5 flex h-10.5 w-4 items-center justify-center"
                >
                  <span className="bg-ink-meta size-1.5 rounded-full" />
                </span>
                <textarea
                  id={field(`bullet-${i}`)}
                  aria-label={`Bullet ${i + 1}`}
                  rows={1}
                  maxLength={500}
                  placeholder="One thing you did"
                  autoFocus={!bullet.id && bullet.text === ""}
                  className={cn(
                    FIELD_CONTROL,
                    "block field-sizing-content min-h-10.5 resize-none py-2.5 pr-3.5 pl-9.5",
                  )}
                  value={bullet.text}
                  onChange={(e) =>
                    set({
                      bullets: draft.bullets.map((b, j) =>
                        j === i ? { ...b, text: e.target.value.replace(/\s*\n\s*/g, " ") } : b,
                      ),
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    if (i < draft.bullets.length - 1) {
                      document.getElementById(field(`bullet-${i + 1}`))?.focus();
                    } else {
                      addBullet();
                    }
                  }}
                />
              </div>
              <IconButton
                label="Remove Bullet"
                tooltip="Remove this bullet"
                // Centred on the box's first line, beside the mark.
                className="mt-1.25 size-8"
                onClick={() => set({ bullets: draft.bullets.filter((_, j) => j !== i) })}
              >
                <X className="size-4" />
              </IconButton>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={addBullet}
              className={cn(
                FIELD_CONTROL,
                "text-ink-meta hover:border-brand hover:text-brand flex min-w-0 flex-1 items-center gap-2 border-dashed px-3.5 py-2.5 text-left transition-colors",
              )}
            >
              <Plus aria-hidden className="size-4 shrink-0" /> Add Bullet Point
            </button>
            {/* Keeps the box as wide as the bullets above, beside their × */}
            {draft.bullets.length > 0 && <span aria-hidden className="size-8 shrink-0" />}
          </div>
        </div>
      </div>

      {duplicate && (
        <div role="alert" className="rounded-control bg-warning-tint text-note text-ink p-3">
          This looks like <strong>{duplicate.title}</strong>
          {duplicate.organization ? ` at ${duplicate.organization}` : ""}, already in your bank.
          Save it as a new entry anyway?
        </div>
      )}
      {error && (
        <p role="alert" className="text-note text-danger">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          {cancelLabel}
        </Button>
        {duplicate && onSaveAsNew ? (
          <Button type="button" disabled={saving} onClick={() => onSaveAsNew(savable(draft))}>
            {saving ? "Saving…" : "Save as New"}
          </Button>
        ) : (
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save Entry"}
          </Button>
        )}
      </div>
    </form>
  );
}

/** A "YYYY-MM" month. Browsers without a month picker show a text box, so
 *  the pattern and placeholder say what to type there. Chrome draws an empty
 *  one as "--------- ----" in the ink colour, which read as a broken field;
 *  in the placeholder grey it reads as the shape to fill in. */
function MonthField({
  id,
  label,
  value,
  onChange,
  required,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  required?: boolean;
}) {
  return (
    <div
      data-empty={!value}
      className="data-[empty=true]:[&_input::-webkit-datetime-edit]:text-ink-meta"
    >
      <TextField
        id={id}
        label={label}
        type="month"
        placeholder="YYYY-MM"
        pattern="\d{4}-(0[1-9]|1[0-2])"
        required={required}
        value={value ?? ""}
        onChange={(e) => onChange(text(e.target.value))}
      />
    </div>
  );
}

/** Course names, typed separated by commas, kept as a list. A box that
 *  grows with its text, as a bullet's does, so a long list wraps in view;
 *  a one-line field cut it off after two or three courses. A typed or
 *  pasted line break becomes a comma, since the list has no lines. */
function ListField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [typed, setTyped] = useState(value.join(", "));
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      <textarea
        id={id}
        rows={1}
        placeholder="Data Structures, Operating Systems"
        className={cn(
          FIELD_CONTROL,
          "block field-sizing-content min-h-10.5 resize-none px-3.5 py-2.5",
        )}
        value={typed}
        onChange={(e) => {
          const next = e.target.value.replace(/\s*\n\s*/g, ", ");
          setTyped(next);
          onChange(
            next
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          );
        }}
      />
    </div>
  );
}
