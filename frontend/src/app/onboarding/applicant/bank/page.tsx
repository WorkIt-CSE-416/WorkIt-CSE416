import type { Metadata } from "next";
import { connection } from "next/server";

import { Logo } from "@/components/logo";
import { getBank } from "@/lib/bank-actions";

import { BankStep } from "./bank-step";

export const metadata: Metadata = {
  title: "Experiences",
  description: "Tell WorkIt what you have done, one thing at a time.",
};

/**
 * /onboarding/applicant/bank, onboarding's second step (KAN-214): intake,
 * walking the sections from the start, after the profile form's Continue.
 * The title is "Experiences", the name students see for the experience bank
 * since KAN-249 (the glossary term stays "experience bank").
 *
 * The bank is read only to mark the sections already filled. If that read
 * fails the step still works from an empty bar: saving goes to the API.
 */
export default async function OnboardingBankPage() {
  await connection();
  const { data } = await getBank();

  return (
    <main className="@container/main flex flex-1 justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-5xl">
        <div className="flex flex-col items-center text-center">
          <Logo size="card" />
          <h1 className="text-title text-ink mt-4">Experiences</h1>
          <p className="text-body text-ink-muted mt-1 max-w-md">
            Tell WorkIt about what you have done, and it drafts each entry for you. Skip anything
            you don&apos;t have. You can always add more later.
          </p>
        </div>

        <BankStep initial={data?.entries.map((e) => e.section) ?? []} />
      </div>
    </main>
  );
}
