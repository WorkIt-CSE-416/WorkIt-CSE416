"use client";

import { WarningCircleIcon } from "@phosphor-icons/react/ssr";
import { useActionState, useState } from "react";

import { AuthCard } from "@/components/auth-card";
import { ArrowRightIcon, LockIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { TextLink } from "@/components/ui/text-link";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-rules";

import { updatePassword, type NewPasswordState } from "./actions";

const INITIAL: NewPasswordState = { error: null };

/**
 * The interactive half of /login/new-password, split from page.tsx so the page
 * can export its metadata. "Back to Sign In" is the card's way out: it had
 * none. The reset link signed the browser in, so /login sends it on to its
 * home (`redirectIfSignedIn`) with the old password still in place.
 */
export function NewPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, INITIAL);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [confirmAttempted, setConfirmAttempted] = useState(false);
  const mismatch = password !== confirm;
  const showError = confirmAttempted && mismatch;

  return (
    <AuthCard
      title="Set New Password"
      subtitle="Choose a new password for your account"
      footer={<TextLink href="/login">Back to Sign In</TextLink>}
    >
      <form
        action={formAction}
        onSubmit={(e) => {
          if (mismatch) {
            e.preventDefault();
            setConfirmAttempted(true);
          }
        }}
        className="mt-5 flex flex-col"
      >
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-1">
            <TextField
              id="password"
              name="password"
              type="password"
              label="New Password"
              icon={LockIcon}
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby="password-hint"
            />
            <p id="password-hint" className="text-note text-ink-meta">
              At least {PASSWORD_MIN_LENGTH} characters
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <TextField
              id="confirm-password"
              name="confirmPassword"
              type="password"
              label="Confirm New Password"
              icon={LockIcon}
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={showError || undefined}
              aria-describedby={showError ? "confirm-error" : undefined}
            />
            {showError && (
              <p id="confirm-error" role="alert" className="text-note text-danger">
                Passwords do not match.
              </p>
            )}
          </div>
        </div>

        {state.error && (
          <p
            role="alert"
            className="text-label text-danger bg-danger-tint rounded-control mt-2.5 flex items-start gap-2 px-3 py-2"
          >
            <WarningCircleIcon className="mt-px size-4 shrink-0" aria-hidden />
            {state.error}
          </p>
        )}

        <Button type="submit" size="lg" className="mt-2.5" disabled={pending}>
          {pending ? "Updating…" : "Update Password"}
          <ArrowRightIcon className="size-4" />
        </Button>
      </form>
    </AuthCard>
  );
}
