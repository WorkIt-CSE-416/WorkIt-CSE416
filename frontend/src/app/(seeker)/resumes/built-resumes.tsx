"use client";

import { FileText } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { generateResume, listBuiltResumes, type BuiltResume } from "@/lib/built-resume-actions";
import { listResumes, type ResumeItem } from "@/lib/resume-actions";

import { BuiltResumeRow } from "./built-resume-row";
import { ResumesHeader } from "./header";
import { YourResumes } from "./your-resumes";

/**
 * The Resumes view of Resumes & Experiences: its header, with Generate
 * Resume beside the switcher, then the cards: Your Resumes (./your-
 * resumes.tsx: the base resumes, KAN-207, and the uploads with their
 * dropzone), and Tailored Resumes when there is one (KAN-217). The Sent
 * card (KAN-208) went on 2026-10-18: sent resumes are still kept, and a job
 * posting's page says which one the student sent there. The header is
 * drawn here because Generate changes this component's lists. Generate makes a base resume from the whole bank in
 * Jake's Resume, named "Resume #N" by the API until the student renames it.
 * The 5-resume limit is the API's: its refusal shows as the error.
 *
 * Each built resume is a row drawn as an uploaded one's is
 * (`components/resume-row.tsx`), and the whole row opens the resume
 * editor, which downloads it as a PDF or a Word file (KAN-258). Open and
 * Download were buttons on every row until then.
 */
export function BuiltResumes({
  initial,
  initialUploaded,
}: {
  initial: BuiltResume[];
  initialUploaded: ResumeItem[];
}) {
  const [resumes, setResumes] = useState(initial);
  const [uploaded, setUploaded] = useState(initialUploaded);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Both lists, every time: one primary star spans them.
  async function reload() {
    const [built, uploads] = await Promise.all([listBuiltResumes(), listResumes()]);
    if (built.data) setResumes(built.data);
    if (!uploads.error) setUploaded(uploads.resumes);
    setError(built.error ?? uploads.error);
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    const { error } = await generateResume();
    setGenerating(false);
    if (error) return setError(error);
    await reload();
  }

  // A tailored resume is made for one posting, so it has a card of its own
  // (KAN-258). Under the base resumes' card, then "Base Resumes", it was
  // told apart only by a Tailored tag and sat under a name it does not have.
  const base = resumes.filter((resume) => !resume.job_posting_id);
  const tailored = resumes.filter((resume) => resume.job_posting_id);

  return (
    <>
      {/* The view's primary action sits beside the switcher, as Fill With
          Scout does on Experiences; it was the base resumes' card's own. */}
      <ResumesHeader
        view="resumes"
        action={
          <Button size="sm" onClick={generate} disabled={generating}>
            <FileText /> {generating ? "Generating…" : "Generate Resume"}
          </Button>
        }
      />
      <div className="mt-4 flex flex-col gap-4">
        <YourResumes base={base} uploaded={uploaded} error={error} reload={reload} />
        {tailored.length > 0 && (
          <Card as="section" aria-labelledby="resumes-tailored">
            <h2 id="resumes-tailored" className="text-subtitle text-ink">
              Tailored Resumes
            </h2>
            <p className="text-note text-ink-meta mt-1">
              Made for one job posting, with Tailor My Resume on its page.
            </p>
            <ul role="list" className="flex flex-col">
              {tailored.map((resume) => (
                <BuiltResumeRow key={resume.id} resume={resume} reload={reload} />
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
