"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useState, type FormEvent } from "react";

import { ChevronDownIcon, TrashIcon } from "@/components/icons";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
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
  { key: "start_date", label: "Start Date", type: "date" },
  { key: "end_date", label: "End Date", type: "date" },
];

/** Shared with the profile's single-entry editor (entry-dialog.tsx).
 *  `noun` is Title Case, for headings and buttons ("+ Add Experience");
 *  lowercase it inside a sentence-case label. */
export const SECTIONS: { key: SectionKey; title: string; noun: string; fields: Field[] }[] = [
  {
    key: "experience",
    title: "Work Experience",
    noun: "Experience",
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
    noun: "Education",
    fields: [
      { key: "institution", label: "Institution", required: true },
      { key: "degree", label: "Degree" },
      { key: "field_of_study", label: "Field of Study" },
      { key: "gpa", label: "GPA", type: "number" },
      ...DATES,
      { key: "description", label: "Description", type: "textarea" },
    ],
  },
  {
    key: "projects",
    title: "Projects",
    noun: "Project",
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
    noun: "Skill",
    fields: [
      { key: "skill_name", label: "Skill", required: true },
      { key: "category", label: "Category" },
    ],
  },
  {
    key: "certifications",
    title: "Certifications",
    noun: "Certification",
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

  // A panel sliding in from the right over a darkened page, rather than the
  // vendored centred dialog. Built from the dialog's parts: the vendored Sheet
  // bakes in a 10% overlay that a caller cannot darken. A click on that
  // darkened half does not close it — that would throw away every unsaved
  // edit, and in review the upload too; › and Escape still do.
  return (
    <Dialog open disablePointerDismissal onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogPortal>
        <DialogOverlay className="bg-black/40 supports-backdrop-filter:backdrop-blur-none" />
        <DialogPrimitive.Popup className="bg-panel data-open:animate-in data-open:slide-in-from-right fixed inset-y-0 right-0 z-50 flex w-full flex-col shadow-xl duration-300 ease-out outline-none sm:max-w-2xl">
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="border-border-subtle flex items-center gap-3 border-b px-5 py-3">
              <IconButton
                label="Close"
                variant="outline"
                className="size-8"
                disabled={saving}
                onClick={onCancel}
              >
                <ChevronDownIcon className="size-4 -rotate-90" />
              </IconButton>
              <DialogTitle className="text-title text-ink flex-1 font-bold">{title}</DialogTitle>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : saveLabel}
              </Button>
            </div>
            <DialogDescription className="bg-surface text-meta text-ink-meta px-5 py-2 text-center">
              {description}
            </DialogDescription>
            {error && (
              <p role="alert" className="text-meta text-danger px-5 pt-3">
                {error}
              </p>
            )}

            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
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
                              <h3 className="text-title text-ink sm:col-span-2">
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
                            label={`Remove ${noun.toLowerCase()} ${i + 1}`}
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
          </form>
        </DialogPrimitive.Popup>
      </DialogPortal>
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
          // "any", not 0.01: the parser keeps every decimal of a GPA ("3.856"),
          // and a value off the step blocks the whole form from submitting.
          step={field.type === "number" ? "any" : undefined}
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
