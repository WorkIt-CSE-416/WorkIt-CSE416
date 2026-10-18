import type { Metadata } from "next";
import { connection } from "next/server";

import { Logo } from "@/components/logo";
import { Stepper } from "@/components/stepper";
import { getBank } from "@/lib/bank-actions";
import { getSessionUser } from "@/lib/session";

import { SignedInAs } from "../signed-in-as";
import { ONBOARDING_STEPS } from "../steps";
import { BankStep } from "./bank-step";

export const metadata: Metadata = {
  title: "Experiences",
  description: "Tell Scout what you have done, one thing at a time.",
};

/**
 * /onboarding/applicant/bank, onboarding's last step (KAN-214): intake,
 * walking the sections from the start, after the profile form's Continue.
 * The title is "Experiences", the name students see for the experience bank
 * since KAN-249 (the glossary term stays "experience bank").
 *
 * The step rail is the wizard's, on its third step (../steps.ts), so the two
 * pages count one journey; intake's own bar below it counts the sections
 * within this step. The signed-in line at the foot is the wizard's too.
 *
 * The bank is read only to mark the sections already filled. If that read
 * fails the step still works from an empty bar: saving goes to the API.
 */
export default async function OnboardingBankPage() {
  await connection();
  const [{ data }, user] = await Promise.all([getBank(), getSessionUser()]);

  return (
    <main className="@container/main flex flex-1 justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-5xl">
        <div className="flex flex-col items-center text-center">
          <Logo size="card" />
          <Stepper
            size="lg"
            steps={ONBOARDING_STEPS}
            current={2}
            className="mt-6 w-full max-w-xl"
          />
          <h1 className="text-title text-ink mt-8">Experiences</h1>
          <p className="text-body text-ink-muted mt-1 max-w-md">
            Tell Scout about what you have done, and it drafts each entry for you. Skip anything you
            don&apos;t have. You can always add more later.
          </p>
        </div>

        <BankStep initial={data?.entries.map((e) => e.section) ?? []} />

        <SignedInAs email={user?.email ?? null} className="mt-10" />
      </div>
    </main>
  );
}
