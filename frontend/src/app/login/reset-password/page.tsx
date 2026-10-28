"use client";

import { WarningCircleIcon } from "@phosphor-icons/react/ssr";
import { useActionState } from "react";

import { ArrowRightIcon, MailIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { SkylineBackdrop } from "@/components/skyline";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { TextLink } from "@/components/ui/text-link";

import { requestReset, type ResetState } from "./actions";

const INITIAL: ResetState = { sent: false, error: null };

export default function ResetPasswordPage() {
  const [state, formAction, pending] = useActionState(requestReset, INITIAL);

  if (state.sent) {
    return (
      <main className="flex flex-1 items-start justify-center p-6 lg:pt-[12vh]">
        <SkylineBackdrop />
        <div className="max-w-auth rounded-card border-border bg-surface shadow-card w-full border p-6 text-center">
          <Logo size="card" className="mx-auto" />
          <h1 className="text-title text-ink mt-4">Check Your Email</h1>
          <p className="text-body text-ink-muted mt-2">
            If an account exists for that address, we sent a password reset link. Click it to set a
            new password.
          </p>
          <p className="text-body text-ink-muted mt-6">
            <TextLink href="/login">Back to Sign In</TextLink>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-start justify-center p-6 lg:pt-[12vh]">
      <SkylineBackdrop />
      <div className="max-w-auth rounded-card border-border bg-surface shadow-card w-full border p-6">
        <Logo size="card" className="mx-auto" />
        <h1 className="text-title text-ink mt-2.5 text-center">Reset Password</h1>
        <p className="text-body text-ink-muted mt-1 text-center">
          Enter your email and we will send you a reset link
        </p>

        <form action={formAction} className="mt-5 flex flex-col">
          <TextField
            id="email"
            name="email"
            type="email"
            label="Email Address"
            icon={MailIcon}
            autoComplete="email"
            required
          />

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
            {pending ? "Sending..." : "Send Reset Link"}
            <ArrowRightIcon className="size-4" />
          </Button>
        </form>

        <p className="text-body text-ink-muted mt-6 text-center">
          <TextLink href="/login">Back to Sign In</TextLink>
        </p>
      </div>
    </main>
  );
}
