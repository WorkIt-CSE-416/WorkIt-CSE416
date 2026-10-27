"use client";

import { ClockCounterClockwiseIcon, FileArrowDownIcon } from "@phosphor-icons/react/ssr";
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
 * A resume shown read-only: in a dialog for Tailor's step 1, which opens
 * it from a card's Preview button (`onPreview` on `ResumeLists`), so the
 * student sees what they are about to tailor without picking it; and
 * inline on the review step, where the toolbar's View Original sets the
 * source resume beside the tailored one (`OriginalResume`). It draws with
 * the editor's `PdfPages` and no click targets, as an upload's own page
 * does. A DOCX cannot be drawn by pdf.js, so it gets a note and Download,
 * as its own page does.
 *
 * The PDF comes from /api/resume-preview (a built resume rendered, an
 * upload's file read), a route handler so a slow render never queues the
 * screen's server actions behind it. A built resume renders as it is now.
 *
 * Each answer is kept by its source for the page's life (`answered`), so a
 * resume shows only its own answer, however late an older one arrives, and
 * a resume opened again shows at once. A caller that knows when the
 * resume last changed passes it as `version` (the Resumes page's eye,
 * KAN-358), so an answer from before an edit is not shown after it. A failed one says so in a line, with
 * Try Again. Step 1 held the preview as a column beside the list until the
 * list needed the width; a dialog also gives the page room to be read.
 */

type Preview = { pdf: string | null; error: string | null };

const keyOf = (source: TailorSource) =>
  "built_resume_id" in source
    ? `built=${encodeURIComponent(source.built_resume_id)}`
    : `uploaded=${encodeURIComponent(source.uploaded_resume_id)}`;

/** Answers that drew, kept across the dialog's and the pane's mounts. */
const answered = new Map<string, Preview>();

/** The source's preview, asked for once `enabled`, and a retry for a
 *  failed one. */
function useResumePreview(source: TailorSource, enabled: boolean, version?: string) {
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  // Sources asked for and not yet answered, so one opened away and back
  // is not asked for twice.
  const asking = useRef(new Set<string>());
  const query = keyOf(source);
  const key = version ? `${query}@${version}` : query;
  const preview = previews[key] ?? answered.get(key);
  const have = preview !== undefined;

  useEffect(() => {
    if (!enabled || have || asking.current.has(key)) return;
    asking.current.add(key);
    // pdf.js downloads while the server draws the PDF, as in the editor.
    loadPdfjs().catch(() => {});
    const keep = (answer: Preview) => {
      asking.current.delete(key);
      if (!answer.error) answered.set(key, answer);
      setPreviews((all) => ({ ...all, [key]: answer }));
    };
    fetch(`/api/resume-preview?${query}`)
      .then(async (res) => {
        const body = (await res.json()) as Partial<Preview>;
        keep({
          pdf: body.pdf ?? null,
          error: res.ok ? null : (body.error ?? "The preview failed."),
        });
      })
      .catch(() => keep({ pdf: null, error: "Could not reach the server." }));
  }, [enabled, key, query, have]);

  function retry() {
    answered.delete(key);
    setPreviews((all) => {
      const rest = { ...all };
      delete rest[key];
      return rest;
    });
  }

  return { key, preview, retry };
}

/** The preview's pages, or its skeleton, its failure or a DOCX's note. */
function PreviewPages({
  source,
  label,
  enabled,
  version,
}: {
  source: TailorSource;
  label: string;
  enabled: boolean;
  version?: string;
}) {
  const { key, preview, retry } = useResumePreview(source, enabled, version);
  if (!preview) return <PageSkeleton />;
  if (preview.error) {
    return (
      <p role="alert" className="text-body text-danger">
        The preview could not be shown.{" "}
        <Button variant="link" onClick={retry}>
          Try Again
        </Button>
      </p>
    );
  }
  if (preview.pdf) {
    // Keyed by the source: PdfPages keeps its old document on screen until
    // a new one is read, which would show the last resume.
    return (
      <PdfPages
        key={key}
        pdf={preview.pdf}
        boxes={[]}
        selected={null}
        onSelect={() => {}}
        placeholder={<PageSkeleton />}
      />
    );
  }
  return "uploaded_resume_id" in source ? (
    <DocxNote id={source.uploaded_resume_id} label={label} />
  ) : null;
}

export function ResumePreviewDialog({
  open,
  onOpenChange,
  label,
  source,
  version,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The resume's name, the dialog's title. */
  label: string;
  source: TailorSource;
  /** When the resume last changed; a new one asks for the PDF again. */
  version?: string;
}) {
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
          <PreviewPages source={source} label={label} enabled={open} version={version} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The resume Tailor started from, read-only, beside the tailored one on
 * the review step (the title row's Original). The record keeps the
 * source's id, not its name, so it is labelled for what it is. Its label
 * is a bar the toolbar's shape and height (44px), level with it, so the
 * two pages start level and the pair reads as two of a kind: a history
 * glyph in brand, "Original Resume" in ink, and a Read Only tag, since
 * nothing on it can be clicked. It was a grey line of label type, which
 * the user found too quiet.
 */
export function OriginalResume({ source }: { source: TailorSource }) {
  return (
    <section aria-labelledby="original-heading" className="flex flex-col gap-2">
      {/* A border, not the toolbar's ring: the column scrolls, and a ring
          is drawn outside the box, where the scroll clipped its sides */}
      <div className="bg-panel border-border-subtle flex h-11 items-center gap-2 rounded-xl border px-3">
        <ClockCounterClockwiseIcon aria-hidden className="text-brand size-4 shrink-0" />
        <h2 id="original-heading" className="text-label text-ink font-semibold">
          Original Resume
        </h2>
        <span className="bg-ink/5 text-ink-muted text-note ml-auto rounded-full px-2 py-0.5 font-medium">
          Read Only
        </span>
      </div>
      <PreviewPages source={source} label="Original Resume" enabled />
    </section>
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
