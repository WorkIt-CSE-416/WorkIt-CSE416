"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { FileIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { RESUME_ACCEPT, resumeFileError } from "@/components/resume-upload";
import { Skeleton } from "@/components/shadcn/skeleton";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { useToast } from "@/components/ui/toast";
import {
  deleteTranscript,
  getTranscript,
  uploadTranscript,
  type Transcript as TranscriptFile,
} from "@/lib/transcript-actions";

import { SECTION_CARD } from "../../profile/field-styles";
import { SectionAction } from "../../profile/section-action";

/**
 * Transcript (KAN-369): the student's unofficial transcript, one file.
 * Some forms require one; the autofiller attaches it to a form's
 * transcript upload, as it attaches the resume. Upload picks a PDF or
 * DOCX (the resume's checks); Replace picks a new one in its place;
 * Remove deletes it. WorkIt never reads its text.
 *
 * **Remove waits on its toast** (KAN-562): the card drops the file at once
 * and a toast offers Undo, but the DELETE is sent only when the toast
 * closes without it (`onClose`). A deleted file can't come back, and the
 * page no longer holds it to upload again, so Undo is the DELETE never
 * sent. An upload while the toast shows sends the held DELETE first, as
 * one sent after it would remove the new file; a failed DELETE puts the
 * file back in the card and says why in a toast. Leaving the page sends it at once, so the card
 * never shows a file about to go; a tab closed in those seconds keeps it.
 *
 * Upload and Replace read "Uploading…" and "Saving…", and Replace and
 * Remove wait while one runs. A transcript that didn't load offers no
 * Upload: one may already be saved.
 */
export function Transcript() {
  const [transcript, setTranscript] = useState<TranscriptFile | null>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const toast = useToast();
  // The toast whose close sends the held DELETE; null once it is sent or taken back.
  const held = useRef<number | null>(null);

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

  // Leaving the page sends a held DELETE at once: back here, the card would show the file it removes.
  useEffect(
    () => () => {
      if (held.current !== null) toast.dismiss(held.current);
    },
    [toast],
  );

  async function handleSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const refused = resumeFileError(file);
    if (refused) {
      setError(refused);
      return;
    }
    setUploading(true);
    setError(null);
    if (held.current !== null) {
      // Sent now, before the upload: sent after it, it would remove the new file.
      const id = held.current;
      held.current = null;
      toast.dismiss(id);
      await deleteTranscript().catch(() => null);
    }
    const body = new FormData();
    body.append("file", file);
    try {
      const { transcript: t, error: err } = await uploadTranscript(body);
      if (err || !t) setError(err ?? "WorkIt couldn't save it. Try again.");
      else setTranscript(t);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  function remove() {
    const removed = transcript;
    if (!removed) return;
    setError(null);
    setTranscript(null);
    const id = toast.show({
      message: "Your transcript is removed.",
      action: {
        label: "Undo",
        onClick: () => {
          held.current = null;
          setTranscript(removed);
        },
      },
      onClose: () => {
        if (held.current !== id) return;
        held.current = null;
        void send(removed);
      },
    });
    held.current = id;
  }

  async function send(removed: TranscriptFile) {
    const { error: err } = await deleteTranscript().catch(() => ({
      error: "Could not reach the server.",
    }));
    if (!err) return;
    setTranscript(removed);
    toast.show({ message: `Your transcript wasn't removed. ${err}` });
  }

  return (
    <Card
      as="section"
      padding="none"
      id="section-transcript"
      aria-labelledby="transcript-heading"
      className={SECTION_CARD}
    >
      <div className="flex items-baseline justify-between gap-4">
        <SectionHeading id="transcript-heading">Transcript</SectionHeading>
        {status === "loaded" && !transcript && (
          <SectionAction
            aria-label="Upload Transcript"
            disabled={uploading}
            onClick={() => picker.current?.click()}
          >
            <UploadIcon />
            {uploading ? "Uploading…" : "Upload"}
          </SectionAction>
        )}
      </div>
      <p className="text-body text-ink-meta mt-1">
        Your unofficial transcript, as a PDF or DOCX file. Some applications require one, and the
        autofiller attaches it for you.
      </p>

      {/* The empty line's place while the read runs, so nothing below
          moves when it lands (KAN-561). */}
      {status === "loading" && (
        <div role="status" className="mt-4 flex h-5 items-center">
          <span className="sr-only">Loading your transcript</span>
          <Skeleton aria-hidden="true" className="h-3.5 w-40" />
        </div>
      )}
      {status === "error" && (
        <p role="status" className="text-note text-ink-meta mt-4">
          Your transcript didn&apos;t load. Refresh the page to try again.
        </p>
      )}

      {transcript && (
        <div className="bg-panel border-border-control rounded-card mt-5 flex items-center gap-4 border p-4">
          <FileIcon className="text-ink-meta size-5 shrink-0" />
          <p className="text-body text-ink min-w-0 flex-1 truncate">
            {transcript.original_filename}
          </p>
          <SectionAction
            aria-label="Replace Transcript"
            disabled={uploading}
            onClick={() => picker.current?.click()}
          >
            <UploadIcon />
            {uploading ? "Saving…" : "Replace"}
          </SectionAction>
          <SectionAction aria-label="Remove Transcript" disabled={uploading} onClick={remove}>
            <TrashIcon />
            Remove
          </SectionAction>
        </div>
      )}
      {status === "loaded" && !transcript && (
        <p className="text-body text-ink-meta mt-4">No transcript yet.</p>
      )}
      {error && (
        <p role="alert" className="text-note text-danger mt-4">
          {error}
        </p>
      )}
      <input ref={picker} type="file" accept={RESUME_ACCEPT} onChange={handleSelect} hidden />
    </Card>
  );
}
