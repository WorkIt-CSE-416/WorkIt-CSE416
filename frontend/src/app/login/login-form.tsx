"use client";

import { useActionState } from "react";

import { ArrowRightIcon, LockIcon, MailIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { TextLink } from "@/components/ui/text-link";

import { signIn, type LoginState } from "./actions";

const INITIAL_STATE: LoginState = { error: null, email: "" };

/**
 * The interactive half of /login — split out from page.tsx, same reasoning
 * as signup/signup-form.tsx: useActionState requires a Client Component,
 * and AccountTypeSwitcher targets this form by id from outside it.
 */
export function LoginForm({ formId }: { formId: string }) {
  const [state, formAction, pending] = useActionState(signIn, INITIAL_STATE);

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
        />

        <TextField
          id="password"
          name="password"
          type="password"
          label="Password"
          icon={LockIcon}
          autoComplete="current-password"
          required
          labelAction={
            <TextLink href="/forgot-password" className="text-label">
              Forgot password?
            </TextLink>
          }
        />
      </div>

      {state.error && <p className="text-meta text-danger mt-2.5">{state.error}</p>}

      <Button type="submit" size="lg" className="mt-2.5" disabled={pending}>
        {pending ? "Signing In…" : "Sign In"}
        <ArrowRightIcon className="size-4" />
      </Button>
    </form>
  );
}
