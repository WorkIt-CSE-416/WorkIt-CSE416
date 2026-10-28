"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { FileIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { RESUME_ACCEPT, resumeFileError } from "@/components/resume-upload";
import { SectionHeading } from "@/components/ui/section-heading";
import {
  deleteTranscript,
  getTranscript,
  uploadTranscript,
  type Transcript as TranscriptFile,
} from "@/lib/transcript-actions";

import { SectionAction } from "./section-action";

/**
 * Transcript (KAN-369): the student's unofficial transcript, one file.
 * Some forms require one; the autofiller attaches it to a form's
 * transcript upload, as it attaches the resume. Upload picks a PDF or
 * DOCX (the resume's checks); Replace picks a new one in its place;
 * Remove deletes it. WorkIt never reads its text.
 *
 * Each action shows its own progress (Replace reads "Saving…", Remove
 * "Removing…"), and both buttons wait while either runs. A transcript that
 * didn't load offers no Upload: one may already be saved.
 */
export function Transcript() {
  const [transcript, setTranscript] = useState<TranscriptFile | null>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [action, setAction] = useState<"upload" | "remove" | null>(null);
  const busy = action !== null;
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getTranscript()
      .then(({ transcript: t, error: err }) => {
        if (err) setStatus("error");
        else {
          setTranscript(t);
          setStatus("loaded");
        }
      })
      .catch(() => setStatus("error"));
  }, []);

  async function handleSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const refused = resumeFileError(file);
    if (refused) {
      setError(refused);
      return;
    }
    setAction("upload");
    setError(null);
    const body = new FormData();
    body.append("file", file);
    try {
      const { transcript: t, error: err } = await uploadTranscript(body);
      if (err || !t) setError(err ?? "WorkIt couldn't save it. Try again.");
      else setTranscript(t);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setAction(null);
    }
  }

  async function remove() {
    setAction("remove");
    setError(null);
    const { error: err } = await deleteTranscript().catch(() => ({
      error: "Could not reach the server.",
    }));
    if (err) setError(err);
    else setTranscript(null);
    setAction(null);
  }

  return (
    <section aria-labelledby="transcript-heading" className="border-border-subtle border-b py-6">
      <div className="flex items-baseline justify-between gap-4">
        <SectionHeading id="transcript-heading">Transcript</SectionHeading>
        {status === "loaded" && !transcript && (
          <SectionAction
            aria-label="Upload Transcript"
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            <UploadIcon />
            {action === "upload" ? "Uploading…" : "Upload"}
          </SectionAction>
        )}
      </div>
      <p className="text-body text-ink-meta mt-1">
        Your unofficial transcript, as a PDF or DOCX file. Some applications require one, and the
        autofiller attaches it for you.
      </p>

      {status === "error" && (
        <p role="status" className="text-meta text-ink-meta mt-4">
          Your transcript didn&apos;t load. Refresh the page to try again.
        </p>
      )}

      {transcript && (
        <div className="bg-panel border-border rounded-card mt-5 flex items-center gap-4 border p-4">
          <FileIcon className="text-ink-meta size-5 shrink-0" />
          <p className="text-body text-ink min-w-0 flex-1 truncate">
            {transcript.original_filename}
          </p>
          <SectionAction
            aria-label="Replace Transcript"
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            <UploadIcon />
            {action === "upload" ? "Saving…" : "Replace"}
          </SectionAction>
          <SectionAction aria-label="Remove Transcript" disabled={busy} onClick={remove}>
            <TrashIcon />
            {action === "remove" ? "Removing…" : "Remove"}
          </SectionAction>
        </div>
      )}
      {status === "loaded" && !transcript && (
        <p className="text-body text-ink-meta mt-4">No transcript yet.</p>
      )}
      {error && (
        <p role="alert" className="text-meta text-danger mt-4">
          {error}
        </p>
      )}
      <input ref={picker} type="file" accept={RESUME_ACCEPT} onChange={handleSelect} hidden />
    </section>
  );
}
