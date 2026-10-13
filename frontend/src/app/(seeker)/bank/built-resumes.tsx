"use client";

import { FileDown, FileText, Star, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import {
  deleteBuiltResume,
  downloadResumeDocx,
  generateResume,
  listBuiltResumes,
  renderResumePdf,
  setDefaultBuiltResume,
  type BuiltResume,
  type RenderedPdf,
} from "@/lib/built-resume-actions";

/**
 * The bank page's base resumes (KAN-207): Generate makes one from the whole
 * bank in Jake's Resume, and each downloads as a PDF or a Word file. A PDF
 * whose text has characters the font cannot draw shows a warning first; the
 * student downloads anyway or fixes the bank. The 5-resume limit is the
 * API's: its refusal shows as the error.
 */

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function save(base64: string, type: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const fileName = (resume: BuiltResume, ext: string) =>
  `${resume.name.replace(/[^\w -]+/g, "").trim() || "Resume"}.${ext}`;

export function BuiltResumes({ initial }: { initial: BuiltResume[] }) {
  const [resumes, setResumes] = useState(initial);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const { data, error } = await listBuiltResumes();
    if (data) setResumes(data);
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
    <Card as="section" aria-labelledby="bank-resumes" className="mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="bank-resumes" className="text-subtitle text-ink">
          Base Resumes
        </h2>
        <Button size="sm" onClick={generate} disabled={generating}>
          <FileText /> {generating ? "Generating…" : "Generate"}
        </Button>
      </div>
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
            <ResumeRow key={resume.id} resume={resume} reload={reload} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ResumeRow({ resume, reload }: { resume: BuiltResume; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState<"pdf" | "docx" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A rendered PDF held back by the missing-character warning
  const [held, setHeld] = useState<RenderedPdf | null>(null);

  async function pdf() {
    setBusy("pdf");
    setError(null);
    const { data, error } = await renderResumePdf(resume.id);
    setBusy(null);
    if (!data) return setError(error);
    if (data.missing_characters.length) return setHeld(data);
    save(data.pdf, "application/pdf", fileName(resume, "pdf"));
  }

  async function docx() {
    setBusy("docx");
    setError(null);
    const { data, error } = await downloadResumeDocx(resume.id);
    setBusy(null);
    if (!data) return setError(error);
    save(data, DOCX_TYPE, fileName(resume, "docx"));
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
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Button variant="secondary" size="sm" onClick={pdf} disabled={busy !== null}>
            <FileDown /> {busy === "pdf" ? "Making PDF…" : "PDF"}
          </Button>
          <Button variant="secondary" size="sm" onClick={docx} disabled={busy !== null}>
            <FileDown /> {busy === "docx" ? "Making Word…" : "Word"}
          </Button>
          {!resume.is_default && (
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
              onClick={() => {
                save(held.pdf, "application/pdf", fileName(resume, "pdf"));
                setHeld(null);
              }}
            >
              Download Anyway
            </Button>
            <Button variant="ghost" size="inline" onClick={() => setHeld(null)}>
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
