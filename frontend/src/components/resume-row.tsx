"use client";

import { ArrowSquareInIcon, FileArrowDownIcon, StarIcon } from "@phosphor-icons/react/ssr";

import { LocalDate } from "@/app/(seeker)/local-time";
import { PdfIcon, PencilIcon, TrashIcon } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";
import type { ResumeItem } from "@/lib/resume-actions";

/** One resume row. The loading placeholder, the in-flight upload and the
 *  empty list (in the Resumes view's your-resumes.tsx) are the same 52px
 *  box, so nothing jumps when the real row arrives. */
export const RESUME_ROW =
  "border-border-subtle bg-app rounded-control mt-2 flex items-center gap-3 border p-2";

/** A row's icon actions: 32px boxes, side by side with no gap. */
export const ROW_ACTION = "rounded-control hover:bg-hover size-8";

/**
 * The primary resume's star. On the primary it is filled; on the others it
 * is an outline, always visible (KAN-268): it showed only while the row was
 * hovered, so a student did not know a resume could be made primary. With
 * no `onMakePrimary`, a resume that is not primary shows none. The Resumes
 * view's uploads and built resumes (KAN-258) draw it alike.
 */
export function PrimaryStar({
  name,
  primary,
  onMakePrimary,
}: {
  name: string;
  primary: boolean;
  onMakePrimary?: () => void;
}) {
  if (primary)
    return (
      <span title="Primary resume" className="text-brand flex size-8 items-center justify-center">
        <StarIcon aria-hidden className="size-4" weight="fill" />
        <span className="sr-only">Primary resume</span>
      </span>
    );
  if (!onMakePrimary) return null;
  return (
    <IconButton
      label={`Make ${name} your primary resume`}
      tooltip="Make primary"
      className={ROW_ACTION}
      onClick={onMakePrimary}
    >
      <StarIcon aria-hidden className="size-4" />
    </IconButton>
  );
}

/**
 * One uploaded resume, with its primary, Rename, Download, Import Updated
 * Resume and delete actions. The whole card is one target, as a built resume's is
 * (KAN-268): the name's button stretches over it (`after:inset-0`) and
 * previews the file, the icons sit above that, and the card lifts under
 * the pointer (`docs/motion.md`). An eye button previewed it until then.
 * It shows no status badge (KAN-268): "Ready" on every row told the
 * student nothing, and a reading that found nothing already says so in
 * the note under the dropzone.
 *
 * The star (`PrimaryStar`) marks the primary resume: the default one auto
 * apply attaches when a job has no tailored resume. Import Updated Resume (`onUpdate`) opens
 * the caller's dialog for a newer version of this file, which replaces it
 * and merges into the experience bank (ADR 0003). The stored file never
 * changes by itself, so reading it again would only read the same text.
 *
 * The Resumes view passes every action. A screen that only shows a resume passes
 * onPreview alone: the primary's star still marks it, but there is no star
 * to click, no rename, no download, no update and no delete.
 */
type ResumeRowProps = {
  resume: ResumeItem;
  deleting?: boolean;
  onPreview: () => void;
  onMakePrimary?: () => void;
  onRename?: () => void;
  onDownload?: () => void;
  onUpdate?: () => void;
  onDelete?: () => void;
};

export function ResumeRow({
  resume,
  deleting = false,
  onPreview,
  onMakePrimary,
  onRename,
  onDownload,
  onUpdate,
  onDelete,
}: ResumeRowProps) {
  const name = resume.original_filename ?? "Resume";
  // A browser shows a PDF itself; a DOCX it can only download.
  const action = resume.storage_path.endsWith(".pdf") ? "Preview" : "Download";

  return (
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
          aria-label={`${action} ${name}`}
          onClick={onPreview}
          className="text-label text-ink after:rounded-control focus-visible:after:ring-brand-ring block w-full cursor-pointer truncate text-left after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2"
        >
          {name}
        </button>
        {/* The upload's local day, swapped in after hydration: the server
            renders the list too, in UTC (#418 on /resumes, 2026-10-22). */}
        <p className="text-note text-ink-meta">
          Uploaded
          {resume.created_at && (
            <>
              {" "}
              <LocalDate at={resume.created_at} />
            </>
          )}
        </p>
      </div>
      {/* No gap between them: each is a 32px box already. Above the
          stretched button, so a press on an icon is the icon's. */}
      <div className="relative z-10 flex shrink-0 items-center">
        <PrimaryStar name={name} primary={resume.is_default} onMakePrimary={onMakePrimary} />
        {onRename && (
          <IconButton
            label={`Rename ${name}`}
            tooltip="Rename"
            className={ROW_ACTION}
            onClick={onRename}
          >
            <PencilIcon className="size-4" />
          </IconButton>
        )}
        {onDownload && (
          <IconButton
            label={`Download ${name}`}
            tooltip={resume.storage_path.endsWith(".pdf") ? "Download PDF" : "Download"}
            className={ROW_ACTION}
            onClick={onDownload}
          >
            <FileArrowDownIcon aria-hidden className="size-4" />
          </IconButton>
        )}
        {onUpdate && (
          <IconButton
            label={`Import Updated Resume for ${name}`}
            tooltip="Import Updated Resume"
            className={ROW_ACTION}
            onClick={onUpdate}
          >
            <ArrowSquareInIcon aria-hidden className="size-4" />
          </IconButton>
        )}
        {onDelete && (
          <IconButton
            label={`Delete ${name}`}
            tooltip="Delete"
            className={cn(ROW_ACTION, "hover:text-danger")}
            disabled={deleting}
            onClick={onDelete}
          >
            <TrashIcon className="size-4" />
          </IconButton>
        )}
      </div>
    </div>
  );
}
