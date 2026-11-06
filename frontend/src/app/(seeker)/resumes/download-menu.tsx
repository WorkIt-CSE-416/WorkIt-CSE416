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

import { FoldButton } from "./[resumeId]/bar-fold";

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

  /** Makes the file and saves it; true once the browser has it (false on a
   *  failure, or a PDF held at the font warning for Download Anyway). Tailor's
   *  Your Resume Is Ready moves its next step on it. */
  async function pick(format: Format): Promise<boolean> {
    setBusy(format);
    setError(null);
    setHeld(null);
    if (format !== "pdf") {
      const { data, error } = await downloadResumeFile(resumeId, format);
      setBusy(null);
      if (!data) {
        setError(error);
        return false;
      }
      saveFile(data);
      return true;
    }
    const { data, error } = await renderResumePdf(resumeId);
    setBusy(null);
    if (!data) {
      setError(error);
      return false;
    }
    const file = { data: data.pdf, contentType: "application/pdf", fileName: data.file_name };
    // Only a PDF waits at the warning (user story 53).
    if (data.missing_characters.length) {
      setHeld({ ...file, missing_characters: data.missing_characters });
      return false;
    }
    saveFile(file);
    return true;
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
 * is being made, the trigger says which one and takes no second pick. On
 * the editor's slim bar its word folds away as the bar narrows (`fold`,
 * ./[resumeId]/bar-fold.tsx), leaving the glyph and the caret.
 */
export function DownloadMenu({ download, fold }: { download: ResumeDownload; fold?: string }) {
  const { busy, pick } = download;
  const label = busy ? BUSY[busy] : "Download";
  const caret = <ChevronDownIcon className="text-ink-meta" />;
  return (
    <DropdownMenu>
      {fold ? (
        <FoldButton
          label={label}
          icon={<FileArrowDownIcon aria-hidden />}
          fold={fold}
          after={caret}
          disabled={busy !== null}
          render={
            <DropdownMenuTrigger
              disabled={busy !== null}
              render={<Button variant="secondary" size="sm" className="shrink-0" />}
            />
          }
        />
      ) : (
        <DropdownMenuTrigger
          disabled={busy !== null}
          render={<Button variant="secondary" size="sm" />}
        >
          <FileArrowDownIcon aria-hidden /> {label}
          {caret}
        </DropdownMenuTrigger>
      )}
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
