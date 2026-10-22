"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { INITIAL_RESEND_STATE, resendConfirmation } from "./actions";

/** The one control on /signup/check-email: resend the confirmation email
 *  to the address signup just used. No client-side cooldown — Supabase's
 *  own send-rate-limit is the real backstop (the action's 429 branch). */
export function CheckEmailForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(resendConfirmation, INITIAL_RESEND_STATE);

  return (
    <form action={formAction} className="mt-6">
      <input type="hidden" name="email" value={email} />
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Resend Email"}
      </Button>
      {state.message && (
        <p
          role={state.status === "error" ? "alert" : undefined}
          className={`text-meta mt-3 text-center ${state.status === "error" ? "text-danger" : "text-positive-ink"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
