"use client";

import { Eye } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { openSentResume, type SentResumeFile } from "@/lib/sent-resume-actions";

/**
 * View Resume (KAN-267): the resume an application went out with, shown in
 * a dialog over the tracker, so looking at it never leaves the list. It is
 * rebuilt on the API, whichever kind it is: a built resume's snapshot is
 * rendered again and comes as the PDF itself (`data`); an uploaded resume's
 * file comes as a short-lived link signed to open in the browser; an upload
 * replaced or deleted since was rebuilt from its text (`rebuilt`), which the
 * dialog says, with Show Original Text for every word of the file. A Word
 * file cannot be shown in a browser, so the dialog sends the student to
 * Resumes & Experiences, where files download. Nothing downloads here.
 *
 * THE BUTTON NAMES THE RESUME and is a full sm button, so it is a big target
 * that reads as its own action, not as part of the row or card it sits on.
 * The callers keep a near miss from opening the application too (the list
 * cell, the card's strip), and a click inside the dialog stops at it.
 */
export function ViewResumeButton({
  resume,
  className,
}: {
  resume: { id: string; name: string; format: string };
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<SentResumeFile | null>(null);
  // What the frame shows: the signed link as it is, or the PDF's bytes as a
  // Blob URL, made when the file arrives and freed when this unmounts.
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  const word = resume.format === "docx";

  async function show() {
    setOpen(true);
    // A snapshot's PDF is kept for the next open; a stored file's link lasts
    // 5 minutes, so each open asks for a new one.
    if (word || (file && !file.url)) return;
    setError(null);
    const { data, error } = await openSentResume(resume.id);
    if (!data) return setError(error ?? "Could not open the resume.");
    setFile(data);
    setSrc(data.url ?? (data.data ? blobUrl(data.data, data.content_type) : null));
  }

  useEffect(() => {
    if (src?.startsWith("blob:")) return () => URL.revokeObjectURL(src);
  }, [src]);

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={show}
        title={`View ${resume.name}`}
        aria-label={`View resume ${resume.name}`}
        className={cn("max-w-full min-w-0", className)}
      >
        <Eye />
        <span className="truncate">{resume.name}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* React passes a click inside the dialog up to the row or card it
            was opened from, portal or not: stop it here, so reading the
            resume never opens the application. */}
        <DialogContent className="sm:max-w-3xl" onClick={(event) => event.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="text-subtitle truncate pr-8 font-semibold">
              {resume.name}
            </DialogTitle>
            <DialogDescription>The resume you sent with this application.</DialogDescription>
          </DialogHeader>
          {word ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-body text-ink-muted">
                A Word file cannot be shown here. Open it from Resumes &amp; Experiences.
              </p>
              <ButtonLink href="/resumes" variant="secondary">
                Go to Resumes
              </ButtonLink>
            </div>
          ) : error ? (
            <p role="alert" className="text-meta text-danger">
              {error}
            </p>
          ) : file == null ? (
            <p className="text-note text-ink-muted">Loading the resume…</p>
          ) : (
            <ResumeFile
              file={file}
              src={src}
              showText={showText}
              onToggleText={() => setShowText((s) => !s)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ResumeFile({
  file,
  src,
  showText,
  onToggleText,
}: {
  file: SentResumeFile;
  src: string | null;
  showText: boolean;
  onToggleText: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {file.rebuilt && (
        <div className="text-note text-ink-muted flex flex-wrap items-center gap-x-3 gap-y-1">
          <p>
            Rebuilt from your uploaded file. The layout and some sections may differ from what you
            sent.
          </p>
          {file.original_text && (
            <Button variant="ghost" size="inline" onClick={onToggleText}>
              {showText ? "Show the Resume" : "Show Original Text"}
            </Button>
          )}
        </div>
      )}
      {showText && file.original_text ? (
        <pre className="text-note text-ink bg-well rounded-card max-h-[70vh] overflow-auto p-4 font-sans whitespace-pre-wrap">
          {file.original_text}
        </pre>
      ) : (
        src && (
          <iframe
            src={src}
            title={file.file_name}
            className="border-border rounded-card h-[70vh] w-full border bg-white"
          />
        )
      )}
    </div>
  );
}

/** The PDF's bytes, from base64, as a URL the frame can show. */
function blobUrl(data: string, contentType: string) {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: contentType }));
}
