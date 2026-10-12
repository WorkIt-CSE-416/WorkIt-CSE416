"use client";

import { useState, type FormEvent } from "react";

import { SparkleIcon } from "@/components/icons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { FIELD_CONTROL, FIELD_LABEL, TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";
import { saveEntry, writeBullets, type EntryDraft, type Section } from "@/lib/experience-actions";

import { bulletHints } from "./hints";
import { INFO, SECTION_INFO } from "./sections";

/**
 * Adds or edits one Experience Bank entry. Its fields follow the section
 * (./sections.ts). Dates are months, as a resume prints them, kept as the 1st
 * of the month. Bullets are a textarea, one per line, each checked as typed
 * (./hints.ts). "Write Bullets With AI" sends only this entry's own words to
 * the model and shows what comes back for the applicant to use or ignore; it
 * never replaces their lines unasked.
 */

type Form = {
  section: Section;
  title: string;
  organization: string;
  location: string;
  start: string; // "YYYY-MM"
  end: string;
  current: boolean;
  bullets: string;
  fieldOfStudy: string;
  gpa: string;
  url: string;
  technologies: string;
};

const month = (iso: string | null) => (iso ? iso.slice(0, 7) : "");

function toForm(entry: EntryDraft | null, section: Section): Form {
  return {
    section: entry?.section ?? section,
    title: entry?.title ?? "",
    organization: entry?.organization ?? "",
    location: entry?.location ?? "",
    start: month(entry?.start_date ?? null),
    end: month(entry?.end_date ?? null),
    current: Boolean(entry?.start_date && !entry.end_date),
    bullets: (entry?.bullets ?? []).join("\n"),
    fieldOfStudy: entry?.details.field_of_study ?? "",
    gpa: entry?.details.gpa != null ? String(entry.details.gpa) : "",
    url: entry?.details.url ?? "",
    technologies: entry?.details.technologies ?? "",
  };
}

function toDraft(form: Form): EntryDraft {
  const info = INFO[form.section];
  const blank = (v: string) => v.trim() || null;
  return {
    section: form.section,
    title: form.title.trim(),
    organization: info.orgLabel ? blank(form.organization) : null,
    location: info.location ? blank(form.location) : null,
    start_date: info.dates === "range" && form.start ? `${form.start}-01` : null,
    end_date: form.end && !(info.dates === "range" && form.current) ? `${form.end}-01` : null,
    bullets: info.bullets
      ? form.bullets
          .split("\n")
          .map((b) => b.trim())
          .filter(Boolean)
      : [],
    details: {
      field_of_study: form.section === "education" ? blank(form.fieldOfStudy) : null,
      gpa: form.section === "education" && form.gpa.trim() ? Number(form.gpa) : null,
      url: form.section === "project" ? blank(form.url) : null,
      technologies: form.section === "project" ? blank(form.technologies) : null,
    },
  };
}

export function EntryEditor({
  open,
  onOpenChange,
  entry,
  id,
  section = "experience",
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null to add a new one */
  entry: EntryDraft | null;
  /** Set when editing a saved entry */
  id?: string;
  section?: Section;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => toForm(entry, section));
  const [notes, setNotes] = useState("");
  const [proposed, setProposed] = useState<string[] | null>(null);
  const [writing, setWriting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = INFO[form.section];
  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const lines = form.bullets.split("\n").filter((b) => b.trim());
  const wantsNumber = form.section === "experience" || form.section === "project";

  async function handleWrite() {
    if (!form.title.trim()) {
      setError(`Add the ${info.titleLabel.toLowerCase()} first.`);
      return;
    }
    setWriting(true);
    setError(null);
    const { data, error: err } = await writeBullets(toDraft(form), notes);
    setWriting(false);
    if (err != null) setError(err);
    else setProposed(data.bullets);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error: err } = await saveEntry(toDraft(form), id);
    setSaving(false);
    if (err != null) {
      setError(err);
      return;
    }
    onSaved();
    onOpenChange(false);
  }

  const field = (key: keyof Form, label: string, props: Record<string, unknown> = {}) => (
    <TextField
      id={`entry-${key}`}
      label={label}
      value={form[key] as string}
      onChange={(e) => set(key, e.target.value as never)}
      {...props}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-subtitle font-semibold">
            {id ? `Edit ${info.noun}` : `Add ${info.noun}`}
          </DialogTitle>
          <DialogDescription>
            Saved to your Experience Bank. Resumes you already made keep their own copy.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {!id && (
            <SelectField
              id="entry-section"
              label="Section"
              value={form.section}
              onValueChange={(v) => set("section", v as Section)}
              options={SECTION_INFO.map((s) => ({ value: s.key, label: s.title }))}
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("title", info.titleLabel, { required: true, maxLength: 200 })}
            {info.orgLabel && field("organization", info.orgLabel, { maxLength: 200 })}
            {form.section === "education" && field("fieldOfStudy", "Field of Study")}
            {form.section === "education" &&
              field("gpa", "GPA", { type: "number", step: "0.01", min: 0, max: 100 })}
            {form.section === "project" && field("technologies", "Technologies")}
            {form.section === "project" && field("url", "Link", { type: "url" })}
            {info.location && field("location", "Location", { maxLength: 100 })}
          </div>

          {info.dates === "range" ? (
            <div className="grid items-end gap-4 sm:grid-cols-3">
              {field("start", "Start", { type: "month" })}
              {field("end", "End", { type: "month", disabled: form.current })}
              <label className="text-label text-ink-muted flex cursor-pointer items-center gap-2 pb-2.5">
                <input
                  type="checkbox"
                  checked={form.current}
                  onChange={(e) => set("current", e.target.checked)}
                  className="accent-brand size-4"
                />
                I Still Do This
              </label>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              {field("end", "Date", { type: "month" })}
            </div>
          )}

          {info.bullets && (
            <div className="flex flex-col gap-1">
              <label htmlFor="entry-bullets" className={FIELD_LABEL}>
                Bullets
              </label>
              <textarea
                id="entry-bullets"
                rows={5}
                value={form.bullets}
                onChange={(e) => set("bullets", e.target.value)}
                placeholder="One per line: what you did, and what came of it"
                className={cn(FIELD_CONTROL, "px-3.5 py-2.5")}
              />
              {lines.map((line, i) => {
                const hints = bulletHints(line, wantsNumber);
                return hints.length ? (
                  <p key={i} className="text-meta text-ink-meta">
                    Line {i + 1}: {hints.join(" ")}
                  </p>
                ) : null;
              })}
            </div>
          )}

          {info.bullets && (
            <div className="bg-brand-tint/50 rounded-control flex flex-col gap-2 p-3">
              <label htmlFor="entry-notes" className={FIELD_LABEL}>
                What Did You Do? (Optional)
              </label>
              <textarea
                id="entry-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={2000}
                placeholder="In your own words. The writing help uses only what you say here and above."
                className={cn(FIELD_CONTROL, "px-3.5 py-2.5")}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleWrite}
                disabled={writing}
                className="self-start"
              >
                <SparkleIcon className="size-4" />
                {writing ? "Writing…" : "Write Bullets With AI"}
              </Button>
              {proposed && (
                <div className="flex flex-col gap-2">
                  <ul className="text-body text-ink-muted list-disc pl-5">
                    {proposed.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        set("bullets", proposed.join("\n"));
                        setProposed(null);
                      }}
                    >
                      Use These
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        set("bullets", [...lines, ...proposed].join("\n"));
                        setProposed(null);
                      }}
                    >
                      Add to Mine
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-meta text-danger">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
