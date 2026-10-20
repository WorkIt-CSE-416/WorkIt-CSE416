"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { ClickableRow } from "@/components/clickable-row";
import { PdfIcon } from "@/components/icons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { SectionLink } from "@/components/ui/section-link";
import { listBuiltResumes, type BuiltResume } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";
import { previewResume } from "@/lib/preview-resume";
import { listResumes, type ResumeItem } from "@/lib/resume-actions";

/**
 * "Resume List" on the Auto Apply page: every resume the seeker has, since
 * auto apply picks one per application, never one for the whole run
 * (`auto-apply/architecture.md`, "The resume"): the resume tailored to that
 * job posting, else the default resume (POST .../applications/{job_id}/
 * resume, pick_resume). The note under the heading says so. The default is
 * one resume, built or uploaded: starring one clears the other, so at most
 * one row says Default.
 *
 * A TABLE (KAN-285), in the Live Activity table's frame: Resume (its name,
 * Default beside it), Type (Built, Tailored or Uploaded), Used For (the job
 * a tailored resume is for; any job for the rest) and Updated, every column
 * but Resume centred. It has no
 * filters or sorting: a seeker has a handful of resumes. A row opens on a
 * click anywhere, as Live Activity's do; its Open and Preview buttons went
 * (asked for 2026-10-20), as did the warning that no resume was the
 * default. Built resumes come first, in the API's order with the
 * default moved to the top, then uploaded resumes, the default first. A
 * built resume's row goes to the resume editor, as on /resumes; it never
 * downloads here, since every download keeps a sent resume
 * (frontend/CLAUDE.md). An uploaded one previews in a new tab
 * (previewResume). Choosing, building and deleting resumes stays on
 * /resumes (uploads too, since 2026-10-18), which Manage leads to.
 *
 * Both lists load on every visit (useResumes, held by ./auto-apply-panel.tsx,
 * since Start is off until there is a resume). A list that fails keeps what
 * loaded and says the rest didn't.
 */

export type Resumes = {
  built: BuiltResume[];
  uploaded: ResumeItem[];
  loading: boolean;
  /** One of the two lists failed to load. */
  someFailed: boolean;
};

/** The default first; otherwise the order the list came in. */
function defaultFirst<T extends { is_default: boolean }>(list: T[]): T[] {
  return [...list.filter((r) => r.is_default), ...list.filter((r) => !r.is_default)];
}

