import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "Set Up the Extension",
  description: "How to set up WorkIt's extension and account before your first autofill.",
};

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: "Turn off other autofillers, and pin WorkIt",
    body: "Turn off any other job-application autofiller (Simplify, Jobright, and similar tools), so only WorkIt fills your forms — two autofillers on one page can fight over the same field. Then pin WorkIt: click the puzzle-piece icon beside your address bar, then the pin beside WorkIt, so it stays one click away.",
  },
  {
    title: "Create your free WorkIt account",
    body: "Sign up with Google, LinkedIn, or your email — it takes a minute.",
  },
  {
    title: "Confirm your email, if you signed up with one",
    body: "Signed up with Google or LinkedIn? You're already confirmed — skip this. Signed up with email and password? Click the confirmation link WorkIt emails you before you sign in.",
  },
  {
    title: "Finish onboarding",
    body: "WorkIt walks you through your résumé, your school, and your job preferences.",
  },
  {
    title: "Add your experience",
    body: "Open the Resumes & Experiences page and add your work history and skills, so WorkIt has real detail to write into each application.",
  },
  {
    title: "Try the practice application, then go live",
    body: "Onboarding ends with a safe practice run — no real company sees it — so you can watch the extension work first. After that, open a real job posting, click the WorkIt icon, and press Autofill This Page. Review every field, then press the hiring site's own Submit yourself — WorkIt never submits for you.",
  },
];

/**
 * Reached right after a Chrome Web Store install (the extension's
 * background.js opens it on `onInstalled`) or on demand from the popup's
 * "Set Up WorkIt" button, signed in or not. Outside both the (seeker) and
 * (landing) groups — same tier as /connect/claude — since a just-installed
 * student may not be signed in yet, and this is instructional product UI,
 * not a marketing page.
 */
export default function ExtensionSetupPage() {
  return (
    <main className="flex flex-1 justify-center p-6 py-16">
      <div className="w-full max-w-2xl">
        <Logo size="card" className="mx-auto" />

        <h1 className="text-title text-ink mt-4 text-center">Thanks for Choosing WorkIt</h1>
        <p className="text-body text-ink-muted mt-2 text-center">
          We help make your job search easier and less stressful. Before WorkIt can start filling
          out applications for you, set up your browser with the steps below.
        </p>

        <ol className="mt-8 flex flex-col gap-4">
          {STEPS.map(({ title, body }, i) => (
            <Card as="li" key={title} padding="lg" className="flex gap-4">
              <span
                aria-hidden
                className="bg-brand-tint text-brand text-body flex size-8 shrink-0 items-center justify-center rounded-full font-semibold"
              >
                {i + 1}
              </span>
              <div className="text-body text-ink-muted flex min-w-0 flex-1 flex-col">
                <h2 className="text-subtitle text-ink mb-1">{title}</h2>
                {body}
              </div>
            </Card>
          ))}
        </ol>

        <div className="mt-8 flex justify-center gap-3">
          <ButtonLink href="/signup" size="lg">
            Create Your Account
          </ButtonLink>
          <ButtonLink href="/login" variant="secondary" size="lg">
            I Already Have One
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
