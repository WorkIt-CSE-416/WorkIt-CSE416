"use client";

import { FileArrowDownIcon, StarIcon } from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FileIcon, PencilIcon, TrashIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  deleteResume,
  getResumeFileUrl,
  renameResume,
  setPrimaryResume,
  type ResumeItem,
} from "@/lib/resume-actions";
import { openDownload } from "@/lib/save-file";

import { LocalDate } from "../../../local-time";
import { PageSkeleton, PdfPages } from "../../[resumeId]/pdf-pages";
import { SLIM_BAR } from "../../[resumeId]/slim-bar";
import { Zoom, zoomWidth } from "../../[resumeId]/zoom";
import { RenameForm } from "../../built-resume-row";
import { DeleteResumeConfirm } from "../../delete-confirm";

/**
 * An uploaded resume's page (KAN-366): its name, then a sticky bar in the
 * editor's own look (`SLIM_BAR`, ../../[resumeId]/slim-bar.ts: a quiet white
 * row, the actions at its end; it was a lavender bar with a ring and a
 * shadow until KAN-576), then the file. The bar says when it was uploaded
 * and marks the primary resume; its buttons are Make Primary (while it is
 * not), Rename, Delete and Download, the page's main action, filled. They
 * call what the upload's card on the Resumes view calls
 * (../../upload-resume.tsx), and the card keeps its icons.
 *
 * A PDF is drawn page by page with the editor's pdf.js preview
 * (`PdfPages`), with no click targets: an upload is read, not edited, and
 * its facts are edited in Experiences (ADR 0003). The bar holds the
 * editor's zoom control (`Zoom`) for a PDF; it opens at 100% and is not
 * stored, so each visit starts there. A DOCX cannot be drawn
 * that way, so its place holds the file's name and Download.
 *
 * Rename edits the heading in place, with the form every resume's card
 * uses; Delete asks first, in a popover under its button, and returns to
 * the Resumes view.
 */
export function UploadedViewer({ resume, pdf }: { resume: ResumeItem; pdf: string | null }) {
  const router = useRouter();
  const name = resume.original_filename ?? "Resume";
  const primary = resume.is_default;
  const [renaming, setRenaming] = useState(false);
  // A rename or a new star reads the page again, so the name and the star
  // are always the API's: the action clears the router's copies, which in
  // Next 16 renders this page again in its answer (lib/resume-revalidate.ts),
  // so a `router.refresh()` after it would read the PDF twice. The form stays
  // open until the new name is in, so the old one never flashes back.
  const [saving, startSaving] = useTransition();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Opens at 100%, kept in this page's state only: not stored, not shared
  const [zoom, setZoom] = useState(100);

  function rename(next: string) {
    setError(null);
    startSaving(async () => {
      const { error } = await renameResume(resume.id, next);
      if (error) return setError(error);
      setRenaming(false);
    });
  }

  function makePrimary() {
    setError(null);
    startSaving(async () => {
      const { error } = await setPrimaryResume(resume.id);
      if (error) return setError(error);
    });
  }

  async function download() {
    setError(null);
    const { url, error } = await getResumeFileUrl(resume.id, true);
    if (url) openDownload(url);
    else setError(error ?? "Could not download the resume.");
  }

  // Delete stays disabled until the page leaves.
  async function remove() {
    setDeleting(true);
    setError(null);
    // `leaving`: rendered again, this page would be a 404 before the push
    const { error } = await deleteResume(resume.id, { leaving: true });
    if (!error) return router.push("/resumes");
    setDeleting(false);
    setError(error);
  }

  return (
    <>
      {renaming ? (
        <RenameForm
          id={resume.id}
          name={name}
          saving={saving}
          onSave={rename}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <h1 className="text-heading text-ink break-words">{name}</h1>
      )}

      <div className="mt-4 flex flex-col gap-4">
        <div className={SLIM_BAR}>
          {/* Under the buttons where the page is narrow, so Download stays
              in the first row: last in the bar, it wrapped alone at 768 */}
          <span className="text-note text-ink-meta flex items-center gap-3 pl-1 @max-2xl/main:order-last @max-2xl/main:basis-full">
            {resume.created_at && (
              <span>
                Uploaded <LocalDate at={resume.created_at} />
              </span>
            )}
            {primary && (
              <span className="text-brand text-note inline-flex items-center gap-1">
                <StarIcon aria-hidden weight="fill" className="size-3.5" />
                Primary
              </span>
            )}
          </span>
          {/* One row that never wraps: it gives way first. Below @3xl the
              three lesser buttons keep their glyph alone, named by `title`,
              and below @md the zoom goes, where even its 50% step (408px)
              is wider than the page's column, so no step changes anything */}
          <div className="ml-auto flex items-center gap-2">
            {pdf && (
              <div className="@max-md/main:hidden">
                <Zoom zoom={zoom} onZoom={setZoom} />
              </div>
            )}
            {!primary && (
              <Button
                variant="secondary"
                size="sm"
                title="Make Primary"
                onClick={makePrimary}
                disabled={saving}
              >
                <StarIcon aria-hidden className="size-4" />
                <span className="@max-3xl/main:sr-only">Make Primary</span>
              </Button>
            )}
            <Button variant="secondary" size="sm" title="Rename" onClick={() => setRenaming(true)}>
              <PencilIcon className="size-4" />
              <span className="@max-3xl/main:sr-only">Rename</span>
            </Button>
            <DeleteResumeConfirm
              busy={deleting}
              onDelete={remove}
              trigger={
                <Button variant="secondary" size="sm" title="Delete" disabled={deleting}>
                  <TrashIcon className="size-4" />
                  <span className="@max-3xl/main:sr-only">Delete</span>
                </Button>
              }
            />
            <Button size="sm" data-bar-action onClick={download}>
              <FileArrowDownIcon aria-hidden className="size-4" /> Download
            </Button>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-note text-danger">
            {error}
          </p>
        )}

        {pdf ? (
          // The page's skeleton until pdf.js draws, as ./loading.tsx shows it.
          <div className="mx-auto w-full" style={{ maxWidth: zoomWidth(zoom) }}>
            <PdfPages
              pdf={pdf}
              boxes={[]}
              selected={null}
              onSelect={() => {}}
              placeholder={<PageSkeleton />}
            />
          </div>
        ) : (
          <EmptyState
            Icon={FileIcon}
            title="This File Can't Be Shown Here"
            action={
              <Button variant="secondary" size="sm" onClick={download}>
                <FileArrowDownIcon aria-hidden className="size-4" /> Download
              </Button>
            }
          >
            WorkIt shows PDF resumes on this page. Download {name} to open it.
          </EmptyState>
        )}
      </div>
    </>
  );
}
