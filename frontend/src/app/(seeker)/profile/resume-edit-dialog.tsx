"use client";

import { useState, type FormEvent } from "react";

import { TrashIcon } from "@/components/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { FIELD_CONTROL, FIELD_LABEL, RequiredMark } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";
import type { ParsedResume } from "@/lib/resume-actions";

/**
 * Edits whole sections of a parsed resume in one modal. Two callers: right
 * after parsing, the profile opens it on every section so the applicant can
 * correct the parser before anything is saved (Cancel discards the upload);
 * and the Work Experience card opens it on that one section, so all roles are
 * edited together. Sections it is not showing pass through untouched.
 *
 * Every section is the same shape — a list of entries with a few fields — so
 * one table drives all five rather than five hand-written forms. Inputs hold
 * strings while editing; draftToEntry() turns blanks back into nulls and the
 * GPA into a number, which is what the API's Pydantic schema expects. Native
 * <input type="date"> rather than fields.tsx's Popover picker: that one lives
 * beside the job form, and a resume needs a dozen of them on one screen.
 */

export type SectionKey = keyof ParsedResume;
export type Field = {
  key: string;
  label: string;
  type?: "date" | "number" | "textarea";
  required?: boolean;
};
/** Only the sections on show have a draft. */
type Draft = Partial<Record<SectionKey, Record<string, string>[]>>;

export const EMPTY_RESUME: ParsedResume = {
  education: [],
  experience: [],
  skills: [],
  projects: [],
  certifications: [],
};

const DATES: Field[] = [
  { key: "start_date", label: "Start date", type: "date" },
  { key: "end_date", label: "End date", type: "date" },
];

/** Shared with the profile's single-entry editor (entry-dialog.tsx). */
export const SECTIONS: { key: SectionKey; title: string; noun: string; fields: Field[] }[] = [
  {
    key: "experience",
    title: "Work Experience",
    noun: "experience",
    fields: [
      { key: "title", label: "Title", required: true },
      { key: "company_name", label: "Company", required: true },
      { key: "location", label: "Location" },
      ...DATES,
      { key: "description", label: "Description", type: "textarea" },
    ],
  },
  {
    key: "education",
    title: "Education",
    noun: "education",
    fields: [
      { key: "institution", label: "Institution", required: true },
      { key: "degree", label: "Degree" },
      { key: "field_of_study", label: "Field of study" },
      { key: "gpa", label: "GPA", type: "number" },
      ...DATES,
      { key: "description", label: "Description", type: "textarea" },
    ],
  },
  {
    key: "projects",
    title: "Projects",
    noun: "project",
    fields: [
      { key: "project_name", label: "Name", required: true },
      { key: "url", label: "URL" },
      ...DATES,
      { key: "description", label: "Description", type: "textarea" },
    ],
  },
  {
    key: "skills",
    title: "Skills",
    noun: "skill",
    fields: [
      { key: "skill_name", label: "Skill", required: true },
      { key: "category", label: "Category" },
    ],
  },
  {
    key: "certifications",
    title: "Certifications",
    noun: "certification",
    fields: [
      { key: "cert_name", label: "Certification", required: true },
      { key: "issuer", label: "Issuer" },
    ],
  },
];

function blankEntry(fields: Field[]) {
  return Object.fromEntries(fields.map((f) => [f.key, ""]));
}

/** One parsed entry as editable strings; null (adding) gives blanks. */
export function entryToDraft(fields: Field[], entry: object | null): Record<string, string> {
  const values = (entry ?? {}) as Record<string, unknown>;
  return Object.fromEntries(fields.map((f) => [f.key, String(values[f.key] ?? "")]));
}

/** Back to the API's shape: blanks become null, numbers become numbers. */
export function draftToEntry(fields: Field[], draft: Record<string, string>) {
  return Object.fromEntries(
    fields.map((f) => {
      const value = draft[f.key].trim();
      if (!value) return [f.key, null];
      return [f.key, f.type === "number" ? Number(value) : value];
    }),
  );
}

type Section = (typeof SECTIONS)[number];

function toDraft(parsed: ParsedResume | null, shown: Section[]): Draft {
  return Object.fromEntries(
    shown.map(({ key, fields }) => [
      key,
      (parsed?.[key] ?? []).map((entry) => entryToDraft(fields, entry)),
    ]),
  );
}

function toParsed(draft: Draft, shown: Section[]): Partial<ParsedResume> {
  return Object.fromEntries(
    shown.map(({ key, fields }) => [key, (draft[key] ?? []).map((e) => draftToEntry(fields, e))]),
  );
}

