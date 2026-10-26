"use client";

import { FileArrowDownIcon } from "@phosphor-icons/react/ssr";
import { useState } from "react";

import { ChevronDownIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Button } from "@/components/ui/button";
import { downloadResumeFile, renderResumePdf, type ResumeFile } from "@/lib/built-resume-actions";

import { saveFile } from "@/lib/save-file";

type Format = "pdf" | "docx" | "tex";

/**
 * A built resume's download, PDF, Word or LaTeX, in the resume editor: it sat on
 * every row of the Resumes view until KAN-258, where it crowded each card.
 * A download keeps nothing (KAN-267): the API renders the file and the
 * browser saves it. Every download was kept as a sent resume until then,
 * which filled Storage with files no employer saw; Apply keeps what is
 * sent (`applyWithResume`). A PDF whose text has characters the font cannot
 * draw is held for Download Anyway (user story 53); Cancel drops it.
 */
export function useResumeDownload(resumeId: string) {
  const [busy, setBusy] = useState<Format | null>(null);
  const [held, setHeld] = useState<(ResumeFile & { missing_characters: string[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(format: Format) {
    setBusy(format);
    setError(null);
    setHeld(null);
    if (format !== "pdf") {
      const { data, error } = await downloadResumeFile(resumeId, format);
      setBusy(null);
      return data ? saveFile(data) : setError(error);
    }
    const { data, error } = await renderResumePdf(resumeId);
    setBusy(null);
    if (!data) return setError(error);
    const file = { data: data.pdf, contentType: "application/pdf", fileName: data.file_name };
    // Only a PDF waits at the warning (user story 53).
    if (data.missing_characters.length) {
      return setHeld({ ...file, missing_characters: data.missing_characters });
    }
    saveFile(file);
  }

  function keep() {
    if (!held) return;
    saveFile(held);
    setHeld(null);
  }

  function cancel() {
    setHeld(null);
  }

  return { busy, held, error, pick, keep, cancel };
}

export type ResumeDownload = ReturnType<typeof useResumeDownload>;

const BUSY: Record<Format, string> = {
  pdf: "Making PDF…",
  docx: "Making Word…",
  tex: "Making LaTeX…",
};

/**
 * One Download for every file: PDF and Word were two buttons. LaTeX is the
 * PDF's own source, for a student who edits it in Overleaf. While a file
 * is being made, the trigger says which one and takes no second pick.
 */
export function DownloadMenu({ download }: { download: ResumeDownload }) {
  const { busy, pick } = download;
  const label = busy ? BUSY[busy] : "Download";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={busy !== null}
        render={<Button variant="secondary" size="sm" />}
      >
        <FileArrowDownIcon aria-hidden /> {label}
        <ChevronDownIcon className="text-ink-meta" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => pick("pdf")}>PDF</DropdownMenuItem>
        <DropdownMenuItem onClick={() => pick("docx")}>Word</DropdownMenuItem>
        <DropdownMenuItem onClick={() => pick("tex")}>LaTeX</DropdownMenuItem>
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
