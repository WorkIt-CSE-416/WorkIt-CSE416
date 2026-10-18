"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { PdfIcon, PencilIcon, TrashIcon } from "@/components/icons";
import { PrimaryStar, RESUME_ROW, ROW_ACTION } from "@/components/resume-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { TextField } from "@/components/ui/text-field";
import {
  deleteBuiltResume,
  generateResume,
  listBuiltResumes,
  renameBuiltResume,
  setDefaultBuiltResume,
  type BuiltResume,
} from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";
import type { SentResume } from "@/lib/sent-resume-actions";

import { LocalDate } from "../local-time";
import { DeleteConfirm } from "./delete-confirm";
import { ResumesHeader } from "./header";
import { SentResumes } from "./sent-resumes";

/**
 * The Resumes view of Resumes & Experiences: its header, with Generate
 * Resume beside the switcher, then the cards: Your Resumes, the base
 * resumes (KAN-207), Tailored Resumes when there is one (KAN-217), and
 * Sent (KAN-208). The header is drawn here because Generate changes this
 * component's list. Generate makes a base resume from the whole bank in
 * Jake's Resume, named "Resume #N" by the API until the student renames it.
 * The 5-resume limit is the API's: its refusal shows as the error.
 *
 * Each resume is a card drawn as My Profile's resume rows are
 * (`components/resume-row.tsx`), and the whole card opens the resume
 * editor, which downloads it as a PDF or a Word file (KAN-258). Open and
 * Download were buttons on every row until then.
 */
export function BuiltResumes({
  initial,
  initialSent,
}: {
  initial: BuiltResume[];
  initialSent: SentResume[];
}) {
  const [resumes, setResumes] = useState(initial);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const { data, error } = await listBuiltResumes();
    if (data) setResumes(data);
    if (error) setError(error);
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    const { error } = await generateResume();
    setGenerating(false);
    if (error) return setError(error);
    await reload();
  }

  // A tailored resume is made for one posting, so it has a card of its own
  // (KAN-258). Under the base resumes' card, then "Base Resumes", it was
  // told apart only by a Tailored tag and sat under a name it does not have.
  const base = resumes.filter((resume) => !resume.job_posting_id);
  const tailored = resumes.filter((resume) => resume.job_posting_id);

  return (
    <>
      {/* The view's primary action sits beside the switcher, as Fill With
          Scout does on Experiences; it was the base resumes' card's own. */}
      <ResumesHeader
        view="resumes"
        action={
          <Button size="sm" onClick={generate} disabled={generating}>
            <FileText /> {generating ? "Generating…" : "Generate Resume"}
          </Button>
        }
      />
      <div className="mt-4 flex flex-col gap-4">
        {/* "Your Resumes" and Experiences, not "Base Resumes" and "your
            bank": the words a student sees on these two views (KAN-258). */}
        <ResumeCard
          id="resumes-base"
          title="Your Resumes"
          description="Open one to edit it or download it. A change in Experiences shows on every resume."
          error={error}
          empty
          resumes={base}
          reload={reload}
        />
        {tailored.length > 0 && (
          <ResumeCard
            id="resumes-tailored"
            title="Tailored Resumes"
            description="Made for one job posting, with Tailor My Resume on its page."
            resumes={tailored}
            reload={reload}
          />
        )}
        <SentResumes initial={initialSent} />
      </div>
    </>
  );
}

/** A card of resumes, Your Resumes or Tailored Resumes: both draw their
 *  resumes the same way. */
