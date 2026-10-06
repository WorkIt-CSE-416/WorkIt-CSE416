import type { Metadata } from "next";

import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { SetPasswordForm } from "@/components/set-password-form";

export const metadata: Metadata = {
  title: "Settings",
  description: "Account settings.",
};

/**
 * Where the account menu's "Settings" row has pointed since before this
 * route existed (src/app/(seeker)/layout.tsx) — the honest 404 placeholder
 * finally has something behind it. Password is the first row because it's
 * the first thing with a real backing action; billing and notification
 * preferences still have nowhere else to go, per that layout's own note,
 * and land here the same way when they're built.
 */
export default function SettingsPage() {
  return (
    <main className="max-w-app mx-auto w-full flex-1 px-12 py-4.5">
      <h1 className="text-heading text-ink">Settings</h1>

      <Card as="section" aria-labelledby="password" className="mt-5 max-w-md">
        <SectionHeading id="password">Password</SectionHeading>
        <p className="text-meta text-ink-meta mt-1">
          Set a WorkIt password so you can sign in with your email, in addition to any Google or
          LinkedIn account you&apos;ve connected.
        </p>
        <SetPasswordForm />
      </Card>
    </main>
  );
}
