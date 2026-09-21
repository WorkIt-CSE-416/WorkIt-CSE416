"use client";

import { useActionState } from "react";

import { ArrowRightIcon, LockIcon, MailIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";

import { createAccount, type SignupState } from "./actions";

const INITIAL_STATE: SignupState = { error: null };

/**
 * The interactive half of /signup — everything above the fold (logo,
 * heading, AccountTypeSwitcher) stays server-rendered in page.tsx; this is
 * only the form, split out because useActionState requires a Client
 * Component. `formId` ties it to AccountTypeSwitcher's hidden input, which
 * sits outside this component in the DOM but targets this form by id.
 */
export function SignupForm({ formId }: { formId: string }) {
  const [state, formAction, pending] = useActionState(createAccount, INITIAL_STATE);

  return (
    <form id={formId} action={formAction} className="mt-4 flex flex-col">
      <div className="flex flex-col gap-2.5">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <TextField
            id="first-name"
            name="firstName"
            type="text"
            label="First Name"
            autoComplete="given-name"
            placeholder="Jane"
            required
          />

          <TextField
            id="middle-name"
            name="middleName"
            type="text"
            label="Middle Name"
            labelAction={<span className="text-meta text-ink-faint">Optional</span>}
            autoComplete="additional-name"
            placeholder="Marie"
          />

          <TextField
            id="last-name"
            name="lastName"
            type="text"
            label="Last Name"
            autoComplete="family-name"
            placeholder="Doe"
            required
          />
        </div>

        <TextField
          id="email"
          name="email"
          type="email"
          label="Email Address"
          icon={MailIcon}
          autoComplete="email"
          placeholder="name@example.com"
          required
        />

        <TextField
          id="password"
          name="password"
          type="password"
          label="Password"
          icon={LockIcon}
          autoComplete="new-password"
          placeholder="••••••••"
          required
        />

        <TextField
          id="confirm-password"
          name="confirmPassword"
          type="password"
          label="Confirm Password"
          icon={LockIcon}
          autoComplete="new-password"
          placeholder="••••••••"
          required
        />
      </div>

      {state.error && <p className="text-meta text-danger mt-2.5">{state.error}</p>}

      <Button type="submit" size="lg" className="mt-2.5" disabled={pending}>
        {pending ? "Creating Account…" : "Create Account"}
        <ArrowRightIcon className="size-4" />
      </Button>
    </form>
  );
}
