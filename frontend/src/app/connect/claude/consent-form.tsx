"use client";

import { WarningCircleIcon } from "@phosphor-icons/react/ssr";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { connectClaude, type ConsentState } from "./actions";

const INITIAL_STATE: ConsentState = { error: null };

/** Allow and Deny: one form, the pressed button's `choice` says which. */
export function ConsentForm({ requestId }: { requestId: string }) {
  const [state, formAction, pending] = useActionState(connectClaude, INITIAL_STATE);
  return (
    <form action={formAction} className="mt-6 flex flex-col gap-2.5">
      <input type="hidden" name="request" value={requestId} />
      {state.error && (
        <p
          role="alert"
          className="text-label text-danger bg-danger-tint rounded-control flex items-start gap-2 px-3 py-2"
        >
          <WarningCircleIcon className="mt-px size-4 shrink-0" aria-hidden />
          {state.error}
        </p>
      )}
      <Button type="submit" name="choice" value="approve" disabled={pending}>
        Allow
      </Button>
      <Button type="submit" name="choice" value="deny" variant="secondary" disabled={pending}>
        Deny
      </Button>
    </form>
  );
}
