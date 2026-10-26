"use client";

import { TagIcon } from "@phosphor-icons/react/ssr";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { FieldFacet, type FacetOption } from "@/components/field-facet";
import { PdfIcon, UploadIcon } from "@/components/icons";
import {
  matches,
  RESUME_TYPES,
  ResumeGroup,
  ResumeScroll,
  searchWords,
  type ResumeType,
} from "@/components/resume-list";
import { PrimaryStar, RESUME_ROW } from "@/components/resume-row";
import { RESUME_ACCEPT, resumeFileError } from "@/components/resume-upload";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/cn";
import { listBuiltResumes } from "@/lib/built-resume-actions";
import { listResumes, replaceResume, uploadResume, type ResumeItem } from "@/lib/resume-actions";
import { MAX_UPLOADS } from "@/lib/resume-limits";

import { LocalDate } from "../local-time";

/**
 * The resume picker that "Did You Apply?" (./apply-button.tsx), Tailor's
 * Pick a Resume (./[jobId]/tailor/tailor-screen.tsx) and Up Next's Choose
 * a Resume (../auto-apply/resume-dialog.tsx) share: one job posting's
 * resume list and an upload with the Resumes page's rules (KAN-267), so
 * the three dialogs never drift apart on the limit, the replace step or a
 * duplicate. The Experiences view's Choose a Resume to Show
 * (../bank/resume-bar.tsx, KAN-361) shows its list too, with no job
 * posting: it builds its own `Choice` rows from the bank's resumes.
 */

/** One resume the student can pick: a built resume (a base resume, or one
 *  tailored to a posting) or an uploaded resume. */
export type Choice = {
  key: string;
  label: string;
  /** Base is a generated resume; Tailored is one tailored to a posting. */
  type: "Base" | "Tailored" | "Uploaded";
  /** Tailored to the job posting this picker is for. */
  forThisJob: boolean;
  /** The posting a tailored resume was made for, "Title at Company". */
  tailoredFor: string | null;
  /** Last edited (built) or uploaded, for the card's line. */
  at: string | null;
  /** When a built resume was made: its line says "Made" until its first
   *  edit, as the Resumes page's card does. */
  madeAt: string | null;
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
        type: r.job_posting_id ? ("Tailored" as const) : ("Base" as const),
        forThisJob: r.job_posting_id === jobId,
        tailoredFor: r.job_posting_id
          ? [r.posting_title, r.posting_company].filter(Boolean).join(" at ") || "A job posting"
          : null,
        at: r.edited_at,
        madeAt: r.created_at,
        source: { builtResumeId: r.id },
        isDefault: r.is_default,
      })),
    ...uploaded.resumes
      .filter((r) => r.storage_path)
      .map((r) => ({
        key: `uploaded:${r.id}`,
        label: r.original_filename ?? "Uploaded resume",
        type: "Uploaded" as const,
        forThisJob: false,
        tailoredFor: null,
        at: r.created_at,
        madeAt: null,
        source: { uploadedResumeId: r.id },
        isDefault: r.is_default,
      })),
  ];
  return { choices, uploads: uploaded.resumes, error: null };
}

/** The pick a list starts on: the resume tailored to this job, else the
 *  default resume, else the first. */
export function firstChoice(choices: Choice[]): Choice | undefined {
  return choices.find((c) => c.forThisJob) ?? choices.find((c) => c.isDefault) ?? choices[0];
}

/** The group each kind of choice falls in. */
const GROUP: Record<Choice["type"], ResumeType> = {
  Uploaded: "uploaded",
  Base: "generated",
  Tailored: "tailored",
};

/** A group's order: the resume tailored to this job, then the primary,
 *  then the newest. */
const order = (a: Choice, b: Choice) =>
  Number(b.forThisJob) - Number(a.forThisJob) ||
  Number(b.isDefault) - Number(a.isDefault) ||
  Date.parse(b.at ?? "0") - Date.parse(a.at ?? "0");

/** A pickable card: the Resumes page's card box (`RESUME_ROW`), tinted
 *  while it holds the pick. The Experiences view's Not From an Upload row
 *  draws itself with it too, since it sits in the same radio group. */
export function pickRowClasses(picked: boolean) {
  return cn(
    RESUME_ROW,
    "cursor-pointer transition-colors duration-150",
    picked ? "border-brand bg-brand-tint" : "hover:border-brand/40 hover:bg-hover",
  );
}

