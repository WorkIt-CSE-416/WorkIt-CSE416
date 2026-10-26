"use client";

import { FileArrowDownIcon } from "@phosphor-icons/react/ssr";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getResumeFileUrl } from "@/lib/resume-actions";
import { openDownload } from "@/lib/save-file";

import { loadPdfjs, PageSkeleton, PdfPages } from "../../../resumes/[resumeId]/pdf-pages";
import type { Choice } from "../../resume-picker";

/**
 * A preview of the resume picked in Tailor's first step, so the student
 * sees what they are about to tailor. Read-only: the editor's `PdfPages`
 * with no click targets, as an upload's own page draws it. The PDF comes
 * from /api/resume-preview (a built resume rendered, an upload's file
 * read), a route handler so a slow render never queues the screen's server
 * actions behind it. A DOCX cannot be drawn by pdf.js, so it gets a note
 * and Download, as its own page does.
 *
 * Each answer is kept by the pick's key, so a pick shows only its own
 * answer, however late an older one arrives, and a pick made again shows
 * at once. A failed one says so in a line, with Try Again.
 */

type Preview = { pdf: string | null; error: string | null };

export function ResumePreview({ choice }: { choice: Choice | null }) {
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  // Keys asked for and not yet answered, so a quick pick away and back
  // does not ask twice.
  const asking = useRef(new Set<string>());
  const key = choice?.key ?? null;
  const query = choice
    ? "builtResumeId" in choice.source
      ? `built=${encodeURIComponent(choice.source.builtResumeId)}`
      : `uploaded=${encodeURIComponent(choice.source.uploadedResumeId)}`
    : null;
  const preview = key ? previews[key] : undefined;
  const have = preview !== undefined;

  useEffect(() => {
    if (!key || !query || have || asking.current.has(key)) return;
    asking.current.add(key);
    // pdf.js downloads while the server draws the PDF, as in the editor.
    loadPdfjs().catch(() => {});
    const keep = (answer: Preview) => {
      asking.current.delete(key);
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
  }, [key, query, have]);

  function retry() {
    if (!key) return;
    setPreviews((all) => {
      const rest = { ...all };
      delete rest[key];
      return rest;
    });
  }

  return (
    <Card as="section" aria-labelledby="resume-preview-title" className="flex min-w-0 flex-col">
      <h2 id="resume-preview-title" className="text-subtitle text-ink">
        Preview
      </h2>
      <p className="text-note text-ink-meta break-words">{choice?.label ?? "No resume picked"}</p>
      {/* One height on a desktop, beside the list; on a phone it stacks and
          stops at most of the screen, so the page can still scroll past it. */}
      <div
        tabIndex={0}
        aria-label="Resume pages"
        className="bg-canvas focus-visible:outline-brand mt-3 max-h-[70svh] overflow-y-auto rounded-xl p-3 focus-visible:outline-2 lg:h-[44rem] lg:max-h-none"
      >
        {!choice ? (
          <p className="text-body text-ink-meta">Pick a resume to preview it.</p>
        ) : !preview ? (
          <PageSkeleton />
        ) : preview.error ? (
          <p role="alert" className="text-body text-danger">
            The preview could not be shown.{" "}
            <Button variant="link" onClick={retry}>
              Try Again
            </Button>
          </p>
        ) : preview.pdf ? (
          // Keyed by the pick: PdfPages keeps its old document on screen
          // until a new one is read, which would show the last pick's PDF.
          <PdfPages
            key={choice.key}
            pdf={preview.pdf}
            boxes={[]}
            selected={null}
            onSelect={() => {}}
            placeholder={<PageSkeleton />}
          />
        ) : (
          <DocxNote choice={choice} />
        )}
      </div>
    </Card>
  );
}

/** A DOCX upload: pdf.js cannot draw one, so its file downloads instead. */
function DocxNote({ choice }: { choice: Choice }) {
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (!("uploadedResumeId" in choice.source)) return;
    setError(null);
    const { url, error } = await getResumeFileUrl(choice.source.uploadedResumeId, true);
    if (url) openDownload(url);
    else setError(error ?? "Could not download the resume.");
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-body text-ink-meta">
        WorkIt shows PDF resumes here. Download {choice.label} to open it.
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
