"use client";

import { FileDown } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { PdfIcon, PencilIcon, TrashIcon } from "@/components/icons";
import { PrimaryStar, RESUME_ROW, ROW_ACTION } from "@/components/resume-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { TextField } from "@/components/ui/text-field";
import {
  deleteBuiltResume,
  renameBuiltResume,
  setDefaultBuiltResume,
  type BuiltResume,
} from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";

import { LocalDate } from "../local-time";
import { DeleteConfirm } from "./delete-confirm";
import { DownloadNotes, useResumeDownload } from "./download-menu";

/**
 * One built resume, drawn as an uploaded one's row is: the file mark, the
 * name and its day, then the star, Rename, Download PDF and Delete.
 * Download PDF is the editor's PDF download (`useResumeDownload`: a sent
 * resume, with the missing-character warning under the row), on the card
 * since KAN-268. A tailored resume takes the star too since then. The whole card is
 * one target: the name's link stretches over it (`after:inset-0`), the
 * icons sit above that, and the card lifts under the pointer as every
 * whole-target card does (`docs/motion.md`).
 */
export function BuiltResumeRow({
  resume,
  reload,
}: {
  resume: BuiltResume;
  reload: () => Promise<void>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = useResumeDownload(resume.id);

  async function makePrimary() {
    setError(null);
    const { error } = await setDefaultBuiltResume(resume.id);
    if (error) return setError(error);
    await reload();
  }

  // The form stays open until the list has the new name, so the old one
  // never flashes back.
  async function rename(name: string) {
    setSaving(true);
    setError(null);
    const { error } = await renameBuiltResume(resume.id, name);
    if (!error) await reload();
    setSaving(false);
    if (error) return setError(error);
    setRenaming(false);
  }

  // Delete stays disabled until the reload drops the row.
  async function remove() {
    setDeleting(true);
    setError(null);
    const { error } = await deleteBuiltResume(resume.id);
    if (!error) return reload();
    setDeleting(false);
    setError(error);
  }

  // The API sends edited_at equal to created_at until the first change.
  const edited = Date.parse(resume.edited_at) > Date.parse(resume.created_at);

  return (
    <li>
      {renaming ? (
        <RenameForm
          id={resume.id}
          name={resume.name}
          saving={saving}
          onSave={rename}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <div
          className={cn(
            "group relative",
            RESUME_ROW,
            "hover:border-brand/40 hover:shadow-lift ease-glide transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]",
          )}
        >
          <PdfIcon className="size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <Link
              href={`/resumes/${encodeURIComponent(resume.id)}`}
              className="text-label text-ink after:rounded-control focus-visible:after:ring-brand-ring block truncate after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2"
            >
              {resume.name}
            </Link>
            {/* One day: when it was last edited, or made until the first edit.
                Both together said one day twice for a resume edited the day
                it was made, and the made day mattered less. */}
            <p className="text-note text-ink-meta">
              {edited ? "Last edited" : "Made"}{" "}
              <LocalDate at={edited ? resume.edited_at : resume.created_at} />
            </p>
          </div>
          {/* Story 90: the resume still opens and downloads; only Tailor needs a live posting. */}
          {resume.posting_closed && <Badge tone="inert">Posting Closed</Badge>}
          {/* Above the stretched link, so a press on an icon is the icon's. */}
          <div className="relative z-10 flex shrink-0 items-center">
            <PrimaryStar
              name={resume.name}
              primary={resume.is_default}
              onMakePrimary={makePrimary}
            />
            <IconButton
              label={`Rename ${resume.name}`}
              tooltip="Rename"
              className={ROW_ACTION}
              onClick={() => setRenaming(true)}
            >
              <PencilIcon className="size-4" />
            </IconButton>
            <IconButton
              label={`Download ${resume.name} as a PDF`}
              tooltip={download.busy === "pdf" ? "Making PDF…" : "Download PDF"}
              className={ROW_ACTION}
              disabled={download.busy !== null}
              onClick={() => download.pick("pdf")}
            >
              <FileDown aria-hidden className="size-4" />
            </IconButton>
            <IconButton
              label={`Delete ${resume.name}`}
              tooltip="Delete"
              className={cn(ROW_ACTION, "hover:text-danger")}
              onClick={() => setConfirming(true)}
            >
              <TrashIcon className="size-4" />
            </IconButton>
          </div>
        </div>
      )}
      <div className="mt-2 empty:hidden">
        <DownloadNotes download={download} />
      </div>
      {confirming && (
        <DeleteConfirm
          label="Delete Resume"
          busy={deleting}
          onDelete={remove}
          onKeep={() => setConfirming(false)}
        >
          Delete this resume? Files you already sent are kept.
        </DeleteConfirm>
      )}
      {error && (
        <p role="alert" className="text-note text-danger mt-2">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * The resume's name, open for typing (KAN-258): Rename turns the card into
 * this form, a built resume's or an upload's (KAN-268), as Edit opens a bank entry in place, with the bank's form
 * buttons at a field's height. A name left as it was closes the form with
 * no call; Escape or Cancel keeps the name.
 */
export function RenameForm({
  id,
  name,
  saving,
  onSave,
  onCancel,
}: {
  id: string;
  name: string;
  saving: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const trimmed = draft.trim();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (trimmed === name) return onCancel();
    onSave(trimmed);
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1 basis-56">
        <TextField
          id={`resume-name-${id}`}
          label="Resume Name"
          required
          autoFocus
          maxLength={80}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancel();
          }}
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !trimmed}>
          {saving ? "Saving…" : "Save Name"}
        </Button>
      </div>
    </form>
  );
}
