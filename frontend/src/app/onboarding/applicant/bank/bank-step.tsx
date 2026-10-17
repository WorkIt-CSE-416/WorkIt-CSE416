"use client";

import { useState } from "react";

import { Intake } from "@/app/(seeker)/bank/intake";
import { ButtonLink } from "@/components/ui/button";
import { TextLink } from "@/components/ui/text-link";
import { getBank, type Section } from "@/lib/bank-actions";

/** Intake as an onboarding step: it always walks, and the step bar shows the
 *  profile form as a step already done. Finish opens the Jobs page, whose
 *  Recommended view scores the jobs the saved preferences keep against the
 *  bank just filled (KAN-231); the unsaved draft stays in the browser for the
 *  bank page to pick up. */
export function BankStep({ initial }: { initial: Section[] }) {
  const [filled, setFilled] = useState(initial);

  async function reload(): Promise<string | null> {
    const { data, error } = await getBank();
    if (data) setFilled(data.entries.map((e) => e.section));
    return error;
  }

  return (
    <div className="mt-6 flex flex-col gap-5">
      <Intake filled={filled} onSaved={reload} walk lead="Profile" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TextLink href="/onboarding/applicant">Back to Profile</TextLink>
        <ButtonLink href="/jobs" size="lg">
          Finish
        </ButtonLink>
      </div>
    </div>
  );
}
