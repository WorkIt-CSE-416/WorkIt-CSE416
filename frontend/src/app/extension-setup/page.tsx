import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "Set Up the Extension",
  description: "How to use the WorkIt extension to autofill job applications.",
};

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: "Sign in to WorkIt",
    body: "The extension has no sign-in of its own — it uses whichever WorkIt session is already open in your browser.",
  },
  {
    title: "Open a job posting",
    body: "Go to a job posting on a hiring system WorkIt fills, such as Greenhouse, Lever or Workday.",
  },
  {
    title: "Click the WorkIt icon",
    body: "Click the WorkIt icon in your Chrome toolbar. Pin it so it stays one click away.",
  },
  {
    title: "Press “Autofill This Page”",
    body: "Review every field it fills, then press the hiring system’s own Submit button yourself — WorkIt never submits for you.",
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

        <h1 className="text-title text-ink mt-4 text-center">Set Up the WorkIt Extension</h1>
        <p className="text-body text-ink-muted mt-2 text-center">
          The extension fills each application form in its own tab. You review every tab and press
          the form&apos;s Submit yourself; it never submits for you.
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

        <div className="mt-8 flex justify-center">
          <ButtonLink href="/login" size="lg">
            Open WorkIt
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
