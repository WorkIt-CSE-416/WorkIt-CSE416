"use client";

import { FileArrowDownIcon } from "@phosphor-icons/react/ssr";
import { useEffect, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button } from "@/components/ui/button";
import { getResumeFileUrl } from "@/lib/resume-actions";
import { openDownload } from "@/lib/save-file";
import type { TailorSource } from "@/lib/tailor-actions";

import { loadPdfjs, PageSkeleton, PdfPages } from "../../../resumes/[resumeId]/pdf-pages";

/**
 * A resume shown in a dialog, read-only: Tailor's step 1 opens it from a
 * card's Preview button (`onPreview` on `ResumeLists`), so the student sees
 * what they are about to tailor without picking it, and the review step
 * opens it for View Original. It draws with the editor's `PdfPages` and no
 * click targets, as an upload's own page does. A DOCX cannot be drawn by
 * pdf.js, so it gets a note and Download, as its own page does.
 *
 * The PDF comes from /api/resume-preview (a built resume rendered, an
 * upload's file read), a route handler so a slow render never queues the
 * screen's server actions behind it. A built resume renders as it is now.
 *
 * Each answer is kept by its source while the dialog stays mounted, so a
 * resume shows only its own answer, however late an older one arrives, and
 * a resume opened again shows at once. A failed one says so in a line, with
 * Try Again. Step 1 held the preview as a column beside the list until the
 * list needed the width; a dialog also gives the page room to be read.
 */

type Preview = { pdf: string | null; error: string | null };

const keyOf = (source: TailorSource) =>
  "built_resume_id" in source
    ? `built=${encodeURIComponent(source.built_resume_id)}`
    : `uploaded=${encodeURIComponent(source.uploaded_resume_id)}`;

export function ResumePreviewDialog({
  open,
  onOpenChange,
  label,
  source,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The resume's name, the dialog's title. */
  label: string;
  source: TailorSource;
}) {
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  // Sources asked for and not yet answered, so one opened away and back
  // is not asked for twice.
  const asking = useRef(new Set<string>());
  const key = keyOf(source);
  const preview = previews[key];
  const have = preview !== undefined;

  useEffect(() => {
    if (!open || have || asking.current.has(key)) return;
    asking.current.add(key);
    // pdf.js downloads while the server draws the PDF, as in the editor.
    loadPdfjs().catch(() => {});
    const keep = (answer: Preview) => {
      asking.current.delete(key);
      setPreviews((all) => ({ ...all, [key]: answer }));
    };
    fetch(`/api/resume-preview?${key}`)
      .then(async (res) => {
        const body = (await res.json()) as Partial<Preview>;
        keep({
          pdf: body.pdf ?? null,
          error: res.ok ? null : (body.error ?? "The preview failed."),
        });
      })
      .catch(() => keep({ pdf: null, error: "Could not reach the server." }));
  }, [open, key, have]);

  function retry() {
    setPreviews((all) => {
      const rest = { ...all };
      delete rest[key];
      return rest;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Tall, so a page reads at once; its pages scroll under the title. */}
      <DialogContent className="flex h-[92vh] w-[92vw] max-w-none flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-subtitle pr-8 font-semibold break-words">
            {label}
          </DialogTitle>
          <DialogDescription className="sr-only">A preview of this resume.</DialogDescription>
        </DialogHeader>
        <div className="bg-canvas rounded-card min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {!preview ? (
            <PageSkeleton />
          ) : preview.error ? (
            <p role="alert" className="text-body text-danger">
              The preview could not be shown.{" "}
              <Button variant="link" onClick={retry}>
                Try Again
              </Button>
            </p>
          ) : preview.pdf ? (
            // Keyed by the source: PdfPages keeps its old document on screen
            // until a new one is read, which would show the last resume.
            <PdfPages
              key={key}
              pdf={preview.pdf}
              boxes={[]}
              selected={null}
              onSelect={() => {}}
              placeholder={<PageSkeleton />}
            />
          ) : (
            "uploaded_resume_id" in source && (
              <DocxNote id={source.uploaded_resume_id} label={label} />
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A DOCX upload: pdf.js cannot draw one, so its file downloads instead. */
function DocxNote({ id, label }: { id: string; label: string }) {
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setError(null);
    const { url, error } = await getResumeFileUrl(id, true);
    if (url) openDownload(url);
    else setError(error ?? "Could not download the resume.");
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-body text-ink-meta">
        WorkIt shows PDF resumes here. Download {label} to open it.
      </p>
      <Button variant="secondary" size="sm" onClick={download}>
        <FileArrowDownIcon aria-hidden className="size-4" /> Download
      </Button>
      {error && (
        <p role="alert" className="text-note text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
