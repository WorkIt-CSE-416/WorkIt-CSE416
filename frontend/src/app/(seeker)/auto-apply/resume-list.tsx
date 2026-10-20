"use client";

import { FilePen, FileText, Pause, Play, Zap } from "lucide-react";
import { useEffect, useState } from "react";

import { PdfIcon } from "@/components/icons";
import { RESUME_ROW } from "@/components/resume-row";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { SectionLink } from "@/components/ui/section-link";
import { listBuiltResumes, type BuiltResume } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";
import { previewResume } from "@/lib/preview-resume";
import { listResumes, type ResumeItem } from "@/lib/resume-actions";

import type { RunState } from "./auto-apply-panel";

/**
 * "Resume List" at the top of the Auto Apply page: every resume the seeker
 * has, since auto apply picks one per application, never one for the whole
 * run (`auto-apply/architecture.md`, "The resume"): the resume tailored to
 * that job posting, else the default resume (POST .../applications/{job_id}/
 * resume, pick_resume). The note under the heading says so. The default is
 * one resume, built or uploaded: starring one clears the other, so at most
 * one row says Default. With resumes but no default, a second note says to
 * star one, since the run then attaches none.
 *
 * Built resumes come first, in the API's order with the default moved to
 * the top, then uploaded resumes, the default first. A built resume opens in the resume editor,
 * as on /resumes; it never downloads here: downloads live in the editor.
 * An uploaded one previews in a new tab
 * (previewResume). Choosing, building and deleting resumes stays on /resumes
 * (uploads too, since 2026-10-18), which Manage leads to.
 *
 * Both lists load on every visit. A list that fails keeps what loaded and
 * says the rest didn't.
 *
 * The button beside the list starts and pauses auto apply; Start queues a
 * batch of matches. The state lives in ./auto-apply-panel.tsx, since Live
 * Activity's heading shows it too.
 * Paused, Resume is the brand fill again; running, Pause steps back to the
 * bordered neutral, so the brand fill always marks the action that starts work.
 */
const RUN_BUTTON: Record<
  RunState,
  { label: string; variant: "default" | "secondary"; Icon: typeof Zap }
> = {
  idle: { label: "Start Auto Apply", variant: "default", Icon: Zap },
  running: { label: "Pause Auto Apply", variant: "secondary", Icon: Pause },
  paused: { label: "Resume Auto Apply", variant: "default", Icon: Play },
};

/** RESUME_ROW without its top margin: the list's gap spaces the rows, so
 *  the first row's top meets the button's. */
const ROW = cn(RESUME_ROW, "mt-0");

/** Rows only exist after the client-side fetch, so this is the browser's own
 *  calendar day, never the server's UTC one. */
