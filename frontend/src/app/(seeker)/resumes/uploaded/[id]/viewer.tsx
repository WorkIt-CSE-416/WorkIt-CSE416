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
import { RenameForm } from "../../built-resume-row";
import { DeleteResumeConfirm } from "../../delete-confirm";

/**
 * An uploaded resume's page (KAN-366): its name, then a sticky bar drawn
 * as the editor's is (../../[resumeId]/editor.tsx: the brand tint, the
 * actions at its end), then the file. The bar says when it was uploaded
 * and marks the primary resume; its buttons are Make Primary (while it is
 * not), Rename, Delete and Download, the page's main action, filled. They
 * call what the upload's card on the Resumes view calls
 * (../../upload-resume.tsx), and the card keeps its icons.
 *
 * A PDF is drawn page by page with the editor's pdf.js preview
 * (`PdfPages`), with no click targets: an upload is read, not edited, and
 * its facts are edited in Experiences (ADR 0003). A DOCX cannot be drawn
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
        <div className="bg-brand-tint/95 ring-brand-pale sticky top-2 z-20 flex min-h-12 flex-wrap items-center gap-2 rounded-2xl p-1.5 pl-3 shadow-sm ring-1 backdrop-blur">
          <span className="text-label text-ink flex items-center gap-3">
            {resume.created_at && (
              <span>
                Uploaded <LocalDate at={resume.created_at} />
              </span>
            )}
            {primary && (
              <span className="text-brand text-meta inline-flex items-center gap-1">
                <StarIcon aria-hidden weight="fill" className="size-3.5" />
                Primary
              </span>
            )}
          </span>
          {/* The bar's end wraps as one, so on a narrow page the buttons stay
              together at the right. */}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {!primary && (
              <Button variant="secondary" size="sm" onClick={makePrimary} disabled={saving}>
                <StarIcon aria-hidden className="size-4" /> Make Primary
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setRenaming(true)}>
              <PencilIcon className="size-4" /> Rename
            </Button>
            <DeleteResumeConfirm
              busy={deleting}
              onDelete={remove}
              trigger={
                <Button variant="secondary" size="sm" disabled={deleting}>
                  <TrashIcon className="size-4" /> Delete
                </Button>
              }
            />
            <Button size="sm" onClick={download}>
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
          <PdfPages
            pdf={pdf}
            boxes={[]}
            selected={null}
            onSelect={() => {}}
            placeholder={<PageSkeleton />}
          />
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
