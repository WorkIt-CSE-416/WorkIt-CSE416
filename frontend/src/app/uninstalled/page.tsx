import type { Metadata } from "next";

import { Logo } from "@/components/logo";

import { SurveyForm } from "./survey-form";

export const metadata: Metadata = {
  title: "Why Did You Remove WorkIt?",
  description: "One question about why you removed the WorkIt extension.",
  robots: { index: false },
};

/**
 * /uninstalled: the page Chrome opens when a student removes the WorkIt
 * extension (KAN-471; the extension's install.js sets it with
 * chrome.runtime.setUninstallURL). One question, Why did you remove WorkIt?,
 * and an optional line; the answer goes to `POST /uninstall-answers` with
 * no account (./actions). Public and outside both shells, like /login: the
 * student may be signed out, and the page asks no sign-in. `?v=` is the
 * extension version removed, kept with the answer.
 */
export default async function UninstalledPage({ searchParams }: PageProps<"/uninstalled">) {
  const { v } = await searchParams;
  return (
    <main className="flex flex-1 items-start justify-center px-6 py-10 lg:pt-[12vh]">
      <div className="max-w-auth rounded-card border-border bg-surface shadow-card w-full border p-6">
        <Logo size="card" className="mx-auto" />
        <h1 className="text-title text-ink mt-2.5 text-center">Why Did You Remove WorkIt?</h1>
        <p className="text-body text-ink-muted mt-1 text-center">
          One question. We don&apos;t ask who you are.
        </p>
        <SurveyForm version={typeof v === "string" ? v : null} />
      </div>
    </main>
  );
}
