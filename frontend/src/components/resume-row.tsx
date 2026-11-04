"use client";

import { FileArrowDownIcon, StarIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useRef, useState } from "react";

import { LocalDate } from "@/app/(seeker)/local-time";
import { DeleteResumeConfirm } from "@/app/(seeker)/resumes/delete-confirm";
import { EllipsisIcon, PdfIcon, PencilIcon, TrashIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";
import type { ResumeItem } from "@/lib/resume-actions";

/** One resume row. The in-flight upload (the Resumes view's
 *  upload-resume.tsx) is the same 52px box, so nothing jumps when the real
 *  row arrives. It is a container: below `@xl` of its own width (576px,
 *  KAN-575) Rename, Download and Delete fold into `RowMoreMenu`. Narrower,
 *  five icons (12px apart on touch) left the name under half the row. A
 *  phone's row is about 317px, and from a 768px window it is 606px. */
export const RESUME_ROW =
  "border-border-subtle bg-well rounded-control @container mt-2 flex items-center gap-3 border p-2";

/** A row's icon actions: 32px boxes. */
export const ROW_ACTION = "rounded-control hover:bg-hover size-8";

/** The row's icons, side by side with no gap: each is a 32px box already.
 *  On touch they stand 12px apart (KAN-575), so each icon's hit area
 *  (`IconButton`'s, 8px past its box) is 44px and no neighbour's covers
 *  it. Above the stretched link, so a press on an icon is the icon's. */
export const ROW_ACTIONS = "relative z-10 flex shrink-0 items-center pointer-coarse:gap-3";

/** The icons `RowMoreMenu` stands in for, shown from `@xl` of the row. */
export const ROW_WIDE = "hidden items-center pointer-coarse:gap-3 @xl:flex";

/** The file mark, from `@sm` of the row: a phone's card gives its 32px to
 *  the name (KAN-575). */
export const ROW_MARK = "hidden size-5 shrink-0 @sm:block";

/** The name and its line: never under half the row (KAN-575). At 375 the
 *  icons and a badge squeezed one card's name to 0px. */
export const ROW_NAME = "min-w-1/2 flex-1";

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
 * A narrow row's Rename, Download and Delete, worded, in one ⋯ menu
 * (KAN-575), shown below `@xl` of the row in place of their icons. On a
 * phone, five 32px icons and a Posting Closed badge left a card no room
 * for its name, and its trash ended past the card's edge. The star and
 * Preview stay out of it. Delete is last and red, and still asks first:
 * once the menu has closed, the confirm hangs from this menu's button.
 */
export function RowMoreMenu({
  name,
  onRename,
  download,
  onDelete,
}: {
  name: string;
  onRename?: () => void;
  download?: { label: string; busy?: boolean; onPick: () => void };
  onDelete?: () => Promise<void>;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  // Delete opens the confirm only once the menu has closed, so the menu's
  // focus return cannot land after the popover has opened.
  const deleting = useRef(false);

  return (
    <div className="@xl:hidden">
      <DropdownMenu
        onOpenChangeComplete={(open) => {
          if (open || !deleting.current) return;
          deleting.current = false;
          setConfirming(true);
        }}
      >
        <DropdownMenuTrigger
          render={
            <IconButton
              ref={button}
              label={`More actions for ${name}`}
              tooltip="More actions"
              className={ROW_ACTION}
            >
              <EllipsisIcon className="size-4" />
            </IconButton>
          }
        />
        <DropdownMenuContent align="end" className="w-44">
          {onRename && (
            <DropdownMenuItem onClick={onRename}>
              <PencilIcon className="text-ink size-4" />
              Rename
            </DropdownMenuItem>
          )}
          {download && (
            <DropdownMenuItem disabled={download.busy} onClick={download.onPick}>
              <FileArrowDownIcon aria-hidden className="text-ink size-4" />
              {download.label}
            </DropdownMenuItem>
          )}
          {onDelete && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                deleting.current = true;
              }}
            >
              <TrashIcon className="size-4" />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {onDelete && (
        <DeleteResumeConfirm
          anchor={button}
          open={confirming}
          onOpenChange={setConfirming}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

/**
 * One uploaded resume, with its primary, Rename, Download and delete
 * actions. The whole card is one target, as a built resume's is
 * (KAN-268): the name's link stretches over it (`after:inset-0`) and
 * opens the upload's own page (`href`, /resumes/uploaded/[id], KAN-366),
 * the icons sit above that, and the card lifts under the pointer
 * (`docs/motion.md`). It opened the file's Storage link in a new tab
 * until KAN-366, and an eye button did that before KAN-268.
 * It shows no status badge (KAN-268): "Ready" on every row told the
 * student nothing, and a reading that found nothing already says so in
 * the note under the dropzone.
 *
 * The star (`PrimaryStar`) marks the primary resume: the default one auto
 * apply attaches when a job has no tailored resume. Import Updated Resume,
 * a fifth icon that swapped a newer file onto the row, went in KAN-362: a
 * newer version is a delete and an upload, which leaves the bank the same.
 *
 * Delete asks first, in a popover under the trash (`DeleteResumeConfirm`,
 * KAN-347), so `onDelete` runs only on Delete Resume. Below `@xl` of the
 * row, Rename, Download and Delete sit in its More menu (`RowMoreMenu`).
 *
 * The Resumes view passes every action. A screen that only shows a resume passes
 * href alone: the primary's star still marks it, but there is no star
 * to click, no rename, no download and no delete.
 */
type ResumeRowProps = {
  resume: ResumeItem;
  /** The upload's page, which the whole card opens. */
  href: string;
  onMakePrimary?: () => void;
  onRename?: () => void;
  onDownload?: () => void;
  /** Runs once the student confirms. */
  onDelete?: () => Promise<void>;
};

export function ResumeRow({
  resume,
  href,
  onMakePrimary,
  onRename,
  onDownload,
  onDelete,
}: ResumeRowProps) {
  const name = resume.original_filename ?? "Resume";
  const downloadLabel = resume.storage_path.endsWith(".pdf") ? "Download PDF" : "Download";

  return (
    <div
      className={cn(
        "group relative",
        RESUME_ROW,
        "hover:border-ink-meta hover:shadow-lift ease-glide transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]",
      )}
    >
      <PdfIcon className={ROW_MARK} />
      <div className={ROW_NAME}>
        <Link
          href={href}
          className="text-label text-ink after:rounded-control focus-visible:after:ring-brand-ring block truncate after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2"
        >
          {name}
        </Link>
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
      <div className={ROW_ACTIONS}>
        <PrimaryStar name={name} primary={resume.is_default} onMakePrimary={onMakePrimary} />
        <div className={ROW_WIDE}>
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
              tooltip={downloadLabel}
              className={ROW_ACTION}
              onClick={onDownload}
            >
              <FileArrowDownIcon aria-hidden className="size-4" />
            </IconButton>
          )}
          {onDelete && (
            <DeleteResumeConfirm
              onDelete={onDelete}
              trigger={
                <IconButton
                  label={`Delete ${name}`}
                  tooltip="Delete"
                  className={cn(ROW_ACTION, "hover:text-danger")}
                >
                  <TrashIcon className="size-4" />
                </IconButton>
              }
            />
          )}
        </div>
        {(onRename || onDownload || onDelete) && (
          <RowMoreMenu
            name={name}
            onRename={onRename}
            download={onDownload && { label: downloadLabel, onPick: onDownload }}
            onDelete={onDelete}
          />
        )}
      </div>
    </div>
  );
}
