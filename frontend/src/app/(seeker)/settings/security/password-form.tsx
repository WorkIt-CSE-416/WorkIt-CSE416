"use client";

import { useActionState, useState } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/shadcn/dialog";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { changePassword, type PasswordState } from "@/lib/account-actions";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-rules";

const INITIAL: PasswordState = { error: null, changed: false };

/**
 * Change Password (or Set Password, for an account with no password yet)
 * behind a button, in a dialog: the form is rarely wanted, so the page shows
 * a row, not three empty fields. The dialog's content unmounts on close, so
 * each opening starts a fresh form. A change closes it with a toast.
 */
export function PasswordDialog({ hasPassword }: { hasPassword: boolean }) {
  const [open, setOpen] = useState(false);
  const label = hasPassword ? "Change Password" : "Set Password";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="secondary" size="sm">
            {label}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-subtitle font-semibold">{label}</DialogTitle>
          <DialogDescription>
            {hasPassword
              ? "Enter your current password, then the new one twice."
              : "Add a password so you can also sign in with your email."}
          </DialogDescription>
        </DialogHeader>
        <PasswordForm hasPassword={hasPassword} onChanged={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function PasswordForm({ hasPassword, onChanged }: { hasPassword: boolean; onChanged: () => void }) {
  const toast = useToast();
  // The success step runs in the action, once per change; an effect on the
  // state ran again on every render while the dialog closed.
  const [state, action, pending] = useActionState(
    async (prev: PasswordState, formData: FormData) => {
      const result = await changePassword(prev, formData);
      if (result.changed) {
        toast.show({
          message: hasPassword ? "Your password is changed." : "Your password is set.",
        });
        onChanged();
      }
      return result;
    },
    INITIAL,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      {hasPassword && (
        <TextField
          id="current-password"
          name="currentPassword"
          type="password"
          label="Current Password"
          autoComplete="current-password"
          required
        />
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
          aria-describedby="new-password-hint"
        />
        <p id="new-password-hint" className="text-meta text-ink-meta">
          At least {PASSWORD_MIN_LENGTH} characters
        </p>
      </div>
      <TextField
        id="confirm-password"
        name="confirmPassword"
        type="password"
        label="Confirm New Password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
      />

      {state.error && (
        <p role="alert" className="text-meta text-danger">
          {state.error}
        </p>
      )}

      <DialogFooter>
        <DialogClose render={<Button variant="secondary">Cancel</Button>} />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : hasPassword ? "Change Password" : "Set Password"}
        </Button>
      </DialogFooter>
    </form>
  );
}
