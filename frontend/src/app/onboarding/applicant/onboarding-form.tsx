"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { TextLink } from "@/components/ui/text-link";

import { uploadResume } from "../../../lib/resume-actions";
import { EXPERTISE_SUGGESTIONS, JOB_TYPES } from "./data";
import { ExpertiseField } from "./expertise-field";
import { JobTypeField } from "./job-type-field";
import { ResumeUpload } from "../../../components/resume-upload";

/**
 * KAN-113 — the applicant half of onboarding. The business half is a stub
 * (../company/page.tsx) because what it needs is still undecided.
 *
 * NO BACKEND EXISTS YET, so nothing here is persisted: expertise, the resume
 * and job-type selections all live in this component's state and are lost on
 * navigation. What is real is the interaction itself — adding and removing
 * tags, dropping a file, toggling job types — and Continue, which actually
 * routes into the app, to /jobs. That is the "functionality" this ticket
 * asked for ahead of a backend to save to: signup can link here today, and wiring the
 * three fields into a real submission later touches only this file.
 *
 * Continue is disabled until both required fields hold something, so the
 * screen cannot be dismissed empty by mistake. Resume upload is the one field
 * the ticket calls optional, so it has no bearing on that gate.
 */
export function OnboardingForm() {
  const router = useRouter();

  const [expertise, setExpertise] = useState<string[]>([]);
  const [jobTypes, setJobTypes] = useState<string[]>([]);

  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function addExpertise(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setExpertise((current) =>
      current.some((v) => v.toLowerCase() === trimmed.toLowerCase())
        ? current
        : [...current, trimmed],
    );
  }

  const canContinue = expertise.length > 0 && jobTypes.length > 0;

  async function handleContinue() {
    if (resumeFile) {
      setUploading(true);
      setUploadError(null);
      const fd = new FormData();
      fd.append("file", resumeFile);
      const { error } = await uploadResume(fd);

      setUploading(false);
      if (error) {
        setUploadError(error);
        return;
      }
    }
    router.push("/jobs");
  }

  return (
    <Card padding="none" className="mt-6 w-full">
      <section className="p-5" aria-labelledby="expertise-heading">
        <SectionHeading id="expertise-heading">Areas of Expertise</SectionHeading>
        <p className="text-meta text-ink-meta mt-1">Pick from the list or type your own.</p>

        <div className="mt-3">
          <ExpertiseField
            id="expertise-input"
            labelledBy="expertise-heading"
            values={expertise}
            onChange={setExpertise}
            suggestions={EXPERTISE_SUGGESTIONS}
          />
        </div>
      </section>

      <hr className="border-border-subtle mx-5" />

      <section className="p-5" aria-labelledby="resume-heading">
        <SectionHeading
          id="resume-heading"
          action={<span className="text-meta text-ink-faint">Optional</span>}
        >
          Resume
        </SectionHeading>
        <p className="text-meta text-ink-meta mt-1">
          Upload your resume and we&apos;ll suggest skills to add above.
        </p>

        <div className="mt-3">
          <ResumeUpload
            file={resumeFile}
            onFileChange={setResumeFile}
            onRemove={() => setResumeFile(null)}
          />
        </div>
      </section>

      <hr className="border-border-subtle mx-5" />

      <section className="p-5" aria-labelledby="job-types-heading">
        <SectionHeading id="job-types-heading">Job Types You&apos;re Interested In</SectionHeading>
        <p className="text-meta text-ink-meta mt-1">Select every type you&apos;d consider.</p>

        <div className="mt-3">
          <JobTypeField
            labelledBy="job-types-heading"
            values={jobTypes}
            onChange={setJobTypes}
            options={JOB_TYPES}
          />
        </div>
      </section>

      <hr className="border-border-subtle mx-5" />

      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <TextLink href="/login">Back to Sign In</TextLink>
        <div className="flex items-center gap-3">
          {uploadError && <p className="text-meta text-red-600">{uploadError}</p>}
          <Button size="lg" disabled={!canContinue || uploading} onClick={handleContinue}>
            {uploading ? "Uploading\u2026" : "Continue"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
