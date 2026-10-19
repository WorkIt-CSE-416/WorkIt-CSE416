"use client";

import { FileDown } from "lucide-react";
import { useState } from "react";

import { ChevronDownIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Button } from "@/components/ui/button";
import { deleteSentResume, sendBuiltResume, type SentDownload } from "@/lib/sent-resume-actions";

type Format = "pdf" | "docx";

/** Opens a Storage link that downloads its file (its Content-Disposition). */
export function openDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  link.click();
}

/**
 * A built resume's download, PDF or Word, in the resume editor: it sat on
 * every row of the Resumes view until KAN-258, where it crowded each card.
 * Every download keeps a sent resume (KAN-208) and comes back as a Storage
 * link. A PDF whose text has characters the font cannot draw is held for
 * Download Anyway (user story 53); Cancel deletes the sent resume it just
 * made, so the kept sent resumes are only files the student took.
 */
export function useResumeDownload(resumeId: string) {
  const [busy, setBusy] = useState<Format | null>(null);
  const [held, setHeld] = useState<SentDownload | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(format: Format) {
    setBusy(format);
    setError(null);
    setHeld(null);
    const { data, error } = await sendBuiltResume(resumeId, format);
    setBusy(null);
    if (!data) return setError(error);
    // Only a PDF waits at the warning (user story 53).
    if (format === "pdf" && data.missing_characters.length) return setHeld(data);
    openDownload(data.url);
  }

  function keep() {
    if (!held) return;
    openDownload(held.url);
    setHeld(null);
  }

  // The student did not take the file: it was not sent.
  async function cancel() {
    if (!held) return;
    setHeld(null);
    if (!held.created) return;
    const { error } = await deleteSentResume(held.id);
    if (error) setError(error);
  }

  return { busy, held, error, pick, keep, cancel };
}

export type ResumeDownload = ReturnType<typeof useResumeDownload>;

/**
 * One Download for both files: PDF and Word were two buttons. While a file
 * is being made, the trigger says which one and takes no second pick.
 */
export function DownloadMenu({ download }: { download: ResumeDownload }) {
  const { busy, pick } = download;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={busy !== null}
        render={<Button variant="secondary" size="sm" />}
      >
        <FileDown />{" "}
        {busy === "pdf" ? "Making PDF…" : busy === "docx" ? "Making Word…" : "Download"}
        <ChevronDownIcon className="text-ink-meta" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => pick("pdf")}>PDF</DropdownMenuItem>
        <DropdownMenuItem onClick={() => pick("docx")}>Word</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What a download has to say: the missing-character warning, or the
 *  API's error. Nothing while there is neither. */
export function DownloadNotes({ download }: { download: ResumeDownload }) {
  const { held, error, keep, cancel } = download;
  return (
    <>
      {held && (
        <div role="alert" className="text-note text-ink-muted">
          <p>
            The PDF&apos;s font cannot show {held.missing_characters.join(" ")}. These characters
            will be missing from the PDF. Change them on the resume or in Experiences, or use the
            Word file.
          </p>
          <div className="mt-1.5 flex gap-3">
            <Button variant="ghost" size="inline" onClick={keep}>
              Download Anyway
            </Button>
            <Button variant="ghost" size="inline" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-note text-danger">
          {error}
        </p>
      )}
    </>
  );
}
