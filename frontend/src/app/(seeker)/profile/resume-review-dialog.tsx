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
 * Shown between parsing a resume and saving it: the applicant corrects what
 * the parser got wrong, and only Save writes anything. Cancel (or closing the
 * dialog) discards the upload entirely.
 *
 * Every section is the same shape — a list of entries with a few fields — so
 * one table drives all five rather than five hand-written forms. Inputs hold
 * strings while editing; toParsed() turns blanks back into nulls and the GPA
 * into a number, which is what the API's Pydantic schema expects. Native
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
type Draft = Record<SectionKey, Record<string, string>[]>;

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

function toDraft(parsed: ParsedResume | null): Draft {
  return Object.fromEntries(
    SECTIONS.map(({ key, fields }) => [
      key,
      (parsed?.[key] ?? []).map((entry) => entryToDraft(fields, entry)),
    ]),
  ) as Draft;
}

function toParsed(draft: Draft): ParsedResume {
  return Object.fromEntries(
    SECTIONS.map(({ key, fields }) => [key, draft[key].map((e) => draftToEntry(fields, e))]),
  ) as ParsedResume;
}

type ResumeReviewDialogProps = {
  fileName: string;
  parsed: ParsedResume | null;
  /** Resolves to an error message, or null once saved. */
  onSave: (edited: ParsedResume) => Promise<string | null>;
  onCancel: () => void;
};

export function ResumeReviewDialog({
  fileName,
  parsed,
  onSave,
  onCancel,
}: ResumeReviewDialogProps) {
  const [draft, setDraft] = useState(() => toDraft(parsed));
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
      setError(await onSave(toParsed(draft)));
    } catch {
      setError("Could not save the resume. Refresh the page and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review your resume</DialogTitle>
          <DialogDescription>
            {parsed
              ? `Check what we read from ${fileName} and fix anything we got wrong before saving.`
              : `We couldn't read any sections from ${fileName}. Add them below, or save it as is.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-col gap-4">
          <div className="-mx-4 flex min-h-0 flex-col gap-6 overflow-y-auto px-4">
            {SECTIONS.map(({ key, title, fields }) => (
              <section key={key} aria-labelledby={`review-${key}`}>
                {/* Not <SectionHeading>: its fixed text-title would outrank the
                    dialog's own title. */}
                <div className="flex items-baseline justify-between gap-4">
                  <h3 id={`review-${key}`} className="text-subtitle text-ink">
                    {title}
                  </h3>
                  <Button
                    variant="ghost"
                    onClick={() => update(key, [...draft[key], blankEntry(fields)])}
                  >
                    + Add
                  </Button>
                </div>

                {draft[key].length === 0 && (
                  <p className="text-meta text-ink-meta mt-1">None found.</p>
                )}

                <ol className="mt-2 flex flex-col gap-2">
                  {draft[key].map((entry, i) => (
                    <li
                      key={i}
                      className="border-border-subtle rounded-control flex items-start gap-2 border p-3"
                    >
                      <div className="grid flex-1 gap-2 sm:grid-cols-2">
                        {fields.map((f) => (
                          <EntryField
                            key={f.key}
                            id={`review-${key}-${i}-${f.key}`}
                            field={f}
                            value={entry[f.key]}
                            onChange={(value) =>
                              update(
                                key,
                                draft[key].map((e, j) => (j === i ? { ...e, [f.key]: value } : e)),
                              )
                            }
                          />
                        ))}
                      </div>
                      <IconButton
                        label={`Remove ${title.toLowerCase()} entry`}
                        onClick={() =>
                          update(
                            key,
                            draft[key].filter((_, j) => j !== i),
                          )
                        }
                      >
                        <TrashIcon className="size-4" />
                      </IconButton>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>

          {error && <p className="text-meta text-red-600">{error}</p>}

          <DialogFooter>
            <Button variant="secondary" disabled={saving} onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save resume"}
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