/** The Type filter's options: the list's groups, in their order. */
const TYPES: FacetOption[] = [...RESUME_TYPES];

/** What a dialog that takes an upload hands the list (KAN-267's rules):
 *  the student's uploads, for the limit; `onUploaded` reads the list again
 *  and picks the new file (or, on a duplicate, the one it matched);
 *  `onBusyChange` says when a file is on its way or waiting to replace
 *  one, so the dialog holds its own button. */
export type PickerUpload = {
  uploads: ResumeItem[];
  onUploaded: (uploadedId: string) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
};

/**
 * The student's resumes as the Resumes page lists them (KAN-406): one row
 * with the search (names and the postings they were tailored for), the
 * Type filter and, in a dialog that takes one, Upload Resume, then the
 * Uploaded, Generated and Tailored groups (`ResumeGroup`, components/
 * resume-list.tsx) in one scroll five cards high, each card the Resumes
 * page's box with a radio. One radio group spans every group, so a click
 * on a card or the arrow keys move the pick. A group folds away on its
 * heading, for this opening only; a group with no match hides. Below a
 * 36rem row the search takes its own line and the filter and the button
 * share the next, as two even halves.
 *
 * It has no Sort and no Generate Resume, which the Resumes page's row
 * has: a dialog holds a few resumes, each group already puts the likely
 * pick first, and a resume generated mid-dialog is not the file the
 * student sent. Did You Apply? and Tailor had an upload section under the
 * list ("Sent a Different Resume?", a dropzone) until KAN-406: it took
 * more room than the list, and the Resumes page's button had replaced its
 * own dropzone in KAN-362.
 *
 * It was a table with a Generated or Uploaded switch and Type, Tailored For
 * and Last Edited columns (KAN-360) until the Resumes page took the grouped
 * list (KAN-404): the two read as different apps, and the columns said what
 * a card's one line says. The search and the filter only filter what
 * shows: the pick stays put, so neither drops it.
 */
export function ResumeLists({
  name,
  choices,
  empty,
  picked,
  onPick,
  upload,
}: {
  name: string;
  choices: Choice[];
  /** What the list says when the student has no resume at all. */
  empty: string;
  picked: string | null;
  onPick: (key: string) => void;
  /** Given, the row has Upload Resume. */
  upload?: PickerUpload;
}) {
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<ResumeType[]>([]);
  const [folded, setFolded] = useState<ResumeType[]>([]);
  // A new upload is picked under Uploaded, so nothing may hide it.
  const sending = useUploadButton(upload, () => {
    setQuery("");
    setTypes([]);
    setFolded((all) => all.filter((g) => g !== "uploaded"));
  });

  const words = searchWords(query);
  const shown = choices.filter(
    (c) =>
      (types.length === 0 || types.includes(GROUP[c.type])) &&
      matches(`${c.label} ${c.tailoredFor ?? ""}`, words),
  );
  const toggle = (group: ResumeType) =>
    setFolded((all) => (all.includes(group) ? all.filter((g) => g !== group) : [...all, group]));

  return (
    <div className="@container flex min-w-0 flex-col gap-3">
      <div className="grid grid-cols-2 items-center gap-2 @xl:flex">
        <SearchField
          id={`${name}-search`}
          label="Search resumes"
          placeholder="Search by name or job"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="col-span-2 @xl:min-w-48 @xl:flex-1"
        />
        <FieldFacet
          label="Type"
          Icon={TagIcon}
          options={TYPES}
          values={types}
          onChange={(values) => setTypes(values as ResumeType[])}
          className={cn("min-w-36", !sending.button && "col-span-2 @xl:col-auto")}
        />
        {sending.button}
      </div>
      {sending.panel}
      {choices.length === 0 ? (
        <p className="text-note text-ink-meta py-2">{empty}</p>
      ) : shown.length === 0 ? (
        <p className="text-note text-ink-meta py-2">None of your resumes match these filters.</p>
      ) : (
        // Its own scroll, so the dialog's footer stays put under a long list.
        <div className="border-border-subtle rounded-card bg-panel border">
          <ResumeScroll label="Your resumes">
            {RESUME_TYPES.map(({ value, label }) => {
              const rows = shown.filter((c) => GROUP[c.type] === value).sort(order);
              if (rows.length === 0) return null;
              return (
                <ResumeGroup
                  key={value}
                  label={label}
                  count={rows.length}
                  open={!folded.includes(value)}
                  onToggle={() => toggle(value)}
                >
                  {rows.map((c) => (
                    <li key={c.key}>
                      <PickCard choice={c} name={name} picked={picked === c.key} onPick={onPick} />
                    </li>
                  ))}
                </ResumeGroup>
              );
            })}
          </ResumeScroll>
        </div>
      )}
    </div>
  );
}

