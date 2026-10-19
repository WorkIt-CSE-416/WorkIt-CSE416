"use client";

import { FileText, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PdfIcon } from "@/components/icons";
import { RESUME_ROW, ResumeRow } from "@/components/resume-row";
import { ResumeUpload } from "@/components/resume-upload";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { importResume, type ImportResponse } from "@/lib/bank-actions";
import { importSummary } from "@/lib/import-summary";
import { previewResume } from "@/lib/preview-resume";
import {
  deleteResume,
  getResumeFileUrl,
  renameResume,
  setPrimaryResume,
  uploadResume,
  type ResumeItem,
} from "@/lib/resume-actions";

import { RenameForm } from "./built-resume-row";
import { DeleteConfirm } from "./delete-confirm";
import { openDownload } from "./download-menu";
import { UpdateResumeDialog } from "./update-resume-dialog";

// The API's limit, on uploads alone: generated resumes count for nothing
// (KAN-268), so the count here matches the API's 409.
const MAX_RESUMES = 5;

/**
 * Your Uploaded Resumes (Your Resumes until KAN-268), the Resumes view's
 * first card: the files the student
 * uploaded, under an "n of 5" count of uploads alone: generated resumes
 * have counted for nothing since KAN-268. It was My Profile's Resume card until
 * 2026-10-18, beside a "Your Resumes" card of base resumes alone: one limit
 * split across two pages, and the star on each page cleared a star the
 * other page showed. Base resumes then shared this card until KAN-268,
 * when they moved to Generated Resumes (./built-resumes.tsx) on the same
 * page.
 *
 * Uploads are newest first. A click on the row previews the file; each
 * has Rename, Download (the stored file as it is: an upload keeps no sent
 * resume, since its file never changes), Import Updated Resume
 * (./update-resume-dialog.tsx) and Delete. Picking a file in the dropzone uploads it at
 * once; the API reads it into the experience bank (ADR 0003), and a note
 * under the dropzone says what went in, with Read It With AI while the
 * student has an AI reading left. The model never reads a resume unasked.
 *
 * Every change to either card's list calls `reload`, which reads both again: one
 * star spans both lists, and the API makes a student's only resume the
 * primary, so a local guess at the stars would drift from the API's.
 *
 * From @4xl the dropzone takes a narrow track beside the list; narrower it
 * stacks under the heading. The DOM stays heading, dropzone, list, so a
 * phone meets the dropzone before the rows.
 */