function ResumeCard({
  id,
  title,
  description,
  error = null,
  empty = false,
  resumes,
  reload,
}: {
  id: string;
  title: string;
  description: string;
  /** Generate's or a reload's, so Your Resumes shows it. */
  error?: string | null;
  /** Whether an empty card says so, in the box a resume takes, as My
   *  Profile's list does. Tailored Resumes shows only once it has one. */
  empty?: boolean;
  resumes: BuiltResume[];
  reload: () => Promise<void>;
}) {
  return (
    <Card as="section" aria-labelledby={id}>
      <h2 id={id} className="text-subtitle text-ink">
        {title}
      </h2>
      <p className="text-note text-ink-meta mt-1">{description}</p>
      {error && (
        <p role="alert" className="text-note text-danger mt-2">
          {error}
        </p>
      )}
      {resumes.length === 0 ? (
        empty && (
          <div className={RESUME_ROW}>
            <FileText aria-hidden className="text-ink-faint size-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-label text-ink-muted truncate">No resumes yet</p>
              <p className="text-note text-ink-meta">
                Generate Resume makes one from your experiences.
              </p>
            </div>
          </div>
        )
      ) : (
        <ul role="list" className="flex flex-col">
          {resumes.map((resume) => (
            <ResumeRow key={resume.id} resume={resume} reload={reload} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * One resume, drawn as My Profile's resume rows are: the file mark, the
 * name and its day, then the star, Rename and Delete. The whole card is
 * one target: the name's link stretches over it (`after:inset-0`), the
 * icons sit above that, and the card lifts under the pointer as every
 * whole-target card does (`docs/motion.md`).
 */
function ResumeRow({ resume, reload }: { resume: BuiltResume; reload: () => Promise<void> }) {
  const [renaming, setRenaming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function makePrimary() {
    setError(null);
    const { error } = await setDefaultBuiltResume(resume.id);
    if (error) return setError(error);
    await reload();
  }

  // The form stays open until the list has the new name, so the old one
  // never flashes back.
  async function rename(name: string) {
    setSaving(true);
    setError(null);
    const { error } = await renameBuiltResume(resume.id, name);
    if (!error) await reload();
    setSaving(false);
    if (error) return setError(error);
    setRenaming(false);
  }

  // Delete stays disabled until the reload drops the row.
  async function remove() {
    setDeleting(true);
    setError(null);
    const { error } = await deleteBuiltResume(resume.id);
    if (!error) return reload();
    setDeleting(false);
    setError(error);
  }

  // The API sends edited_at equal to created_at until the first change.
  const edited = Date.parse(resume.edited_at) > Date.parse(resume.created_at);

  return (
    <li>
      {renaming ? (
        <RenameForm
          id={resume.id}
          name={resume.name}
          saving={saving}
          onSave={rename}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <div
          className={cn(
            "group relative",
            RESUME_ROW,
            "hover:border-brand/40 hover:shadow-lift ease-glide transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]",
          )}
        >
          <PdfIcon className="size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <Link
              href={`/resumes/${encodeURIComponent(resume.id)}`}
              className="text-label text-ink after:rounded-control focus-visible:after:ring-brand-ring block truncate after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2"
            >
              {resume.name}
            </Link>
            {/* One day: when it was last edited, or made until the first edit.
                Both together said one day twice for a resume edited the day
                it was made, and the made day mattered less. */}
            <p className="text-note text-ink-meta">
              {edited ? "Last edited" : "Made"}{" "}
              <LocalDate at={edited ? resume.edited_at : resume.created_at} />
            </p>
          </div>
          {/* Story 90: the resume still opens and downloads; only Tailor needs a live posting. */}
          {resume.posting_closed && <Badge tone="inert">Posting Closed</Badge>}
          {/* Above the stretched link, so a press on an icon is the icon's. */}
          <div className="relative z-10 flex shrink-0 items-center">
            {/* Only a base resume can be the primary (the API refuses a tailored one). */}
            {!resume.job_posting_id && (
              <PrimaryStar
                name={resume.name}
                primary={resume.is_default}
                onMakePrimary={makePrimary}
              />
            )}
            <IconButton
              label={`Rename ${resume.name}`}
              tooltip="Rename"
              className={ROW_ACTION}
              onClick={() => setRenaming(true)}
            >
              <PencilIcon className="size-4" />
            </IconButton>
            <IconButton
              label={`Delete ${resume.name}`}
              tooltip="Delete"
              className={cn(ROW_ACTION, "hover:text-danger")}
              onClick={() => setConfirming(true)}
            >
              <TrashIcon className="size-4" />
            </IconButton>
          </div>
        </div>
      )}
      {confirming && (
        <DeleteConfirm
          label="Delete Resume"
          busy={deleting}
          onDelete={remove}
          onKeep={() => setConfirming(false)}
        >
          Delete this resume? Files you already sent stay in Sent.
        </DeleteConfirm>
      )}
      {error && (
        <p role="alert" className="text-note text-danger mt-2">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * The resume's name, open for typing (KAN-258): Rename turns the card into
 * this form, as Edit opens a bank entry in place, with the bank's form
 * buttons at a field's height. A name left as it was closes the form with
 * no call; Escape or Cancel keeps the name.
 */
function RenameForm({
  id,
  name,
  saving,
  onSave,
  onCancel,
}: {
  id: string;
  name: string;
  saving: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const trimmed = draft.trim();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (trimmed === name) return onCancel();
    onSave(trimmed);
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1 basis-56">
        <TextField
          id={`resume-name-${id}`}
          label="Resume Name"
          required
          autoFocus
          maxLength={80}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancel();
          }}
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !trimmed}>
          {saving ? "Saving…" : "Save Name"}
        </Button>
      </div>
    </form>
  );
}
