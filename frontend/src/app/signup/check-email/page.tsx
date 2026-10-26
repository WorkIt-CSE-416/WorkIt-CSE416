import type { Metadata } from "next";

import { Logo } from "@/components/logo";
import { SkylineBackdrop } from "@/components/skyline";
import { TextLink } from "@/components/ui/text-link";

export const metadata: Metadata = {
  title: "Check Your Email",
  description: "Verify your email to finish creating your account.",
};

/**
 * Shown after signup. The user must click the confirm link in their email
 * before they can sign in. No resend button for now — Supabase sends the
 * email on signup automatically, and a resend needs the email address
 * carried from the previous step, which this static page does not have.
 */
export default function CheckEmailPage() {
  return (
    <main className="flex flex-1 items-start justify-center p-6 lg:pt-[12vh]">
      <SkylineBackdrop />

      <div className="max-w-auth rounded-card border-border bg-surface shadow-card w-full border p-6 text-center">
        <Logo size="card" className="mx-auto" />

        <h1 className="text-title text-ink mt-4">Check Your Inbox</h1>
        <p className="text-body text-ink-muted mt-2">
          We sent a confirmation link to your email address. Click the link to verify your account,
          then sign in.
        </p>

        <p className="text-body text-ink-muted mt-6">
          Already verified? <TextLink href="/login">Sign In</TextLink>
        </p>
      </div>
    </main>
  );
}
