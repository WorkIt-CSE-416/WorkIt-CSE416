"use client";

import { useState } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/shadcn/toggle-group";

/**
 * Applicant or Company — which of the two account types is signing in.
 *
 * A segmented ToggleGroup rather than a Select or a pair of radios: there are
 * exactly two options, both fit on one line, and the choice is worth showing
 * before the fields rather than hiding behind a closed control. Base UI gives
 * it arrow-key navigation and a single tab stop, which two buttons would not —
 * the same reason company/trend.tsx uses this component for its time range.
 *
 * FRONT END ONLY. Nothing here decides what a company may see or where either
 * type lands after signing in; that is the auth ticket's job, and the note in
 * ./actions.ts already says where the guard belongs. What this does do is carry
 * its value into the form as a hidden field, so the choice arrives with the
 * submission instead of being a decoration the next ticket has to rewire.
 *
 * The hidden input sits outside <form> and is associated by its `form`
 * attribute, because the switcher is rendered above the form rather than in it.
 */
const TYPES = [
  { value: "applicant", label: "Applicant" },
  { value: "company", label: "Company" },
] as const;

export function AccountTypeSwitcher({ form }: { form: string }) {
  const [type, setType] = useState<string>(TYPES[0].value);

  return (
    <>
      <ToggleGroup
        value={[type]}
        /* Pressing the pressed item empties the array — Base UI treats a single
         * group as deselectable. An account type has no "neither", so an empty
         * change is dropped and the current choice stands. */
        onValueChange={([next]) => {
          if (next) setType(next);
        }}
        aria-label="Account type"
        spacing={0}
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
             * card is Sign In, and a chosen segment is not a second action.
             * The label darkens to --color-brand-ink because plain --color-brand
             * on this tint measures 4.43:1 — see the note in globals.css. */
            className="text-body text-ink-muted hover:text-ink aria-pressed:bg-brand-tint aria-pressed:text-brand-ink flex-1 rounded-[6px]"
          >
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <input type="hidden" name="accountType" value={type} form={form} />
    </>
  );
}
