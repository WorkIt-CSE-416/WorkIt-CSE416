"use client";

import { FileDown, FilePen, FileText, Star, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import {
  deleteBuiltResume,
  generateResume,
  listBuiltResumes,
  setDefaultBuiltResume,
  type BuiltResume,
} from "@/lib/built-resume-actions";
import {
  deleteSentResume,
  listSentResumes,
  sendBuiltResume,
  type SentDownload,
  type SentResume,
} from "@/lib/sent-resume-actions";

import { openDownload, SentResumes } from "./sent-resumes";

/**
 * The bank page's base resumes (KAN-207): Generate makes one from the whole
 * bank in Jake's Resume, and each downloads as a PDF or a Word file. A PDF
 * whose text has characters the font cannot draw shows a warning first; the
 * student downloads anyway or fixes the bank. The 5-resume limit is the
 * API's: its refusal shows as the error. Open goes to the resume editor.
 *
 * Base resumes and Sent share one "Your Resumes" card, below the bank's
 * sections: they are what the bank makes, so the page leads with intake
 * and the title's "Your Resumes" button jumps here.
 *
 * Every download, PDF or Word, keeps a sent resume (KAN-208), shown in the
 * "Sent" list below; a repeat of the same content returns the one already
 * kept. A download cancelled at the warning deletes the sent resume it just
 * made.
 */

export function BuiltResumes({
  initial,
  initialSent,
}: {
  initial: BuiltResume[];
  initialSent: SentResume[];
}) {
  const [resumes, setResumes] = useState(initial);
  const [sent, setSent] = useState(initialSent);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const { data, error } = await listBuiltResumes();
    if (data) setResumes(data);
    if (error) setError(error);
  }

  async function reloadSent() {
    const { data, error } = await listSentResumes();
    if (data) setSent(data);
    if (error) setError(error);
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    const { error } = await generateResume();
    setGenerating(false);
    if (error) return setError(error);
    await reload();
  }

  return (
    <Card
      as="section"
      id="your-resumes"
      aria-labelledby="bank-resumes"
      className="mt-4 scroll-mt-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="bank-resumes" className="text-subtitle text-ink">
          Your Resumes
        </h2>
        <Button size="sm" onClick={generate} disabled={generating}>
          <FileText /> {generating ? "Generating…" : "Generate"}
        </Button>
      </div>
      <h3 className="text-label text-ink mt-3">Base Resumes</h3>
      <p className="text-note text-ink-meta mt-1">
        A resume in Jake&apos;s Resume with every entry in your bank. A fix in the bank shows on
        every resume.
      </p>
      {error && (
        <p role="alert" className="text-note text-danger mt-2">
          {error}
        </p>
      )}
      {resumes.length > 0 && (
        <ul role="list" className="divide-border-subtle mt-2 flex flex-col divide-y">
          {resumes.map((resume) => (
            <ResumeRow key={resume.id} resume={resume} reload={reload} reloadSent={reloadSent} />
          ))}
        </ul>
      )}
      <SentResumes sent={sent} reload={reloadSent} />
    </Card>
  );
}

function ResumeRow({
  resume,
  reload,
  reloadSent,
}: {
  resume: BuiltResume;
  reload: () => Promise<void>;
  reloadSent: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"pdf" | "docx" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A sent resume held back by the missing-character warning
  const [held, setHeld] = useState<SentDownload | null>(null);

  async function pdf() {
    setBusy("pdf");
    setError(null);
    const { data, error } = await sendBuiltResume(resume.id);
    setBusy(null);
    if (!data) return setError(error);
    if (data.missing_characters.length) return setHeld(data);
    openDownload(data.url);
    await reloadSent();
  }

  // The student did not take the file: it was not sent.
  async function cancel(held: SentDownload) {
    setHeld(null);
    if (!held.created) return;
    const { error } = await deleteSentResume(held.id);
    if (error) setError(error);
  }

  async function docx() {
    setBusy("docx");
    setError(null);
    const { data, error } = await sendBuiltResume(resume.id, "docx");
    setBusy(null);
    if (!data) return setError(error);
    openDownload(data.url);
    await reloadSent();
  }

  async function act(action: (id: string) => Promise<{ error: string | null }>) {
    setError(null);
    const { error } = await action(resume.id);
    if (error) return setError(error);
    await reload();
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <p className="text-body text-ink font-medium break-words">{resume.name}</p>
          {resume.is_default && <Badge>Default</Badge>}
          {resume.job_posting_id && <Badge variant="tag">Tailored</Badge>}
          {/* Story 90: the resume still opens and downloads; only Tailor needs a live posting. */}
          {resume.posting_closed && <Badge tone="inert">Posting closed</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <ButtonLink
            variant="secondary"
            size="sm"
            href={`/resumes/${encodeURIComponent(resume.id)}`}
          >
            <FilePen /> Open
          </ButtonLink>
          <Button variant="secondary" size="sm" onClick={pdf} disabled={busy !== null}>
            <FileDown /> {busy === "pdf" ? "Making PDF…" : "PDF"}
          </Button>
          <Button variant="secondary" size="sm" onClick={docx} disabled={busy !== null}>
            <FileDown /> {busy === "docx" ? "Making Word…" : "Word"}
          </Button>
          {/* Only a base resume can be the default (the API refuses a tailored one). */}
          {!resume.is_default && !resume.job_posting_id && (
            <IconButton
              label={`Make ${resume.name} the Default Resume`}
              tooltip="Make this the default resume"
              onClick={() => act(setDefaultBuiltResume)}
            >
              <Star className="size-4" />
            </IconButton>
          )}
          <IconButton
            label={`Delete ${resume.name}`}
            tooltip="Delete this resume"
            onClick={() => act(deleteBuiltResume)}
          >
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </div>
      {held && (
        <div role="alert" className="text-note text-ink-muted mt-2">
          <p>
            The PDF&apos;s font cannot show {held.missing_characters.join(" ")}. These characters
            will be missing from the PDF. Change them in your bank, or use the Word file.
          </p>
          <div className="mt-1.5 flex gap-3">
            <Button
              variant="ghost"
              size="inline"
              onClick={async () => {
                openDownload(held.url);
                setHeld(null);
                await reloadSent();
              }}
            >
              Download Anyway
            </Button>
            <Button variant="ghost" size="inline" onClick={() => cancel(held)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-note text-danger mt-2">
          {error}
        </p>
      )}
    </li>
  );
}
