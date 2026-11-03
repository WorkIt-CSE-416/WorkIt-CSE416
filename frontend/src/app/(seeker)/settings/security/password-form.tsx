"use client";

import { useActionState, useEffect, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { changePassword, type PasswordState } from "@/lib/account-actions";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-rules";

import { SettingsStep, StepActions, useSettingsStep } from "../settings-step";

const INITIAL: PasswordState = { error: null, changed: false };

/** Each field the action can name in an error, by its input's id. */
const FIELD_ID: Record<NonNullable<PasswordState["field"]>, string> = {
  currentPassword: "current-password",
  newPassword: "new-password",
  confirmPassword: "confirm-password",
};

/**
 * Change Password (or Set Password, for an account with no password yet)
 * behind a button, as a step of the Settings modal (../settings-step.tsx):
 * the form is rarely wanted, so the page shows a row, not three empty
 * fields. Each opening starts a fresh form. A change goes back to the
 * section with a toast.
 */
export function PasswordButton({ hasPassword }: { hasPassword: boolean }) {
  const step = useSettingsStep();
  const label = hasPassword ? "Change Password" : "Set Password";

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => step.open(<PasswordStep hasPassword={hasPassword} />)}
    >
      {label}
    </Button>
  );
}

function PasswordStep({ hasPassword }: { hasPassword: boolean }) {
  const { close } = useSettingsStep();
  const toast = useToast();
  const label = hasPassword ? "Change Password" : "Set Password";
  // The success step runs in the action, once per change; an effect on the
  // state ran again on every render while the form closed.
  const [state, action, pending] = useActionState(
    async (prev: PasswordState, formData: FormData) => {
      const result = await changePassword(prev, formData);
      if (result.changed) {
        toast.show({
          message: hasPassword ? "Your password is changed." : "Your password is set.",
        });
        close();
      }
      return result;
    },
    INITIAL,
  );

  // An error about one field takes the focus to that field.
  useEffect(() => {
    if (state.field) document.getElementById(FIELD_ID[state.field])?.focus();
  }, [state]);

  /** The error under `field`'s input, when it is that field's. */
  function errorFor(field: keyof typeof FIELD_ID): { props: object; line: ReactNode } {
    if (state.field !== field || !state.error) return { props: {}, line: null };
    const id = `${FIELD_ID[field]}-error`;
    return {
      props: { "aria-invalid": true, "aria-describedby": id },
      line: (
        <p id={id} className="text-note text-danger">
          {state.error}
        </p>
      ),
    };
  }
  const current = errorFor("currentPassword");
  const next = errorFor("newPassword");
  const confirm = errorFor("confirmPassword");

  return (
    <SettingsStep
      title={label}
      description={
        hasPassword
          ? "Enter your current password, then the new one twice."
          : "Add a password so you can also sign in with your email."
      }
    >
      <form action={action} className="flex flex-col gap-4">
        {hasPassword && (
          <div className="flex flex-col gap-1">
            <TextField
              id="current-password"
              name="currentPassword"
              type="password"
              label="Current Password"
              autoComplete="current-password"
              required
              {...current.props}
            />
            {current.line}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <TextField
            id="new-password"
            name="newPassword"
            type="password"
            label="New Password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            aria-describedby={
              next.line ? "new-password-error new-password-hint" : "new-password-hint"
            }
            aria-invalid={next.line ? true : undefined}
          />
          {next.line}
          <p id="new-password-hint" className="text-note text-ink-meta">
            At least {PASSWORD_MIN_LENGTH} characters
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <TextField
            id="confirm-password"
            name="confirmPassword"
            type="password"
            label="Confirm New Password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            {...confirm.props}
          />
          {confirm.line}
        </div>

        {state.error && !state.field && (
          <p role="alert" className="text-note text-danger">
            {state.error}
          </p>
        )}

        <StepActions>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : label}
          </Button>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
        </StepActions>
      </form>
    </SettingsStep>
  );
}
