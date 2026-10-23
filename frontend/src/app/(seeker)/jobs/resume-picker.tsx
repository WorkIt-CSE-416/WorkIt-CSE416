"use client";

import { useEffect, useState } from "react";

import { ResumeUpload } from "@/components/resume-upload";
import { Button } from "@/components/ui/button";
import { listBuiltResumes } from "@/lib/built-resume-actions";
import { listResumes, replaceResume, uploadResume, type ResumeItem } from "@/lib/resume-actions";
import { MAX_UPLOADS } from "@/lib/resume-limits";

/**
 * The resume picker that "Did You Apply?" (./apply-button.tsx) and Tailor's
 * Pick a Resume (./[jobId]/tailor/tailor-screen.tsx) share: one job
 * posting's resume list and an upload with the Resumes page's rules
 * (KAN-267), so the two dialogs never drift apart on the limit, the
 * replace step or a duplicate.
 */

/** One resume the student can pick: a built resume (a base resume, or one
 *  tailored to a posting) or an uploaded resume. */
export type Choice = {
  key: string;
  label: string;
  kind: string;
  source: Source;
  isDefault: boolean;
};
export type Source = { builtResumeId: string } | { uploadedResumeId: string };

/** The resumes one job posting can take, and the uploads for the limit. */
export async function loadChoices(
  jobId: string,
): Promise<{ choices: Choice[]; uploads: ResumeItem[]; error: string | null }> {
  const [built, uploaded] = await Promise.all([listBuiltResumes(), listResumes()]);
  if (built.error || uploaded.error) {
    return { choices: [], uploads: [], error: built.error ?? uploaded.error };
  }
  const choices: Choice[] = [
    ...(built.data ?? [])
      // A resume tailored to another posting shows only as the primary
      // (KAN-268): the student starred it, so it is theirs to pick.
      .filter((r) => r.job_posting_id == null || r.job_posting_id === jobId || r.is_default)
      .map((r) => ({
        key: `built:${r.id}`,
        label: r.name,
        kind:
          r.job_posting_id === jobId
            ? "Tailored to this job"
            : r.job_posting_id
              ? "Tailored resume"
              : "Built resume",
        source: { builtResumeId: r.id },
        isDefault: r.is_default,
      })),
    ...uploaded.resumes
      .filter((r) => r.storage_path)
      .map((r) => ({
        key: `uploaded:${r.id}`,
        label: r.original_filename ?? "Uploaded resume",
        kind: "Uploaded file",
        source: { uploadedResumeId: r.id },
        isDefault: r.is_default,
      })),
  ];
  return { choices, uploads: uploaded.resumes, error: null };
}

/** The pick a list starts on: the resume tailored to this job, else the
 *  default resume, else the first. */
export function firstChoice(choices: Choice[]): Choice | undefined {
  return (
    choices.find((c) => c.kind === "Tailored to this job") ??
    choices.find((c) => c.isDefault) ??
    choices[0]
  );
}

/** Generated Resumes and Uploaded Resumes side by side, one radio group. */
export function ResumeLists({
  name,
  choices,
  emptyBuilt,
  emptyUploaded,
  picked,
  onPick,
}: {
  name: string;
  choices: Choice[];
  emptyBuilt: string;
  emptyUploaded: string;
  picked: string | null;
  onPick: (key: string) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ResumeChoices
        legend="Generated Resumes"
        name={name}
        choices={choices.filter((c) => c.key.startsWith("built:"))}
        empty={emptyBuilt}
        picked={picked}
        onPick={onPick}
      />
      <ResumeChoices
        legend="Uploaded Resumes"
        name={name}
        choices={choices.filter((c) => c.key.startsWith("uploaded:"))}
        empty={emptyUploaded}
        picked={picked}
        onPick={onPick}
      />
    </div>
  );
}

