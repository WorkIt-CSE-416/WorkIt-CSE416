"use client";

import { useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { changeEmail, type EmailState } from "@/lib/account-actions";

import { SettingsStep, StepActions, useSettingsStep } from "../settings-step";

const INITIAL: EmailState = { error: null, sentTo: null };

/**
 * Change Email behind a button, as a step of the Settings modal
 * (../settings-step.tsx). Nothing changes when the form is sent: Supabase
 * emails a confirm link, so the step then says where to look, and
 * Sign-In & Security says so again when the link brings the student back
 * (./notice). Each opening starts a fresh form.
 */
export function EmailButton({ current }: { current: string }) {
  const step = useSettingsStep();
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => step.open(<EmailStep current={current} />)}
    >
      Change
    </Button>
  );
}

function EmailStep({ current }: { current: string }) {
  const { close } = useSettingsStep();
  const [state, action, pending] = useActionState(changeEmail, INITIAL);
  const field = useRef<HTMLInputElement>(null);
  const done = useRef<HTMLButtonElement>(null);

  // A refused email takes the focus back to its field; a sent one moves
  // it to Done, since the form it was in is gone.
  useEffect(() => {
    if (state.sentTo) done.current?.focus();
    else if (state.error) field.current?.focus();
  }, [state]);

  if (state.sentTo) {
    return (
      <SettingsStep
        title="Check Your Email"
        description={
          <>
            We sent a link to <span className="text-ink font-medium">{state.sentTo}</span>. Your
            sign-in email changes after you open it. If a link also comes to {current}, open that
            one too.
          </>
        }
      >
        <StepActions>
          <Button ref={done} onClick={close}>
            Done
          </Button>
        </StepActions>
      </SettingsStep>
    );
  }

  return (
    <SettingsStep
      title="Change Sign-In Email"
      description={
        <>
          You sign in with {current} now. The email employers see is on your Profile, under Contact
          &amp; Links.
        </>
      }
    >
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <TextField
            ref={field}
            id="new-email"
            name="email"
            type="email"
            label="New Email"
            autoComplete="email"
            maxLength={100}
            required
            defaultValue=""
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? "new-email-error" : undefined}
          />
          {state.error && (
            <p id="new-email-error" className="text-note text-danger">
              {state.error}
            </p>
          )}
        </div>
        <StepActions>
          <Button type="submit" disabled={pending}>
            {pending ? "Sending…" : "Send Link"}
          </Button>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
        </StepActions>
      </form>
    </SettingsStep>
  );
}
