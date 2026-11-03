"use client";

import { useState, useTransition } from "react";

import { TrashIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { deleteAccount } from "@/lib/account-actions";
import { clearLocalDrafts } from "@/lib/local-drafts";

import { SettingsStep, StepActions, useSettingsStep } from "../settings-step";

/**
 * Delete Account and its confirmation, a step of the Settings modal
 * (../settings-step.tsx). The delete is final, so the step asks the
 * student to type their email first: one click on a red button is too
 * easy to make by mistake. On success the action signs out and opens the
 * landing page; on failure the step stays open with the error.
 */
export function DeleteAccount({ email }: { email: string }) {
  const step = useSettingsStep();
  return (
    <Button
      variant="destructive"
      size="sm"
      className="self-start"
      onClick={() => step.open(<DeleteStep email={email} />)}
    >
      <TrashIcon />
      Delete Account
    </Button>
  );
}

function DeleteStep({ email }: { email: string }) {
  const { close } = useSettingsStep();
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
    <SettingsStep
      title="Delete Your Account?"
      description={
        <>
          Your profile, resumes, experiences, applications and files go for good. Type{" "}
          <span className="text-ink font-medium break-all">{email}</span> to confirm.
        </>
      }
    >
      <TextField
        id="confirm-email"
        label="Email"
        type="email"
        autoComplete="off"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
      />

      {error && (
        <p role="alert" className="text-note text-danger">
          {error}
        </p>
      )}

      <StepActions>
        <Button variant="destructive" onClick={remove} disabled={!confirmed || deleting}>
          Delete Account
        </Button>
        <Button variant="secondary" onClick={close}>
          Keep My Account
        </Button>
      </StepActions>
    </SettingsStep>
  );
}
