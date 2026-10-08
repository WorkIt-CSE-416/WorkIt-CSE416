import type { Metadata } from "next";

import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { SetPasswordForm } from "@/components/set-password-form";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";

export const metadata: Metadata = {
  title: "Settings",
  description: "Notifications, privacy and your account.",
};

/**
 * /settings, a row in the account menu the bar's photo opens. Password is
 * the first real section — the first thing here with a backing action, for
 * an account that signed in with Google or LinkedIn and wants email+password
 * sign-in too. Notifications and the rest of "privacy and your account"
 * still have nowhere else to go; they land here the same way once built.
 */
export default function SettingsPage() {
  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <h1 className="text-heading text-ink">Settings</h1>
      <p className="text-body text-ink-meta mt-1">Notifications, privacy and your account.</p>

      <Card as="section" aria-labelledby="password" className="mt-4 max-w-md">
        <SectionHeading id="password">Password</SectionHeading>
        <p className="text-meta text-ink-meta mt-1">
          Set a WorkIt password so you can sign in with your email, in addition to any Google or
          LinkedIn account you&apos;ve connected.
        </p>
        <SetPasswordForm />
      </Card>
    </div>
  );
}
