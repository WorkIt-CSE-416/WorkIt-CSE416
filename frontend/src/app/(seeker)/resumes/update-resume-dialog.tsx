"use client";

import Link from "next/link";
import { useState } from "react";

import { SparkleIcon } from "@/components/icons";
import { ResumeUpload } from "@/components/resume-upload";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button } from "@/components/ui/button";
import { importResume, type ImportResponse } from "@/lib/bank-actions";
import { importSummary } from "@/lib/import-summary";
import { replaceResume, type ResumeItem } from "@/lib/resume-actions";

/**
 * Import Updated Resume, from an uploaded resume's row on the Resumes view. The stored file
 * never changes, so the student brings the newer version: it replaces the
 * row's file (same row, same primary star) and the API reads it into the
 * experience bank, merging what the bank has (ADR 0003). The dialog then
 * says what went in, the way an upload's note does, with Read It With AI
 * while a reading is left. A merge never removes an entry, so one the new
 * version dropped stays in Experiences until the student deletes it.
 *
 * The page mounts it only while open, so each opening starts at the
 * dropzone. It cannot close mid-upload: the result would have nowhere to show.
 * A file with another upload's text (KAN-267) replaces nothing: the page
 * closes this and opens the duplicate pop-up, as an upload does.
 */
export function UpdateResumeDialog({
  resume,
  open,
  onOpenChange,
  onReplaced,
  onDuplicate,
}: {
  resume: ResumeItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReplaced: (resume: ResumeItem) => void;
  /** "Duplicate Resume found: <name>", for the page's pop-up. */
  onDuplicate: (message: string) => void;
}) {
  const [busy, setBusy] = useState<"uploading" | "reading" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const name = resume.original_filename ?? "this resume";

  async function handleFile(file: File) {
    if (busy) return;
    setError(null);
    setBusy("uploading");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { resume: updated, error, duplicateOf } = await replaceResume(resume.id, fd);
      if (duplicateOf && error) return onDuplicate(error);
      if (!updated) return setError(error);
      onReplaced(updated);
      if (updated.bank) {
        setResult({ ...updated.bank, resume_id: updated.id, filename: updated.original_filename });
      }
    } catch {
      setError("Could not upload the resume. Refresh the page and try again.");
    } finally {
      setBusy(null);
    }
  }

  // Only ever on a click (KAN-222).
  async function readWithAi() {
    if (busy || !result) return;
    setError(null);
    setBusy("reading");
    try {
      const { data, error } = await importResume({ resumeId: result.resume_id, readWithAi: true });
      if (data) setResult(data);
      else setError(error);
    } catch {
      setError("Could not import the resume. Refresh the page and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-subtitle font-semibold">Import Updated Resume</DialogTitle>
          <DialogDescription>
            {result ? (
              "Your resume is updated. Experiences keeps what it had and adds what is new."
            ) : (
              <>
                Upload the newer version of{" "}
                <span className="text-ink font-medium wrap-anywhere">{name}</span>. It replaces this
                file, and what is new goes into Experiences.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <p className="text-body text-ink-muted" aria-live="polite">
            {importSummary(result, result.filename)}{" "}
            <Link href="/bank" className="text-brand hover:text-brand-hover underline">
              Open Experiences
            </Link>
          </p>
        ) : (
          <ResumeUpload
            file={null}
            onFileChange={handleFile}
            onRemove={() => {}}
            busy={busy === "uploading"}
          />
        )}

        {error && (
          <p role="alert" className="text-meta text-danger">
            {error}
          </p>
        )}

        {result && (
          <DialogFooter>
            {result.uses_left > 0 && (
              <Button variant="secondary" disabled={busy !== null} onClick={readWithAi}>
                <SparkleIcon /> {busy === "reading" ? "Reading…" : "Read It With AI"}
              </Button>
            )}
            <Button disabled={busy !== null} onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
