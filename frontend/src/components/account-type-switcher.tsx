"use client";

import { useState } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/shadcn/toggle-group";

/**
 * Applicant or Company — which of the two account types a login or sign-up
 * form is for.
 *
 * A segmented ToggleGroup rather than a Select or a pair of radios: there are
 * exactly two options, both fit on one line, and the choice is worth showing
 * before the fields rather than hiding behind a closed control. Base UI gives
 * it arrow-key navigation and a single tab stop, which two buttons would not —
 * the same reason company/trend.tsx uses this component for its time range.
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
 * consumer — same reasoning as this file's siblings (nav-link, account-menu).
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
      <ToggleGroup
        value={[type]}
        /* Pressing the pressed item empties the array — Base UI treats a single
         * group as deselectable. An account type has no "neither", so an empty
         * change is dropped and the current choice stands. */
        onValueChange={([next]) => {
          if (next) setType(next as AccountTypeValue);
        }}
        aria-label="Account type"
        /* 0.5, not 0: a 2px gap that matches the track's p-0.5. Spacing 0
         * switches on the vendored item's joined-segment rules, which square
         * the inner corners of the pressed fill and outrank a className
         * radius. */
        spacing={0.5}
        size="lg"
        /* The top margin is here rather than at the call site because the
         * fragment has no element to hang it on, and this control has exactly
         * one home: the gap between the card's subtitle and its form. */
        className="border-border-subtle bg-surface rounded-control mt-5 w-full border p-0.5"
      >
        {TYPES.map(({ value, label }) => (
          <ToggleGroupItem
            key={value}
            value={value}
            /* aria-pressed is the state Base UI actually sets, so the pressed
             * fill has to be written against it to beat the vendored default.
             * Brand tint rather than a brand fill: the only solid brand on this
             * card is the submit button, and a chosen segment is not a second
             * action. The label darkens to --color-brand-ink because plain
             * --color-brand on this tint measures 4.43:1 — see the note in
             * globals.css. 5px is the track's inner radius (its 8px less the
             * 1px border and 2px padding), so the fill nests inside it. */
            className="text-body text-ink-muted hover:text-ink aria-pressed:bg-brand-tint aria-pressed:text-brand-ink flex-1 rounded-[5px]"
          >
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <input type="hidden" name="accountType" value={type} form={form} />
    </>
  );
}
