"use client";

import { Eye, Star } from "lucide-react";

import { PdfIcon, TrashIcon } from "@/components/icons";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";
import type { ResumeItem } from "@/lib/resume-actions";

/** One resume row. The loading placeholder, the in-flight upload and the
 *  empty list (in ./page.tsx) are the same 52px box, so the list does not
 *  jump when the real row arrives. */
export const RESUME_ROW =
  "border-border-subtle bg-app rounded-control mt-2 flex items-center gap-3 border p-2";

/** What each backend resume status reads as. A failed parse is a warning, not
 *  a danger: the file is stored, and only its text could not be extracted. */
const RESUME_STATUS: Record<string, { label: string; tone: BadgeTone } | undefined> = {
  parsed: { label: "Ready", tone: "positive" },
  uploaded: { label: "Processing", tone: "inert" },
  parse_failed: { label: "Couldn't Read Text", tone: "warning" },
};

/** Rows only exist after the client-side fetch, so this is the browser's own
 *  calendar day, never the server's UTC one. */
function uploadedOn(createdAt: string | null) {
  if (!createdAt) return "Uploaded";
  const day = new Date(createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `Uploaded ${day}`;
}

const ROW_ACTION = "rounded-control hover:bg-hover size-8";

/**
 * One uploaded resume, with its preview, primary and delete actions.
 *
 * The star marks the primary resume — the one the profile's Work Experience
 * and Skills show. On the primary it is filled and always visible; on the
 * others it appears while the row is hovered or the star has keyboard focus.
 * A touch screen has no hover, so there those stars stay visible. A hidden
 * star still holds its place, so nothing shifts when it appears.
 */
type ResumeRowProps = {
  resume: ResumeItem;
  deleting: boolean;
  onPreview: () => void;
  onMakePrimary: () => void;
  onDelete: () => void;
};

export function ResumeRow({
  resume,
  deleting,
  onPreview,
  onMakePrimary,
  onDelete,
}: ResumeRowProps) {
  const name = resume.original_filename ?? "Resume";
  // A browser shows a PDF itself; a DOCX it can only download.
  const action = resume.storage_path.endsWith(".pdf") ? "Preview" : "Download";
  const status = RESUME_STATUS[resume.status] ?? { label: resume.status, tone: "inert" };

  return (
    <div className={cn("group", RESUME_ROW)}>
      <PdfIcon className="size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-label text-ink truncate">{name}</p>
        <p className="text-note text-ink-meta">{uploadedOn(resume.created_at)}</p>
      </div>
      <Badge tone={status.tone}>{status.label}</Badge>
      {/* No gap between the three: each is a 32px box already. */}
      <div className="flex shrink-0 items-center">
        {resume.is_default ? (
          <span
            title="Primary resume"
            className="text-brand flex size-8 items-center justify-center"
          >
            <Star aria-hidden className="size-4 fill-current" />
            <span className="sr-only">Primary resume</span>
          </span>
        ) : (
          <IconButton
            label={`Make ${name} your primary resume`}
            tooltip="Make Primary"
            className={cn(
              ROW_ACTION,
              "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
            )}
            onClick={onMakePrimary}
          >
            <Star aria-hidden className="size-4" />
          </IconButton>
        )}
        <IconButton
          label={`${action} ${name}`}
          tooltip={action}
          className={ROW_ACTION}
          onClick={onPreview}
        >
          <Eye aria-hidden className="size-4" />
        </IconButton>
        <IconButton
          label={`Delete ${name}`}
          tooltip="Delete"
          className={cn(ROW_ACTION, "hover:text-danger")}
          disabled={deleting}
          onClick={onDelete}
        >
          <TrashIcon className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}
