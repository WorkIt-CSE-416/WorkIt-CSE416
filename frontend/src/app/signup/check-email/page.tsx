import type { Metadata } from "next";

import { AuthCard } from "@/components/auth-card";
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
    <AuthCard
      title="Check Your Inbox"
      subtitle="We sent a confirmation link to your email address. Click the link to verify your account, then sign in."
      footer={
        <>
          Already verified? <TextLink href="/login">Sign In</TextLink>
        </>
      }
    />
  );
}
