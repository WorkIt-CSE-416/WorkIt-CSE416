import type { Metadata } from "next";

import { Logo } from "@/components/logo";

import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = {
  title: "Set Up Your Profile",
  description: "Tell us about your expertise so we can match you with the right roles.",
};

/**
 * /onboarding/applicant — where sign-up sends a new seeker before /jobs.
 *
 * Outside both shells, like /login: a first-time user has no top bar to sit
 * under yet. The card is wider than login's — three sections of real content
 * rather than a sign-in form — so it takes its own width instead of
 * <TextField>'s --container-auth.
 */
export default function ApplicantOnboardingPage() {
  return (
    <main className="flex flex-1 justify-center px-6 py-10">
      <div className="w-full max-w-2xl">
        <div className="flex flex-col items-center text-center">
          <Logo size="card" priority />
          <h1 className="text-title text-ink mt-4">Tell us about yourself</h1>
          <p className="text-body text-ink-muted mt-1 max-w-md">
            A few details so we can point you toward the right roles. You can always change this
            later from your profile.
          </p>
        </div>

        <OnboardingForm />
      </div>
    </main>
  );
}