type ResumeEditDialogProps = {
  title: string;
  description: string;
  /** Which sections to edit; all of them when omitted. */
  sections?: SectionKey[];
  parsed: ParsedResume | null;
  saveLabel?: string;
  /** Gets the whole resume back. Resolves to an error message, or null once saved. */
  onSave: (edited: ParsedResume) => Promise<string | null>;
  onCancel: () => void;
};

export function ResumeEditDialog({
  title,
  description,
  sections,
  parsed,
  saveLabel = "Save",
  onSave,
  onCancel,
}: ResumeEditDialogProps) {
  const shown = sections ? SECTIONS.filter((s) => sections.includes(s.key)) : SECTIONS;
  // A one-section dialog's own title already names its section.
  const headed = shown.length > 1;
  const [draft, setDraft] = useState(() => toDraft(parsed, shown));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(section: SectionKey, entries: Record<string, string>[]) {
    setDraft((prev) => ({ ...prev, [section]: entries }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      setError(await onSave({ ...EMPTY_RESUME, ...parsed, ...toParsed(draft, shown) }));
    } catch {
      setError("Could not save. Refresh the page and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-col gap-4">
          <div className="-mx-4 flex min-h-0 flex-col gap-6 overflow-y-auto px-4">
            {shown.map(({ key, title: heading, noun, fields }) => {
              const entries = draft[key] ?? [];
              return (
                <section key={key} aria-labelledby={headed ? `edit-${key}` : undefined}>
                  {/* Not <SectionHeading>: its fixed text-title would outrank the
                      dialog's own title. */}
                  <div className="flex items-baseline justify-between gap-4">
                    {headed && (
                      <h3 id={`edit-${key}`} className="text-subtitle text-ink">
                        {heading}
                      </h3>
                    )}
                    {/* New entries go first, right under the button that added
                        them — at the end they could land below the fold. */}
                    <Button
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => update(key, [blankEntry(fields), ...entries])}
                    >
                      + Add {noun}
                    </Button>
                  </div>

                  {entries.length === 0 && (
                    <p className="text-meta text-ink-meta mt-1">None yet.</p>
                  )}

                  <ol className="mt-2 flex flex-col gap-2">
                    {entries.map((entry, i) => (
                      <li
                        key={i}
                        className="border-border-subtle rounded-control flex items-start gap-2 border p-3"
                      >
                        <div className="grid flex-1 gap-2 sm:grid-cols-2">
                          {/* With no section headings to go by, long entries are
                              numbered instead: "Experience 1", "Experience 2". */}
                          {!headed && (
                            <h3 className="text-label text-ink font-medium capitalize sm:col-span-2">
                              {noun} {i + 1}
                            </h3>
                          )}
                          {fields.map((f) => (
                            <EntryField
                              key={f.key}
                              id={`edit-${key}-${i}-${f.key}`}
                              field={f}
                              value={entry[f.key]}
                              onChange={(value) =>
                                update(
                                  key,
                                  entries.map((e, j) => (j === i ? { ...e, [f.key]: value } : e)),
                                )
                              }
                            />
                          ))}
                        </div>
                        <IconButton
                          label={`Remove ${noun} ${i + 1}`}
                          onClick={() =>
                            update(
                              key,
                              entries.filter((_, j) => j !== i),
                            )
                          }
                        >
                          <TrashIcon className="size-4" />
                        </IconButton>
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })}
          </div>

          {error && <p className="text-meta text-red-600">{error}</p>}

          <DialogFooter>
            <Button variant="secondary" disabled={saving} onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : saveLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type EntryFieldProps = {
  id: string;
  field: Field;
  value: string;
  onChange: (value: string) => void;
};

export function EntryField({ id, field, value, onChange }: EntryFieldProps) {
  const common = {
    id,
    value,
    required: field.required,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
  };
  return (
    <div className={cn("flex flex-col gap-1", field.type === "textarea" && "sm:col-span-2")}>
      <label htmlFor={id} className={FIELD_LABEL}>
        {field.label}
        {field.required && <RequiredMark />}
      </label>
      {field.type === "textarea" ? (
        <textarea rows={3} className={cn(FIELD_CONTROL, "resize-y px-3 py-1.5")} {...common} />
      ) : (
        <input
          type={field.type ?? "text"}
          step={field.type === "number" ? "0.01" : undefined}
          min={field.type === "number" ? 0 : undefined}
          // Whitespace alone would pass `required`, then trim to null and 422
          pattern={field.required ? ".*\\S.*" : undefined}
          className={cn(FIELD_CONTROL, "px-3 py-1.5")}
          {...common}
        />
      )}
    </div>
  );
}
