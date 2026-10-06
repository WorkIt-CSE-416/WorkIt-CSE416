"use client";

import { CircleAlert } from "lucide-react";
import { useActionState } from "react";

import { ArrowRightIcon, LockIcon, MailIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";

import { signIn, type LoginState } from "./actions";

const INITIAL_STATE: LoginState = { error: null, email: "" };

/**
 * The interactive half of /login — split out from page.tsx, same reasoning
 * as signup/signup-form.tsx: useActionState requires a Client Component,
 * and AccountTypeSwitcher targets this form by id from outside it.
 */
export function LoginForm({ formId }: { formId: string }) {
  const [state, formAction, pending] = useActionState(signIn, INITIAL_STATE);

  // The error never says which field was wrong (see actions.ts), so it marks
  // both and both point at it.
  const invalid = state.error ? true : undefined;
  const describedBy = state.error ? "login-error" : undefined;

  return (
    <form id={formId} action={formAction} className="mt-5 flex flex-col">
      <div className="flex flex-col gap-2.5">
        <TextField
          id="email"
          name="email"
          type="email"
          label="Email Address"
          icon={MailIcon}
          autoComplete="email"
          required
          defaultValue={state.email}
          aria-invalid={invalid}
          aria-describedby={describedBy}
        />

        {/* No "Forgot password?" in the label row until a reset flow exists:
            the link opened a bare 404 for the people already stuck. */}
        <TextField
          id="password"
          name="password"
          type="password"
          label="Password"
          icon={LockIcon}
          autoComplete="current-password"
          required
          aria-invalid={invalid}
          aria-describedby={describedBy}
        />
      </div>

      {state.error && (
        <p
          id="login-error"
          role="alert"
          className="text-label text-danger bg-danger-tint rounded-control mt-2.5 flex items-start gap-2 px-3 py-2"
        >
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
          {state.error}
        </p>
      )}

      <Button type="submit" size="lg" className="mt-2.5" disabled={pending}>
        {pending ? "Signing In…" : "Sign In"}
        <ArrowRightIcon className="size-4" />
      </Button>
    </form>
  );
}
