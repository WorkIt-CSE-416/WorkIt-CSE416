"use client";

import { useState } from "react";

import { SegmentedToggle } from "@/components/ui/segmented-control";

/**
 * Applicant or Company — which of the two account types a login or sign-up
 * form is for.
 *
 * A segmented control (ui/segmented-control.tsx) rather than a Select or a
 * pair of radios: there are exactly two options, both fit on one line, and
 * the choice is worth showing before the fields rather than hiding behind a
 * closed control. It is the large size, at the card's full width, with the
 * same sliding thumb as every other segmented control in the app; Base UI
 * gives it arrow-key navigation and a single tab stop, which two buttons
 * would not.
 *
 * FRONT END ONLY. Nothing here decides what a company may see or where either
 * type lands after signing in or signing up; that is the auth ticket's job.
 * What this does do is carry its value into the form as a hidden field, so the
 * choice arrives with the submission instead of being a decoration the next
 * ticket has to rewire.
 *
 * The hidden input sits outside <form> and is associated by its `form`
 * attribute, because the switcher is rendered above the form rather than in it.
 *
 * Promoted from login/account-type.tsx the day signup became a second
 * consumer — same reasoning as its sibling account-menu.tsx.
 */
const TYPES = [
  { value: "applicant", label: "Applicant" },
  { value: "company", label: "Company" },
] as const;

export type AccountTypeValue = (typeof TYPES)[number]["value"];

/**
 * Uncontrolled by default (login only needs the hidden input). Pass `value`
 * and `onValueChange` when the screen has to react to the choice — signup
 * swaps its fields per type.
 */
export function AccountTypeSwitcher({
  form,
  value,
  onValueChange,
}: {
  form: string;
  value?: AccountTypeValue;
  onValueChange?: (next: AccountTypeValue) => void;
}) {
  const [ownType, setOwnType] = useState<AccountTypeValue>(TYPES[0].value);
  const type = value ?? ownType;
  const setType = (next: AccountTypeValue) => {
    setOwnType(next);
    onValueChange?.(next);
  };

  return (
    <>
      {/* The top margin is here rather than at the call site because the
          fragment has no element to hang it on, and this control has exactly
          one home: the gap between the card's subtitle and its form. */}
      <SegmentedToggle
        label="Account Type"
        options={[...TYPES]}
        value={type}
        onValueChange={(next) => setType(next as AccountTypeValue)}
        size="lg"
        className="mt-5 w-full"
      />

      <input type="hidden" name="accountType" value={type} form={form} />
    </>
  );
}
