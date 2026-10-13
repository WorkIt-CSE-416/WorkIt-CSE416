"use client";

import { Plus, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SelectField } from "@/components/ui/select-field";
import { FIELD_CONTROL, FIELD_LABEL, TextField } from "@/components/ui/text-field";
import type { BankEntry, EndKind, Skill } from "@/lib/bank-actions";
import { cn } from "@/lib/cn";

import { sectionOf, type EntryDraft } from "./sections";
import { SkillLinksField } from "./skill-links";

/**
 * The one entry editor (spec: one screen for forms, intake and import). It
 * edits a draft and hands the whole draft to `onSave`; the caller decides
 * whether that is a new entry or an edit, so intake and import can reuse it
 * with drafts that were never saved. Each section shows its own fields:
 * Education its degree, field of study, GPA and scale, coursework and honors;
 * Projects a link; Certifications an issuer; Awards one date in place of the
 * start and end.
 *
 * Given `skills`, it also shows "Skills Used Here" and hands the linked
 * skill ids to `onSave` beside the draft (KAN-216).
 *
 * Only the title is required, so a student can save an entry with a section
 * and a title and add the rest later. The API checks everything again.
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
  skills,
  linkedSkillIds = [],
}: {
  initial: EntryDraft;
  onSave: (draft: EntryDraft, skillIds: string[]) => void;
  onCancel: () => void;
  saving?: boolean;
  error?: string | null;
  /** The bank entry this draft matches (same section, title and
   *  organization, ignoring case). The editor then warns "This looks like
   *  <entry>" and offers Save as New, which hands the draft to
   *  `onSaveAsNew`, or Cancel. */
  duplicate?: Pick<BankEntry, "title" | "organization"> | null;
  onSaveAsNew?: (draft: EntryDraft, skillIds: string[]) => void;
  /** The bank's skills, to link to this entry; omitted, no links show. */
  skills?: Skill[];
  /** The skills linked to this entry when the editor opens. */
  linkedSkillIds?: string[];
}) {
  const [draft, setDraft] = useState(initial);
  const [skillIds, setSkillIds] = useState(linkedSkillIds);
  const uid = useId();
  const section = sectionOf(draft.section);
  const set = (changes: Partial<EntryDraft>) => setDraft((d) => ({ ...d, ...changes }));
  const field = (name: string) => `${uid}-${name}`;

  function cleaned(): EntryDraft {
    return {
      ...draft,
      // An entry that runs to Present has no end month.
      end_month: draft.end_kind === "present" ? null : draft.end_month,
      bullets: draft.bullets.filter((b) => b.text.trim() !== ""),
    };
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave(cleaned(), skillIds);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 @lg/main:grid-cols-2">
        <TextField
          id={field("title")}
          label={section.title}
          required
          maxLength={200}
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
        />
        <TextField
          id={field("organization")}
          label={section.organization}
          maxLength={200}
          value={draft.organization ?? ""}
          onChange={(e) => set({ organization: text(e.target.value) })}
        />
        <TextField
          id={field("location")}
          label="Location"
          maxLength={200}
          placeholder="City, State"
          value={draft.location ?? ""}
          onChange={(e) => set({ location: text(e.target.value) })}
        />

        {draft.section === "awards" ? (
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
            {draft.end_kind && draft.end_kind !== "present" && (
              <MonthField
                id={field("end")}
                label={draft.end_kind === "expected" ? "Expected Month" : "End Month"}
                required
                value={draft.end_month}
                onChange={(end_month) => set({ end_month })}
              />
            )}
          </>
        )}

        {draft.section === "education" && (
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
            <ListField
              id={field("coursework")}
              label="Coursework"
              value={draft.coursework}
              onChange={(coursework) => set({ coursework })}
            />
            <TextField
              id={field("honors")}
              label="Honors"
              placeholder="Dean's List, cum laude"
              maxLength={500}
              value={draft.honors ?? ""}
              onChange={(e) => set({ honors: text(e.target.value) })}
            />
          </>
        )}
        {draft.section === "projects" && (
          <TextField
            id={field("link")}
            label="Link"
            type="url"
            placeholder="https://"
            maxLength={500}
            value={draft.link ?? ""}
            onChange={(e) => set({ link: text(e.target.value) })}
          />
        )}
        {draft.section === "certifications" && (
          <TextField
            id={field("issuer")}
            label="Issuer"
            maxLength={200}
            value={draft.issuer ?? ""}
            onChange={(e) => set({ issuer: text(e.target.value) })}
          />
        )}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={FIELD_LABEL}>Bullets</legend>
        {draft.bullets.map((bullet, i) => (
          <div key={bullet.id ?? `new-${i}`} className="flex items-center gap-2">
            <input
              aria-label={`Bullet ${i + 1}`}
              maxLength={500}
              className={cn(FIELD_CONTROL, "px-3.5 py-2.5")}
              value={bullet.text}
              onChange={(e) =>
                set({
                  bullets: draft.bullets.map((b, j) =>
                    j === i ? { ...b, text: e.target.value } : b,
                  ),
                })
              }
            />
            <IconButton
              label="Remove Bullet"
              tooltip="Remove this bullet"
              className="size-8"
              onClick={() => set({ bullets: draft.bullets.filter((_, j) => j !== i) })}
            >
              <X className="size-4" />
            </IconButton>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => set({ bullets: [...draft.bullets, { text: "" }] })}
          >
            <Plus className="size-3.5" /> Add Bullet
          </Button>
        </div>
      </fieldset>

      {skills && <SkillLinksField skills={skills} value={skillIds} onChange={setSkillIds} />}

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
          Cancel
        </Button>
        {duplicate && onSaveAsNew ? (
          <Button type="button" disabled={saving} onClick={() => onSaveAsNew(cleaned(), skillIds)}>
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
 *  the pattern and placeholder say what to type there. */
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
  );
}

/** Course names, typed separated by commas, kept as a list. */
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
    <TextField
      id={id}
      label={label}
      placeholder="Data Structures, Operating Systems"
      value={typed}
      onChange={(e) => {
        setTyped(e.target.value);
        onChange(
          e.target.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}