export function YourResumes({
  uploaded,
  reload,
}: {
  uploaded: ResumeItem[];
  reload: () => Promise<void>;
}) {
  // The name of the file in flight, or null.
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // What the last upload wrote into the experience bank.
  const [imported, setImported] = useState<ImportResponse | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  // The row whose Import Updated Resume dialog is open.
  const [updateTarget, setUpdateTarget] = useState<ResumeItem | null>(null);
  const count = uploaded.length;

  async function handleFile(file: File) {
    if (uploading !== null) return;
    if (count >= MAX_RESUMES) {
      setUploadError(`You can upload up to ${MAX_RESUMES} resumes. Delete one to upload another.`);
      return;
    }
    setUploadError(null);
    setImported(null);
    setUploading(file.name);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { resume, error } = await uploadResume(fd);
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

  // Read It With AI on the last upload: only ever on a click.
  async function handleReadWithAi(resumeId: string) {
    if (importingId) return;
    setUploadError(null);
    setImportingId(resumeId);
    try {
      const { data, error } = await importResume({ resumeId, readWithAi: true });
      if (data) setImported(data);
      else setUploadError(error);
    } catch {
      setUploadError("Could not import the resume. Refresh the page and try again.");
    } finally {
      setImportingId(null);
    }
  }

  // Import Updated Resume put a newer file on this row; the note under the
  // dropzone names the old file, so it goes if it was this row's.
  async function handleReplaced(updated: ResumeItem) {
    setImported((prev) => (prev?.resume_id === updated.id ? null : prev));
    await reload();
  }

  return (
    <Card
      as="section"
      aria-labelledby="resumes-yours"
      className="grid grid-cols-1 @4xl/main:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] @4xl/main:grid-rows-[auto_1fr] @4xl/main:gap-x-10"
    >
      <div>
        <div className="flex items-center justify-between gap-4">
          <h2 id="resumes-yours" className="text-subtitle text-ink">
            Your Uploaded Resumes
          </h2>
          <Badge variant="tag" pill>
            {count} of {MAX_RESUMES}
          </Badge>
        </div>
        <p className="text-note text-ink-meta mt-1">
          Upload a resume to add its experiences. You can upload up to {MAX_RESUMES}.
        </p>
      </div>

      <div className="mt-4 @4xl/main:col-start-2 @4xl/main:row-span-2 @4xl/main:row-start-1 @4xl/main:mt-0">
        <ResumeUpload
          file={null}
          onFileChange={handleFile}
          onRemove={() => {}}
          busy={uploading !== null}
        />
        {uploadError && (
          <p role="alert" className="text-meta text-danger mt-2">
            {uploadError}
          </p>
        )}
        {imported && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-note text-ink-muted min-w-0 flex-1" aria-live="polite">
              {importSummary(imported, imported.filename)}{" "}
              <Link href="/bank" className="text-brand hover:text-brand-hover underline">
                Open Experiences
              </Link>
            </p>
            {imported.uses_left > 0 && (
              <Button
                variant="secondary"
                size="sm"
                disabled={importingId !== null}
                onClick={() => handleReadWithAi(imported.resume_id)}
              >
                <Sparkles /> {importingId ? "Reading…" : "Read It With AI"}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="@4xl/main:mt-2">
        {/* Nothing to list holds the first row's place, in grey, and the
            first resume lands exactly where it stood. */}
        {uploaded.length === 0 && uploading === null ? (
          <div className={RESUME_ROW}>
            <FileText aria-hidden className="text-ink-faint size-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-label text-ink-muted truncate">No uploaded resumes yet</p>
              <p className="text-note text-ink-meta">Upload one to add its experiences.</p>
            </div>
          </div>
        ) : (
          <ul role="list" className="flex flex-col">
            {uploading !== null && (
              <li className={RESUME_ROW}>
                <PdfIcon className="size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-label text-ink truncate">{uploading}</p>
                  <p className="text-note text-ink-meta">Uploading…</p>
                </div>
              </li>
            )}
            {uploaded.map((resume) => (
              <UploadedRow
                key={`uploaded:${resume.id}`}
                resume={resume}
                reload={reload}
                onUpdate={() => setUpdateTarget(resume)}
              />
            ))}
          </ul>
        )}
      </div>

      {updateTarget && (
        <UpdateResumeDialog
          resume={updateTarget}
          open
          onOpenChange={(open) => !open && setUpdateTarget(null)}
          onReplaced={handleReplaced}
        />
      )}
    </Card>
  );
}

/** One uploaded resume: the shared row, or Rename's form in its place, its
 *  errors, and Delete's confirm under it, as a generated resume's row has. */
function UploadedRow({
  resume,
  reload,
  onUpdate,
}: {
  resume: ResumeItem;
  reload: () => Promise<void>;
  onUpdate: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  async function preview() {
    setError(null);
    // No await before this call: it opens the PDF's tab inside the click.
    setError(await previewResume(resume));
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

  // Delete stays disabled until the reload drops the row.
  async function remove() {
    setDeleting(true);
    setError(null);
    const { error } = await deleteResume(resume.id);
    if (!error) return reload();
    setDeleting(false);
    setError(error);
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
          deleting={deleting}
          onPreview={preview}
          onMakePrimary={makePrimary}
          onRename={() => setRenaming(true)}
          onDownload={download}
          onUpdate={onUpdate}
          onDelete={() => setConfirming(true)}
        />
      )}
      {confirming && (
        <DeleteConfirm
          label="Delete Resume"
          busy={deleting}
          onDelete={remove}
          onKeep={() => setConfirming(false)}
        >
          Delete this resume? Files you already sent are kept.
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
