import type { Metadata } from "next";

import { Logo } from "@/components/logo";

import { ResumeStep } from "./resume-step";

export const metadata: Metadata = {
  title: "Your Resume",
  description: "Upload your resume, and WorkIt fills in your experiences from it.",
};

/**
 * /onboarding/applicant/resume, onboarding's second step: a resume upload,
 * after the profile form's Continue (KAN-275). It replaced intake's chat
 * (KAN-214), which still runs on the Experiences view. An upload, or Skip,
 * opens the Jobs page.
 */
export default function OnboardingResumePage() {
  return (
    <main className="flex flex-1 justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-xl">
        <div className="flex flex-col items-center text-center">
          <Logo size="card" />
          <h1 className="text-title text-ink mt-4">Your Resume</h1>
          <p className="text-body text-ink-muted mt-1 max-w-md">
            Upload your resume, and WorkIt fills in your experiences from it. No resume yet? Skip
            this step. You can upload one later on Resumes.
          </p>
        </div>

        <ResumeStep />
      </div>
    </main>
  );
}
