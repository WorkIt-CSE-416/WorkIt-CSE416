"use client";

import { EyeIcon } from "@phosphor-icons/react/ssr";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { PdfIcon } from "@/components/icons";
import { RESUME_ROW } from "@/components/resume-row";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { openSentResume, type SentResume, type SentResumeFile } from "@/lib/sent-resume-actions";

import { LocalDate } from "../local-time";
import { STAGE_COLOR, STAGE_LABEL } from "../stage-colors";

type Viewed = { id: string; name: string; format: string };

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
export function ViewResumeButton({ resume, className }: { resume: Viewed; className?: string }) {
  const viewer = useResumeViewer(resume);
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={viewer.show}
        title={`View ${resume.name}`}
        aria-label={`View resume ${resume.name}`}
        className={cn("max-w-full min-w-0", className)}
      >
        <EyeIcon aria-hidden />
        <span className="truncate">{resume.name}</span>
      </Button>
      {viewer.dialog}
    </>
  );
}

/**
 * One sent resume on an application's own page (What You Sent, KAN-317),
 * drawn in the Resumes view's row box (`RESUME_ROW`) with its file mark,
 * so a resume looks the same wherever it is listed. It opens View Resume's
 * dialog, not the editor or the file: what was sent is the snapshot, which
 * may differ from the resume today. The whole row is one target, as on
 * Resumes: the name's button stretches over it and the row lifts under the
 * pointer (`docs/motion.md`). The day line says when it was sent and its
 * kind. The one the application names (KAN-267) wears the Applied status
 * badge, the list's own (`STAGE_COLOR`), so the stage reads the same
 * everywhere; a green Applied With was one more badge style.
 */
export function SentResumeRow({
  resume,
  appliedWith,
}: {
  resume: SentResume;
  appliedWith: boolean;
}) {
  const viewer = useResumeViewer(resume);
  return (
    <li>
      <div
        className={cn(
          "group relative",
          RESUME_ROW,
          "hover:border-brand/40 hover:shadow-lift ease-glide transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]",
        )}
      >
        <PdfIcon className="size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            aria-label={`View resume ${resume.name}`}
            onClick={viewer.show}
            className="text-label text-ink after:rounded-control focus-visible:after:ring-brand-ring block w-full cursor-pointer truncate text-left after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2"
          >
            {resume.name}
          </button>
          <p className="text-note text-ink-meta">
            Sent <LocalDate at={resume.created_at} /> · {resume.format.toUpperCase()}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pr-1">
          {resume.rebuilt && <Badge tone="inert">Rebuilt</Badge>}
          {appliedWith && <Badge tone={STAGE_COLOR.applied.tone}>{STAGE_LABEL.applied}</Badge>}
        </div>
      </div>
      {viewer.dialog}
    </li>
  );
}

/** View Resume's dialog and what opens it, for a button or a row. */
function useResumeViewer(resume: Viewed) {
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

  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* React passes a click inside the dialog up to the row or card it
            was opened from, portal or not: stop it here, so reading the
            resume never opens the application. */}
      {/* 92% of the window each way, whatever its size (vw and vh follow
            a resize): a resume needs the room. A fixed width left it a
            narrow strip on a wide screen, and 80% still looked squished. A flex column, so the frame takes
            whatever the title leaves. */}
      <DialogContent
        className="flex h-[92vh] w-[92vw] max-w-none flex-col sm:max-w-none"
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="text-subtitle truncate pr-8 font-semibold">
            {resume.name}
          </DialogTitle>
          {/* The title says which resume; a visible line saying it was sent
                repeated the page around it. Kept for screen readers, which
                announce a dialog by its description. */}
          <DialogDescription className="sr-only">
            The resume you sent with this application.
          </DialogDescription>
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
  );
  return { show, dialog };
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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
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
        <pre className="text-note text-ink bg-well rounded-card min-h-0 flex-1 overflow-auto p-4 font-sans whitespace-pre-wrap">
          {file.original_text}
        </pre>
      ) : (
        src && (
          <iframe
            src={src}
            title={file.file_name}
            className="border-border rounded-card min-h-0 w-full flex-1 border bg-white"
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