/** Both resume lists, read in the browser on every visit. */
export function useResumes(): Resumes {
  const [uploaded, setUploaded] = useState<ResumeItem[] | null>(null);
  const [built, setBuilt] = useState<BuiltResume[] | null>(null);
  const [uploadedFailed, setUploadedFailed] = useState(false);
  const [builtFailed, setBuiltFailed] = useState(false);

  useEffect(() => {
    listResumes()
      .then(({ resumes, error }) => {
        if (error) setUploadedFailed(true);
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

  return {
    built: defaultFirst(built ?? []),
    uploaded: defaultFirst((uploaded ?? []).filter((r) => r.storage_path)),
    loading: (built === null && !builtFailed) || (uploaded === null && !uploadedFailed),
    someFailed: (builtFailed && built === null) || (uploadedFailed && uploaded === null),
  };
}

/** Rows only exist after the client-side fetch, so this is the browser's own
 *  calendar day, never the server's UTC one. */
function dayOf(at: string | null) {
  return at ? new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
}

const TH = "px-4 text-note text-ink-meta font-medium";
const TD = "px-4 py-3 text-note text-ink";
/** Every column but Resume is centred, as in Live Activity. */
const CENTER = "text-center";
/** The name is frozen at the left while the rest scrolls, from 672px of
 *  page up, as Live Activity's Role is (./activity-list.tsx). */
const FROZEN =
  "z-1 bg-panel @2xl/main:sticky @2xl/main:left-0 @2xl/main:shadow-[1px_0_0_var(--color-border-subtle)]";

export function ResumeList({ resumes }: { resumes: Resumes }) {
  const [error, setError] = useState<string | null>(null);
  const { built, uploaded, loading, someFailed } = resumes;
  const count = built.length + uploaded.length;

  async function handlePreview(resume: ResumeItem) {
    setError(null);
    // No await before this call: it opens the PDF's tab inside the click.
    const message = await previewResume(resume);
    if (message) setError(message);
  }

  return (
    <section aria-labelledby="resume-list" className="mt-8">
      <SectionHeading
        id="resume-list"
        action={
          <SectionLink href="/resumes" label="Manage your resumes">
            Manage
          </SectionLink>
        }
      >
        Resume List
      </SectionHeading>
      <p className="text-body text-ink-meta mt-1">
        Each application gets the resume tailored to its job, else your default resume.
      </p>

      <Card padding="none" className="mt-3 overflow-hidden">
        {loading ? (
          // A row's height, so nothing jumps when the list arrives.
          <div aria-hidden="true" className="bg-well m-3 h-12 animate-pulse rounded-md" />
        ) : count > 0 ? (
          <Table className="min-w-[40rem] table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={cn(TH, FROZEN)}>Resume</TableHead>
                <TableHead className={cn(TH, CENTER, "w-28")}>Type</TableHead>
                <TableHead className={cn(TH, CENTER, "w-48")}>Used For</TableHead>
                <TableHead className={cn(TH, CENTER, "w-24")}>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {built.map((resume) => (
                <BuiltRow key={`built:${resume.id}`} resume={resume} />
              ))}
              {uploaded.map((resume) => (
                <UploadedRow
                  key={`uploaded:${resume.id}`}
                  resume={resume}
                  onPreview={() => handlePreview(resume)}
                />
              ))}
            </TableBody>
          </Table>
        ) : (
          // None, or nothing loaded: said in grey, so a failed load is not
          // read as "none".
          <div className="flex items-center gap-3 px-4 py-3">
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
      </Card>

      {count > 0 && someFailed && (
        <p role="alert" className="text-note text-ink-meta mt-2">
          Some of your resumes didn&apos;t load. Refresh the page to see them all.
        </p>
      )}
      {error && (
        <p role="alert" className="text-meta text-danger mt-2">
          {error}
        </p>
      )}
    </section>
  );
}

/** The Resume cell: the file glyph, the name (cut, whole on hover) and the
 *  Default badge. `name` is the row's link or button, the part a keyboard
 *  reaches; the row takes a click anywhere. */
function NameCell({ name, isDefault }: { name: ReactNode; isDefault: boolean }) {
  return (
    <TableCell className={cn(TD, FROZEN, "group-hover/row:bg-hover transition-colors")}>
      <div className="flex min-w-0 items-center gap-3">
        <PdfIcon className="size-5 shrink-0" />
        {name}
        {isDefault && <Badge>Default</Badge>}
      </div>
    </TableCell>
  );
}

const NAME =
  "text-label text-ink hover:text-brand focus-visible:ring-brand-ring min-w-0 truncate rounded-xs text-left font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none";

/** A base or tailored resume, built from the bank. The row opens it in the
 *  resume editor. */
function BuiltRow({ resume }: { resume: BuiltResume }) {
  const href = `/resumes/${encodeURIComponent(resume.id)}`;
  const tailored = resume.job_posting_id != null;
  const usedFor = tailored
    ? [resume.posting_title, resume.posting_company].filter(Boolean).join(" at ") || "One job"
    : "Any job";
  return (
    <ClickableRow href={href} className="hover:bg-hover">
      <NameCell
        name={
          <Link href={href} title={resume.name} className={NAME}>
            {resume.name}
          </Link>
        }
        isDefault={resume.is_default}
      />
      <TableCell className={cn(TD, CENTER)}>
        {tailored ? <Badge variant="tag">Tailored</Badge> : <Badge variant="tag">Built</Badge>}
      </TableCell>
      <TableCell className={cn(TD, CENTER, !tailored && "text-ink-meta")}>
        <p className="truncate" title={usedFor}>
          {usedFor}
        </p>
        {resume.posting_closed && <p className="text-ink-meta mt-0.5">Job posting closed</p>}
      </TableCell>
      <TableCell className={cn(TD, CENTER)}>{dayOf(resume.edited_at)}</TableCell>
    </ClickableRow>
  );
}

/** An uploaded resume. The row previews a PDF in a new tab and downloads a
 *  DOCX. Not a ClickableRow: the preview opens its tab inside the click
 *  (previewResume), so the row calls it rather than following a link. A
 *  click on the name's button is the button's alone, so it runs once. */
function UploadedRow({ resume, onPreview }: { resume: ResumeItem; onPreview: () => void }) {
  const name = resume.original_filename ?? "Resume";
  const action = resume.storage_path.endsWith(".pdf") ? "Preview" : "Download";
  return (
    <TableRow
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a, button")) return;
        onPreview();
      }}
      className="group/row hover:bg-hover cursor-pointer"
    >
      <NameCell
        name={
          <button type="button" onClick={onPreview} title={`${action} ${name}`} className={NAME}>
            {name}
          </button>
        }
        isDefault={resume.is_default}
      />
      <TableCell className={cn(TD, CENTER)}>
        <Badge variant="tag">Uploaded</Badge>
      </TableCell>
      <TableCell className={cn(TD, CENTER, "text-ink-meta")}>Any job</TableCell>
      <TableCell className={cn(TD, CENTER)}>{dayOf(resume.created_at) ?? "Not known"}</TableCell>
    </TableRow>
  );
}
