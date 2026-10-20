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
import { downloadWordResume, renderResumePdf, type ResumeFile } from "@/lib/built-resume-actions";

type Format = "pdf" | "docx";

/** Opens a Storage link that downloads its file (its Content-Disposition). */
export function openDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  link.click();
}

/** Saves a file the API sent as base64, under its name. */
function saveFile({ data, contentType, fileName }: ResumeFile) {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // After the click has handed the file to the browser's download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * A built resume's download, PDF or Word, in the resume editor: it sat on
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
    if (format === "docx") {
      const { data, error } = await downloadWordResume(resumeId);
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
