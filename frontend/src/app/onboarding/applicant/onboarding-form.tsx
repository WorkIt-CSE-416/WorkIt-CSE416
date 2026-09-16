"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { TextLink } from "@/components/ui/text-link";

import { EXPERTISE_SUGGESTIONS, JOB_TYPES, MOCK_RESUME_SKILLS } from "./data";
import { ExpertiseField } from "./expertise-field";
import { JobTypeField } from "./job-type-field";
import { ResumeUpload } from "./resume-upload";

/** How long the mock "parse" pretends to take. */
const ANALYZE_DELAY_MS = 900;

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
  const [detected, setDetected] = useState<string[] | null>(null);

  /* Analyzing is derived rather than its own state: a file is present and the
   * timer below has not resolved yet. That keeps the "start analyzing" and
   * "select a file" transitions atomic — one setState, not two racing to
   * happen together. */
  const analyzing = resumeFile !== null && detected === null;

  useEffect(() => {
    if (!resumeFile) return;

    const timer = setTimeout(() => setDetected([...MOCK_RESUME_SKILLS]), ANALYZE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [resumeFile]);

  function selectResume(file: File) {
    setResumeFile(file);
    setDetected(null);
  }

  function addExpertise(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setExpertise((current) =>
      current.some((v) => v.toLowerCase() === trimmed.toLowerCase())
        ? current
        : [...current, trimmed],
    );
  }

  function removeResume() {
    setResumeFile(null);
    setDetected(null);
  }

  function addDetectedSkill(skill: string) {
    addExpertise(skill);
    setDetected((current) => current?.filter((s) => s !== skill) ?? null);
  }

  function addAllDetectedSkills() {
    for (const skill of detected ?? []) addExpertise(skill);
    setDetected([]);
  }

  const canContinue = expertise.length > 0 && jobTypes.length > 0;

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
            onFileChange={selectResume}
            onRemove={removeResume}
            analyzing={analyzing}
            detected={detected}
            onAddSkill={addDetectedSkill}
            onAddAllSkills={addAllDetectedSkills}
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
        <Button size="lg" disabled={!canContinue} onClick={() => router.push("/jobs")}>
          Continue
        </Button>
      </div>
    </Card>
  );
}
