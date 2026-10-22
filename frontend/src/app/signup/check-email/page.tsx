import type { Metadata } from "next";

import { Logo } from "@/components/logo";
import { SkylineBackdrop } from "@/components/skyline";
import { TextLink } from "@/components/ui/text-link";

import { CheckEmailForm } from "./check-email-form";

export const metadata: Metadata = {
  title: "Check Your Email",
  description: "Verify your email to finish setting up your WorkIt account.",
};

/**
 * Where ../actions.ts's createAccount sends every password signup — Create
 * Account never signs the student in directly (Supabase refuses a session
 * for an unconfirmed email, docs/auth.md), so this is the waiting room
 * between signing up and clicking the link that email sends. This folder's
 * own ./actions.ts is the Resend Email button's action, not signup's.
 * /auth/callback (route.ts) is what completes it, on to onboarding or
 * /company. Same card shell as /login, /signup and choose-account-type.
 *
 * `?email=` is read straight off the URL, not a session: there is no
 * session yet. A direct visit with no `email` still renders — the generic
 * copy just says "the email you used" instead of printing one.
 */
export default async function CheckEmailPage({ searchParams }: PageProps<"/signup/check-email">) {
  const params = await searchParams;
  const email = typeof params.email === "string" ? params.email : undefined;

  return (
    <main className="flex flex-1 items-start justify-center p-6 lg:pt-[12vh]">
      <SkylineBackdrop />

      <div className="max-w-auth rounded-card border-border bg-surface shadow-card w-full border p-6">
        <Logo size="card" className="mx-auto" />

        <h1 className="text-title text-ink mt-2.5 text-center">Check Your Email</h1>
        <p className="text-body text-ink-muted mt-1 text-center">
          {email ? (
            <>
              We sent a verification link to <span className="text-ink font-medium">{email}</span>.
              Click it to finish setting up your account.
            </>
          ) : (
            "We sent a verification link to the email you used. Click it to finish setting up your account."
          )}
        </p>

        <CheckEmailForm email={email ?? ""} />

        <p className="text-body text-ink-muted mt-6 text-center">
          Wrong email? <TextLink href="/signup">Start Over</TextLink>
        </p>
      </div>
    </main>
  );
}