/**
 * Upload a resume in a dialog, the Resumes page's way (KAN-267): under the
 * limit it uploads at once; at the limit it holds the file until the
 * student picks an upload to replace (Import Updated Resume: the old
 * file's sent resumes keep a frozen copy). `onUploaded` gets the new
 * upload's id, or on a duplicate the id of the resume it matched, to read
 * the list again and pick it. `onBusyChange` says when a file is on its way
 * or waiting, so the dialog holds its own button.
 */
export function UploadPick({
  label,
  uploads,
  onUploaded,
  onBusyChange,
}: {
  label: string;
  uploads: ResumeItem[];
  onUploaded: (uploadedId: string) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [waiting, setWaiting] = useState<File | null>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = uploading || waiting != null;
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  function pickFile(file: File) {
    setError(null);
    setNote(null);
    if (uploads.length >= MAX_UPLOADS) {
      setWaiting(file);
      setReplacing(uploads[0]?.id ?? null);
      return;
    }
    void send(file, null);
  }

  async function send(file: File, replace: string | null) {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const { resume, error, duplicateOf } = replace
      ? await replaceResume(replace, fd)
      : await uploadResume(fd);
    if (!resume && !duplicateOf) {
      setUploading(false);
      return setError(error ?? "Could not upload the resume.");
    }
    await onUploaded((resume?.id ?? duplicateOf) as string);
    setUploading(false);
    setWaiting(null);
    setNote(
      duplicateOf
        ? `${error} It is picked under Uploaded Resumes.`
        : `Uploaded ${file.name}. It is picked under Uploaded Resumes.`,
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-label text-ink">{label}</p>
      {waiting ? (
        // At the limit: which upload the new file replaces.
        <>
          <p className="text-note text-ink-muted">
            You have {MAX_UPLOADS} uploaded resumes, the most WorkIt keeps. Pick the one{" "}
            {waiting.name} replaces. Applications sent with it keep a copy.
          </p>
          <ResumeChoices
            legend="Upload to Replace"
            hideLegend
            name="replace"
            choices={uploads.map((r) => ({
              key: r.id,
              label: r.original_filename ?? "Uploaded resume",
            }))}
            picked={replacing}
            onPick={setReplacing}
          />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setWaiting(null)}
              disabled={uploading}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void send(waiting, replacing)}
              disabled={uploading || replacing == null}
            >
              {uploading ? "Replacing…" : "Replace It"}
            </Button>
          </div>
        </>
      ) : (
        <ResumeUpload file={null} onFileChange={pickFile} onRemove={() => {}} busy={uploading} />
      )}
      {error && (
        <p role="alert" className="text-meta text-danger">
          {error}
        </p>
      )}
      {note && (
        <p className="text-note text-ink-muted" aria-live="polite">
          {note}
        </p>
      )}
    </div>
  );
}

/** One radio row per resume, by its name. */
export function ResumeChoices({
  legend,
  hideLegend = false,
  name,
  choices,
  empty,
  picked,
  onPick,
}: {
  legend: string;
  hideLegend?: boolean;
  name: string;
  /** What an empty section says, under its title. */
  empty?: string;
  choices: { key: string; label: string }[];
  picked: string | null;
  onPick: (key: string) => void;
}) {
  // min-w-0: a fieldset's minimum width is its content's, so in the
  // dialog's two columns a long resume name pushed Generated Resumes over
  // Uploaded Resumes instead of wrapping.
  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className={hideLegend ? "sr-only" : "text-label text-ink mb-1"}>{legend}</legend>
      {choices.length === 0 && empty && <p className="text-note text-ink-meta">{empty}</p>}
      {choices.map((c) => (
        <label
          key={c.key}
          className="hover:bg-hover has-checked:border-brand border-border rounded-control flex cursor-pointer items-center gap-3 border px-3 py-2"
        >
          <input
            type="radio"
            name={name}
            value={c.key}
            checked={picked === c.key}
            onChange={() => onPick(c.key)}
            className="accent-brand shrink-0"
          />
          {/* The name alone: the section title already says what kind it is,
              and a grey kind line under each name only repeated it. It
              wraps, never truncates: two resumes tailored for one company
              differ only at the end of their names. */}
          <span className="text-body text-ink min-w-0 break-words">{c.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
