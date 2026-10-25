"use client";

import { useState, useTransition } from "react";

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
import { TrashIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { deleteAccount } from "@/lib/account-actions";
import { clearLocalDrafts } from "@/lib/local-drafts";

/**
 * Delete Account and its confirmation. The delete is final, so the dialog
 * asks the student to type their email first: one click on a red button
 * is too easy to make by mistake. On success the action signs out and
 * opens the landing page; on failure the dialog stays open with the error.
 */
export function DeleteAccount({ email }: { email: string }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, startDeleting] = useTransition();
  const confirmed = email !== "" && typed.trim().toLowerCase() === email.toLowerCase();

  function remove() {
    setError(null);
    startDeleting(async () => {
      // Drafts belong to this student alone (lib/local-drafts.ts).
      clearLocalDrafts();
      const result = await deleteAccount();
      if (result?.error) setError(result.error);
    });
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setTyped("");
          setError(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="destructive" size="sm" className="self-start">
            <TrashIcon />
            Delete Account
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-subtitle font-semibold">Delete Your Account?</DialogTitle>
          <DialogDescription>
            Your profile, resumes, experiences, applications and files go for good. Type{" "}
            <span className="text-ink font-medium break-all">{email}</span> to confirm.
          </DialogDescription>
        </DialogHeader>

        <TextField
          id="confirm-email"
          label="Email"
          type="email"
          autoComplete="off"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />

        {error && (
          <p role="alert" className="text-meta text-danger">
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Keep My Account</Button>} />
          <Button variant="destructive" onClick={remove} disabled={!confirmed || deleting}>
            Delete Account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
