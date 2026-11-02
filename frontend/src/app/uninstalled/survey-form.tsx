"use client";

import { WarningCircleIcon } from "@phosphor-icons/react/ssr";
import { useActionState } from "react";

import { TextAreaField } from "@/components/text-area-field";
import { Button, ButtonLink } from "@/components/ui/button";
import { FIELD_LABEL } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

import { sendAnswer, type SurveyState } from "./actions";
import { DETAIL_MAX, REASONS } from "./answer";

const INITIAL_STATE: SurveyState = { sent: false, error: null };

const optionRow =
  "hover:bg-hover has-checked:border-brand border-border rounded-control text-body text-ink flex cursor-pointer items-center gap-3 border px-3 py-2";

/** The survey's one question and its Send; a thank-you once sent. */
export function SurveyForm({ version }: { version: string | null }) {
  const [state, formAction, pending] = useActionState(sendAnswer, INITIAL_STATE);

  if (state.sent) {
    return (
      <div className="mt-6 text-center" role="status">
        <p className="text-body text-ink">Thanks. We read every answer.</p>
        <ButtonLink href="/" size="lg" className="mt-6">
          Back to WorkIt
        </ButtonLink>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      {version && <input type="hidden" name="version" value={version} />}
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className={cn(FIELD_LABEL, "mb-0.5")}>Pick One</legend>
        {REASONS.map((reason) => (
          <label key={reason.value} className={optionRow}>
            <input
              type="radio"
              name="reason"
              value={reason.value}
              required
              className="accent-brand shrink-0"
            />
            <span className="min-w-0 break-words">{reason.label}</span>
          </label>
        ))}
      </fieldset>

      <TextAreaField
        id="detail"
        name="detail"
        label="Anything Else?"
        hint="Optional. Leave out your name and email."
        rows={3}
        maxLength={DETAIL_MAX}
      />

      {state.error && (
        <p
          role="alert"
          className="text-label text-danger bg-danger-tint rounded-control flex items-start gap-2 px-3 py-2"
        >
          <WarningCircleIcon className="mt-px size-4 shrink-0" aria-hidden />
          {state.error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Sending…" : "Send Answer"}
      </Button>
    </form>
  );
}
