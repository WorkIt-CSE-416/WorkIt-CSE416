"use client";

import { useActionState, useState } from "react";

import { LockIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { setPassword, type SetPasswordState } from "@/lib/password-actions";

const INITIAL_STATE: SetPasswordState = { error: null, success: false };

// Matches password-actions.ts's own floor — kept here too so the field's
// native validation message and the server's agree rather than one
// surprising the other.
const PASSWORD_MIN_LENGTH = 8;

/**
 * Sets a WorkIt password for the signed-in account — a credential Supabase
 * attaches to this account regardless of how the session was started, so it
 * works alongside (not instead of) a Google or LinkedIn sign-in. Shared by
 * (seeker)/settings and company/settings: the same two fields, the same
 * action, just each shell's Settings page around it.
 *
 * Password and Confirm Password are controlled, same pattern as
 * signup/signup-form.tsx, so the mismatch check can run before submission
 * without a round trip — confirmPassword itself never leaves this component.
 */
export function SetPasswordForm() {
  const [state, formAction, pending] = useActionState(setPassword, INITIAL_STATE);

  const [password, setPasswordValue] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmAttempted, setConfirmAttempted] = useState(false);
  const passwordsMismatch = password !== confirmPassword;

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (passwordsMismatch) {
          event.preventDefault();
          setConfirmAttempted(true);
        }
      }}
      className="mt-4 flex flex-col gap-2.5"
    >
      <TextField
        id="new-password"
        name="password"
        type="password"
        label="New Password"
        icon={LockIcon}
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={20}
        value={password}
        onChange={(event) => {
          setPasswordValue(event.target.value);
          setConfirmAttempted(false);
        }}
      />

      <div className="flex flex-col gap-1">
        <TextField
          id="confirm-new-password"
          name="confirmPassword"
          type="password"
          label="Confirm New Password"
          icon={LockIcon}
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(event) => {
            setConfirmPassword(event.target.value);
            setConfirmAttempted(false);
          }}
        />
        {confirmAttempted && passwordsMismatch && (
          <p className="text-meta text-danger">Passwords do not match.</p>
        )}
      </div>

      {state.error && <p className="text-meta text-danger">{state.error}</p>}
      {state.success && (
        <p className="text-meta text-positive-ink">
          Password set. You can now sign in with your email and this password too.
        </p>
      )}

      <Button type="submit" className="mt-1 self-start" disabled={pending}>
        {pending ? "Saving…" : "Set Password"}
      </Button>
    </form>
  );
}
