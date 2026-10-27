"use client";

import Link from "next/link";
import { useRef, useState, type ChangeEvent } from "react";

import { PdfIcon, UploadIcon } from "@/components/icons";
import { RESUME_ROW, ResumeRow } from "@/components/resume-row";
import { RESUME_ACCEPT, resumeFileError } from "@/components/resume-upload";
import { Button } from "@/components/ui/button";
import { type ImportResponse } from "@/lib/bank-actions";
import { importSummary } from "@/lib/import-summary";
import { MAX_UPLOADS } from "@/lib/resume-limits";
import { openDownload } from "@/lib/save-file";
import {
  deleteResume,
  getResumeFileUrl,
  renameResume,
  setPrimaryResume,
  uploadResume,
  type ResumeItem,
} from "@/lib/resume-actions";

import { RenameForm } from "./built-resume-row";

// The API's limit, on uploads alone (lib/resume-limits.ts), so the count
// here matches the API's 409.
const MAX_RESUMES = MAX_UPLOADS;

/**
 * Upload Resume on the Resumes page (KAN-362): its button and file picker
 * for the filter row (./built-resumes.tsx), the file in flight for
 * the list's first card, and what the upload says back for the line under
 * the filter row. Only uploads count toward the limit of 5 (KAN-268); an
 * upload past it says so. It was the Your Uploaded Resumes card until
 * KAN-362 ("Your Resumes" until KAN-268, My Profile's Resume card until
 * 2026-10-18), with a dropzone in a track beside its list and an "n of 5"
 * badge; drag and drop onto the page went with the dropzone.
 *
 * The picked file uploads at once, with the dropzone's checks
 * (`resumeFileError`); the API reads it into the experience bank (ADR
 * 0003), and the note says what went in. The model never reads an upload:
 * Read It With AI sat beside the note until KAN-353.
 * A file whose text the student already uploaded keeps nothing and opens
 * the duplicate pop-up (`onDuplicate`, ./duplicate-resume-dialog.tsx,
 * KAN-267), the one Generate opens. A newer version of a file is a delete
 * and an upload: a row's Import Updated Resume did that in one step until
 * KAN-362; the bank ends the same either way (ADR 0005: a delete takes the
 * upload's entries with it, a replace swapped them).
 *
 * Every change calls `reload`, which reads both lists again: one star
 * spans every resume, and the API makes a student's only resume the
 * primary, so a local guess at the stars would drift from the API's.
 */
export function useResumeUpload({
  uploaded,
  reload,
  onDuplicate,
}: {
  uploaded: ResumeItem[];
  reload: () => Promise<void>;
  onDuplicate: (message: string | null) => void;
}) {
  // The name of the file in flight, or null.
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // What the last upload wrote into the experience bank.
  const [imported, setImported] = useState<ImportResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (uploading !== null) return;
    if (uploaded.length >= MAX_RESUMES) {
      setUploadError(`You can upload up to ${MAX_RESUMES} resumes. Delete one to upload another.`);
      return;
    }
    setUploadError(null);
    setImported(null);
    setUploading(file.name);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { resume, error, duplicateOf } = await uploadResume(fd);
      if (duplicateOf) return onDuplicate(error);
      if (error) return setUploadError(error);
      if (resume?.bank) {
        setImported({ ...resume.bank, resume_id: resume.id, filename: resume.original_filename });
      }
      await reload();
    } catch {
      setUploadError("Could not upload the resume. Refresh the page and try again.");
    } finally {
      setUploading(null);
    }
  }

  function handleSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const error = resumeFileError(file);
    if (error) return setUploadError(error);
    void handleFile(file);
  }

  // The note names a file; once that upload is deleted it goes.
  const shownImport =
    imported && uploaded.some((resume) => resume.id === imported.resume_id) ? imported : null;

  const button = (
    <>
      <Button
        variant="secondary"
        size="sm"
        disabled={uploading !== null}
        onClick={() => inputRef.current?.click()}
      >
        <UploadIcon className="size-4" />
        {uploading ? "Uploading…" : <ShortLabel verb="Upload" />}
      </Button>
      <input ref={inputRef} type="file" accept={RESUME_ACCEPT} onChange={handleSelect} hidden />
    </>
  );

  const notes = (uploadError || shownImport) && (
    <>
      {uploadError && (
        <p role="alert" className="text-note text-danger">
          {uploadError}
        </p>
      )}
      {shownImport && (
        <p className="text-note text-ink-muted" aria-live="polite">
          {importSummary(shownImport, shownImport.filename)}{" "}
          <Link href="/bank" className="text-brand hover:text-brand-hover underline">
            Open Experiences
          </Link>
        </p>
      )}
    </>
  );

  // The file in flight, as the list's first card.
  const pending = uploading !== null && (
    <li className={RESUME_ROW}>
      <PdfIcon className="size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-label text-ink truncate">{uploading}</p>
        <p className="text-note text-ink-meta">Uploading…</p>
      </div>
    </li>
  );

  return { button, notes, pending, uploading: uploading !== null };
}

/**
 * "Upload Resume" and "Generate Resume" (./built-resumes.tsx), which say
 * only the verb where their row is under 24rem (a phone's two even
 * buttons): there "Generate Resume" needed 161px of a 158px button and
 * broke onto two lines. "Resume" stays for screen readers, so the name
 * never changes.
 */
export function ShortLabel({ verb }: { verb: string }) {
  return (
    <span>
      {verb}
      <span className="sr-only @sm:not-sr-only"> Resume</span>
    </span>
  );
}

/** One uploaded resume: the shared row, or Rename's form in its place,
 *  and its errors under it, as a generated resume's row has
 *  (./built-resume-row.tsx). Delete asks in a popover under the trash. */
export function UploadedRow({
  resume,
  reload,
  onDelete,
}: {
  resume: ResumeItem;
  reload: () => Promise<void>;
  /** The list hides the row and sends the delete (KAN-388). */
  onDelete: (send: () => Promise<{ error: string | null }>) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = resume.original_filename ?? "Resume";

  // The form stays open until the list has the new name, so the old one
  // never flashes back.
  async function rename(next: string) {
    setSaving(true);
    setError(null);
    const { error } = await renameResume(resume.id, next);
    if (!error) await reload();
    setSaving(false);
    if (error) return setError(error);
    setRenaming(false);
  }

  async function download() {
    setError(null);
    const { url, error } = await getResumeFileUrl(resume.id, true);
    if (url) openDownload(url);
    else setError(error ?? "Could not download the resume.");
  }

  async function makePrimary() {
    setError(null);
    const { error } = await setPrimaryResume(resume.id);
    if (error) return setError(error);
    await reload();
  }

  // The row leaves the list at once, so the list runs the delete and
  // shows a failure (KAN-388).
  async function remove() {
    onDelete(() => deleteResume(resume.id));
  }

  return (
    <li>
      {renaming ? (
        <RenameForm
          id={resume.id}
          name={name}
          saving={saving}
          onSave={rename}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <ResumeRow
          resume={resume}
          href={`/resumes/uploaded/${encodeURIComponent(resume.id)}`}
          onMakePrimary={makePrimary}
          onRename={() => setRenaming(true)}
          onDownload={download}
          onDelete={remove}
        />
      )}
      {error && (
        <p role="alert" className="text-note text-danger mt-2">
          {error}
        </p>
      )}
    </li>
  );
}