function uploadedOn(createdAt: string | null) {
  if (!createdAt) return "Uploaded";
  return `Uploaded ${new Date(createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/** The default first; otherwise the order the list came in. */
function defaultFirst<T extends { is_default: boolean }>(list: T[]): T[] {
  return [...list.filter((r) => r.is_default), ...list.filter((r) => !r.is_default)];
}

export function ResumeList({
  run,
  pending,
  onToggle,
}: {
  run: RunState;
  /** A batch is being queued: the button holds still until it lands. */
  pending: boolean;
  onToggle: () => void;
}) {
  const [uploaded, setUploaded] = useState<ResumeItem[] | null>(null);
  const [built, setBuilt] = useState<BuiltResume[] | null>(null);
  const [uploadedFailed, setUploadedFailed] = useState(false);
  const [builtFailed, setBuiltFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listResumes()
      .then(({ resumes, error: listError }) => {
        if (listError) setUploadedFailed(true);
        else setUploaded(resumes);
      })
      .catch(() => setUploadedFailed(true));
    listBuiltResumes()
      .then(({ data }) => {
        if (data) setBuilt(data);
        else setBuiltFailed(true);
      })
      .catch(() => setBuiltFailed(true));
  }, []);

  async function handlePreview(resume: ResumeItem) {
    setError(null);
    // No await before this call: it opens the PDF's tab inside the click.
    const message = await previewResume(resume);
    if (message) setError(message);
  }

  const loading = (built === null && !builtFailed) || (uploaded === null && !uploadedFailed);
  const builtRows = defaultFirst(built ?? []);
  const uploadedRows = defaultFirst((uploaded ?? []).filter((r) => r.storage_path));
  const count = builtRows.length + uploadedRows.length;
  const hasDefault = builtRows.some((r) => r.is_default) || uploadedRows.some((r) => r.is_default);
  const someFailed = (builtFailed && built === null) || (uploadedFailed && uploaded === null);

  const button = RUN_BUTTON[run];

  return (
    <section aria-labelledby="resume-list" className="mt-6 max-w-2xl">
      {/* A grid, so the button's top meets the first row's whatever the
          list's length: the heading spans the first track, the list and the
          button share the second. The button is lg (48px), the page's one
          main action: stretched to a row's 52px it was the largest button in
          the app (KAN-251). It is 208px wide, the widest label's, so Start
          becoming Pause shifts nothing. On a phone it drops under the list at
          full width. */}
      <div className="grid grid-cols-1 gap-x-3 @lg/main:grid-cols-[minmax(0,1fr)_13rem]">
        <div className="@lg/main:col-span-2">
          <div className="flex items-center justify-between gap-4">
            <h2 id="resume-list" className="text-label text-ink-meta">
              Resume List
            </h2>
            <SectionLink href="/resumes" label="Manage your resumes">
              Manage
            </SectionLink>
          </div>
          <p className="text-note text-ink-meta mt-1">
            Each application gets the resume tailored to its job, else your default resume.
          </p>
        </div>

        <div className="mt-2 min-w-0">
          {loading ? (
            // The same 52px box as a row, so nothing jumps when the list arrives.
            <div aria-hidden="true" className="bg-well rounded-control h-13 animate-pulse" />
          ) : count > 0 ? (
            <ul role="list" className="flex flex-col gap-2">
              {builtRows.map((resume) => (
                <BuiltRow key={`built:${resume.id}`} resume={resume} />
              ))}
              {uploadedRows.map((resume) => (
                <UploadedRow
                  key={`uploaded:${resume.id}`}
                  resume={resume}
                  onPreview={() => handlePreview(resume)}
                />
              ))}
            </ul>
          ) : (
            // None, or nothing loaded: the row's place in grey, so a failed
            // load is not read as "none".
            <div className={ROW}>
              <FileText aria-hidden className="text-ink-faint size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-label text-ink-muted truncate">
                  {someFailed ? "Your resumes didn't load" : "No resumes yet"}
                </p>
                <p className="text-note text-ink-meta">
                  {someFailed
                    ? "Refresh the page to see them here."
                    : "Generate or upload one on Resumes."}
                </p>
              </div>
            </div>
          )}
          {count > 0 && !hasDefault && !someFailed && (
            <p className="text-note text-ink-meta mt-2">
              None is your default yet, so a job with no tailored resume gets none. Star one on
              Resumes.
            </p>
          )}
          {count > 0 && someFailed && (
            <p role="alert" className="text-note text-ink-meta mt-2">
              Some of your resumes didn&apos;t load. Refresh the page to see them all.
            </p>
          )}
        </div>

        {/* Off until there is a resume to apply with, and while a batch is
            queueing. */}
        <Button
          variant={button.variant}
          size="lg"
          disabled={count === 0 || pending}
          onClick={onToggle}
          className="mt-3 w-full shrink-0 @lg/main:mt-2 @lg/main:w-52"
        >
          <button.Icon aria-hidden />
          {button.label}
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-meta text-danger mt-2">
          {error}
        </p>
      )}
    </section>
  );
}

/** A base or tailored resume, built from the bank. Open goes to the editor. */
function BuiltRow({ resume }: { resume: BuiltResume }) {
  const tailored = resume.job_posting_id != null;
  return (
    <li className={ROW}>
      <PdfIcon className="size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-label text-ink truncate">{resume.name}</p>
        <p className="text-note text-ink-meta">
          {tailored ? "Tailored to one job" : "Built from your bank"}
        </p>
      </div>
      {resume.is_default && <Badge>Default</Badge>}
      {tailored && <Badge variant="tag">Tailored</Badge>}
      {resume.posting_closed && <Badge tone="inert">Posting closed</Badge>}
      <ButtonLink
        variant="secondary"
        size="sm"
        href={`/resumes/${encodeURIComponent(resume.id)}`}
        className="shrink-0"
      >
        <FilePen /> Open
      </ButtonLink>
    </li>
  );
}

/** An uploaded resume. A PDF previews in a new tab; a DOCX downloads. */
function UploadedRow({ resume, onPreview }: { resume: ResumeItem; onPreview: () => void }) {
  const name = resume.original_filename ?? "Resume";
  const action = resume.storage_path.endsWith(".pdf") ? "Preview" : "Download";
  return (
    <li className={ROW}>
      <PdfIcon className="size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-label text-ink truncate">{name}</p>
        <p className="text-note text-ink-meta">{uploadedOn(resume.created_at)}</p>
      </div>
      {resume.is_default && <Badge>Default</Badge>}
      <Button
        variant="secondary"
        size="sm"
        onClick={onPreview}
        aria-label={`${action} ${name}`}
        className="shrink-0"
      >
        {action}
      </Button>
    </li>
  );
}
