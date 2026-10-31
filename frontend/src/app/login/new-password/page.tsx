"use client";

import { WarningCircleIcon } from "@phosphor-icons/react/ssr";
import { useActionState, useState } from "react";

import { ArrowRightIcon, LockIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { SkylineBackdrop } from "@/components/skyline";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-rules";

import { updatePassword, type NewPasswordState } from "./actions";

const INITIAL: NewPasswordState = { error: null };

export default function NewPasswordPage() {
  const [state, formAction, pending] = useActionState(updatePassword, INITIAL);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [confirmAttempted, setConfirmAttempted] = useState(false);
  const mismatch = password !== confirm;
  const showError = confirmAttempted && mismatch;

  return (
    <main className="flex flex-1 items-start justify-center p-6 lg:pt-[12vh]">
      <SkylineBackdrop />
      <div className="max-w-auth rounded-card border-border bg-surface shadow-card w-full border p-6">
        <Logo size="card" className="mx-auto" />
        <h1 className="text-title text-ink mt-2.5 text-center">Set New Password</h1>
        <p className="text-body text-ink-muted mt-1 text-center">
          Choose a new password for your account
        </p>

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
              <p id="password-hint" className="text-meta text-ink-meta">
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
                <p id="confirm-error" role="alert" className="text-meta text-danger">
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
            {pending ? "Updating..." : "Update Password"}
            <ArrowRightIcon className="size-4" />
          </Button>
        </form>
      </div>
    </main>
  );
}
