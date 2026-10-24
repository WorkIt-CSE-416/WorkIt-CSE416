"use client";

import { useEffect, useState, type ReactNode } from "react";

import { StarIcon } from "@phosphor-icons/react/ssr";

import { ResumeUpload } from "@/components/resume-upload";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedToggle } from "@/components/ui/segmented-control";
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
 * duplicate.
 */

/** One resume the student can pick: a built resume (a base resume, or one
 *  tailored to a posting) or an uploaded resume. */
export type Choice = {
  key: string;
  label: string;
  /** Base and Tailored are built resumes; the picker's Generated view. */
  type: "Base" | "Tailored" | "Uploaded";
  /** Tailored to the job posting this picker is for. */
  forThisJob: boolean;
  /** The posting a tailored resume was made for, "Title at Company". */
  tailoredFor: string | null;
  /** Last edited (built) or uploaded, for the table's date column. */
  at: string | null;
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

type View = "built" | "uploaded";

const VIEWS = [
  { value: "built", label: "Generated" },
  { value: "uploaded", label: "Uploaded" },
];

const viewOf = (key: string | null): View | null =>
  key?.startsWith("built:") ? "built" : key?.startsWith("uploaded:") ? "uploaded" : null;

/**
 * The student's resumes as one table with a switcher (KAN-360): Generated
 * (base and tailored resumes) or Uploaded, a search over the names and the
 * postings they were tailored for, and one radio group, so a click on a
 * row or the arrow keys move the pick. Two lists side by side, the shape
 * before, ran long and read as a wall of boxes once a student had a few
 * tailored resumes.
 *
 * It opens on the view that holds the pick, and follows the pick when the
 * dialog changes it (an upload picks the new file, under Uploaded). The
 * search and the view filter only what shows: the pick stays put, so
 * switching views never drops it.
 */
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
  const [view, setView] = useState<View>(
    viewOf(picked) ?? (choices.some((c) => c.type !== "Uploaded") ? "built" : "uploaded"),
  );
  // A pick made outside the table moves the view with it, worked out while
  // rendering (React's way to adjust state to a prop), not in an effect.
  const [seen, setSeen] = useState(picked);
  if (picked !== seen) {
    setSeen(picked);
    const next = viewOf(picked);
    if (next) setView(next);
  }
  const [query, setQuery] = useState("");

  const inView = choices.filter((c) => (c.type === "Uploaded") === (view === "uploaded"));
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = inView.filter((c) => {
    const text = `${c.label} ${c.tailoredFor ?? ""}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
  const built = view === "built";

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedToggle
          label="Resume Kind"
          options={VIEWS}
          value={view}
          onValueChange={(v) => setView(v as View)}
        />
        <SearchField
          id={`${name}-search`}
          label="Search resumes"
          placeholder={built ? "Search by name or job" : "Search by file name"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-48 flex-1"
        />
      </div>
      {inView.length === 0 ? (
        <p className="text-note text-ink-meta py-2">{built ? emptyBuilt : emptyUploaded}</p>
      ) : (
        // Its own scroll, so the table's head stays in view and the
        // dialog's footer stays put under a long list.
        <div className="border-border-subtle rounded-card max-h-scroll-box overflow-y-auto border">
          <table className="w-full table-fixed border-collapse text-left">
            <thead className="bg-well sticky top-0 z-1">
              <tr>
                <th scope="col" className={cn(TH, "w-10")}>
                  <span className="sr-only">Pick</span>
                </th>
                <th scope="col" className={cn(TH, "pl-0")}>
                  Resume
                </th>
                {built && (
                  <>
                    <th scope="col" className={cn(TH, "w-24")}>
                      Type
                    </th>
                    <th scope="col" className={cn(TH, "hidden w-48 sm:table-cell")}>
                      Tailored For
                    </th>
                  </>
                )}
                <th scope="col" className={cn(TH, "w-28")}>
                  {built ? "Last Edited" : "Uploaded"}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr
                  key={c.key}
                  onClick={() => onPick(c.key)}
                  className={cn(
                    "border-border-subtle cursor-pointer border-t transition-colors duration-150",
                    picked === c.key ? "bg-brand-tint" : "hover:bg-hover",
                  )}
                >
                  <td className={cn(TD, "pr-0")}>
                    <input
                      type="radio"
                      name={name}
                      value={c.key}
                      checked={picked === c.key}
                      onChange={() => onPick(c.key)}
                      aria-labelledby={`${name}-${c.key}`}
                      className="accent-brand block"
                    />
                  </td>
                  <td className={cn(TD, "pl-0")}>
                    {/* It wraps, never truncates: two resumes tailored for
                        one company differ only at the end of their names. */}
                    <span id={`${name}-${c.key}`} className="text-ink break-words">
                      {c.label}
                    </span>
                    {c.isDefault && (
                      // The Resumes page's mark for the default resume
                      // (PrimaryStar), with its name.
                      <span className="text-brand text-meta ml-2 inline-flex items-center gap-1 align-middle whitespace-nowrap">
                        <StarIcon aria-hidden weight="fill" className="size-3.5" />
                        Primary
                      </span>
                    )}
                    {/* Below sm the Tailored For column hides; its words
                        sit under the name instead. */}
                    {built && c.tailoredFor && (
                      <span className="text-ink-meta mt-0.5 block break-words sm:hidden">
                        {c.forThisJob ? <ThisJob /> : c.tailoredFor}
                      </span>
                    )}
                  </td>
                  {built && (
                    <>
                      <td className={TD}>{c.type}</td>
                      <td className={cn(TD, "hidden sm:table-cell")}>
                        {c.forThisJob ? <ThisJob /> : <Cell>{c.tailoredFor}</Cell>}
                      </td>
                    </>
                  )}
                  <td className={cn(TD, "text-ink-meta")}>
                    {c.at ? <LocalDate at={c.at} /> : "Unknown"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && (
            <p className="text-note text-ink-meta border-border-subtle border-t px-4 py-3">
              No resumes match &ldquo;{query.trim()}&rdquo;.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const TH = "px-3 py-2 text-note text-ink-meta font-medium";
const TD = "px-3 py-2.5 text-note text-ink align-middle";

/** The posting this picker is for, in place of its own title. Words, not
 *  a badge: a badge's tint vanished on the picked row's. */
function ThisJob() {
  return <span className="text-brand font-medium">This Job</span>;
}

/** A cell's text, or None where there is none. */
function Cell({ children }: { children: ReactNode }) {
  return children ? (
    <span className="line-clamp-2 break-words">{children}</span>
  ) : (
    <span className="text-ink-meta">None</span>
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
        ? `${error} It is picked under Uploaded.`
        : `Uploaded ${file.name}. It is picked under Uploaded.`,
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
