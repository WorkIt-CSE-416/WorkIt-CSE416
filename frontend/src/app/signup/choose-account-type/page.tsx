import type { Metadata } from "next";

import { BrandPanel } from "@/components/brand-panel";
import { Logo } from "@/components/logo";

import { ChooseAccountTypeForm } from "./choose-account-type-form";

export const metadata: Metadata = {
  title: "Choose Account Type",
  description: "One more step: tell us which side of WorkIt you're on.",
};

/**
 * Where /auth/callback sends a first-time Google/LinkedIn sign-in. Same card
 * shell as /login and /signup — this is still the auth flow, just the one
 * step a password sign-up doesn't need because the account-type switcher
 * already sits above its own form.
 */
export default function ChooseAccountTypePage() {
  return (
    <main className="flex flex-1">
      <BrandPanel />

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-auth rounded-card border-border bg-surface shadow-card w-full border p-6">
          <Logo size="card" priority className="mx-auto" />

          <h1 className="text-title text-ink mt-2.5 text-center">Almost There</h1>
          <p className="text-body text-ink-muted mt-1 text-center">
            Tell us which kind of account this is
          </p>

          <ChooseAccountTypeForm />
        </div>
      </div>
    </main>
  );
}