/** One resume as a pickable card: the Resumes page's file mark, name and
 *  line ("Uploaded Oct 21", "Last edited Oct 21 · For …"), its primary
 *  star, and a radio. The name wraps, never truncates: two resumes
 *  tailored for one company differ only at the end of their names. */
function PickCard({
  choice: c,
  name,
  picked,
  onPick,
}: {
  choice: Choice;
  name: string;
  picked: boolean;
  onPick: (key: string) => void;
}) {
  const edited = c.madeAt != null && c.at != null && Date.parse(c.at) > Date.parse(c.madeAt);
  const day = c.type === "Uploaded" || edited ? c.at : c.madeAt;
  return (
    <label className={pickRowClasses(picked)}>
      <input
        type="radio"
        name={name}
        value={c.key}
        checked={picked}
        onChange={() => onPick(c.key)}
        className="accent-brand shrink-0"
      />
      <PdfIcon className="size-5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="text-label text-ink block break-words">{c.label}</span>
        <span className="text-note text-ink-meta block break-words">
          {c.type === "Uploaded" ? "Uploaded" : edited ? "Last edited" : "Made"}
          {day && (
            <>
              {" "}
              <LocalDate at={day} />
            </>
          )}
          {c.tailoredFor && (
            <>
              {" · For "}
              {c.forThisJob ? <ThisJob /> : c.tailoredFor}
            </>
          )}
        </span>
      </span>
      <PrimaryStar name={c.label} primary={c.isDefault} />
    </label>
  );
}

/** The posting this picker is for, in place of its own title. Words, not
 *  a badge: a badge's tint vanished on the picked card's. */
function ThisJob() {
  return <span className="text-brand font-medium">This Job</span>;
}

/**
 * Upload Resume in a dialog's list row, the Resumes page's way (KAN-267):
 * under the limit the picked file uploads at once; at the limit it waits
 * under the row (`panel`) until the student picks an upload to replace
 * (Import Updated Resume: the old file's sent resumes keep a frozen copy),
 * since a dialog cannot send them to Resumes to delete one. `onSent` runs
 * once the list has the new file, so the list can clear what would hide
 * it. With no `upload`, the row has no button.
 */
function useUploadButton(upload: PickerUpload | undefined, onSent: () => void) {
  const [waiting, setWaiting] = useState<File | null>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = uploading || waiting != null;
  const onBusyChange = upload?.onBusyChange;
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  if (!upload) return { button: null, panel: null };
  const { uploads, onUploaded } = upload;

  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setNote(null);
    const invalid = resumeFileError(file);
    if (invalid) return setError(invalid);
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
    onSent();
    setUploading(false);
    setWaiting(null);
    setNote(
      duplicateOf
        ? `${error} It is picked under Uploaded.`
        : `Uploaded ${file.name}. It is picked under Uploaded.`,
    );
  }

  const button = (
    <>
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="@xl:ml-auto"
      >
        <UploadIcon className="size-4" /> {uploading ? "Uploading…" : "Upload Resume"}
      </Button>
      <input ref={inputRef} type="file" accept={RESUME_ACCEPT} onChange={pickFile} hidden />
    </>
  );

  const panel = (waiting || error || note) && (
    <div className="flex flex-col gap-2">
      {waiting && (
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

  return { button, panel };
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
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className={hideLegend ? "sr-only" : "text-label text-ink mb-1"}>{legend}</legend>
      {choices.length === 0 && empty && <p className="text-note text-ink-meta">{empty}</p>}
      {choices.map((c) => (
        // Drawn as the list's cards are (`pickRowClasses`), siblings of theirs.
        <label key={c.key} className={cn(pickRowClasses(picked === c.key), "mt-0")}>
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
          <span className="text-label text-ink min-w-0 break-words">{c.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
