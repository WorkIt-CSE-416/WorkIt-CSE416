import type { Metadata } from "next";
import { connection } from "next/server";

import { AuthAlternatives } from "@/components/auth-alternatives";
import { Logo } from "@/components/logo";
import { SkylineBackdrop } from "@/components/skyline";
import { TextLink } from "@/components/ui/text-link";
import { redirectIfSignedIn } from "@/lib/session";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Create Account",
  description: "Join WorkIt to find your next role or your next hire.",
};

/** Ties the switcher's hidden input (inside SignupForm) to the form below it. */
const FORM_ID = "create-account";

/**
 * /signup, the login card's counterpart. Same layout, same card, same
 * account-type switcher: a returning and a new user should recognise this as
 * one screen with two doors, not two different products.
 *
 * Create Account calls POST /auth/signup (see ./actions.ts and
 * src/lib/auth.ts) for applicant accounts. The Company tab opens on Create
 * Company, with Join a Company shown but disabled (see ./signup-form.tsx).
 * Create Company sends the company's fields along with the owner's, and the
 * API creates the company and its owner's membership. Join has no form yet.
 *
 * The `<main>` is the same string as /login's, so the card hangs from the
 * same 12vh and does not re-centre when the Company fields open below it.
 * The skyline behind it is fixed, so the card scrolls over it once those
 * fields make the page taller than the window.
 */
export default async function SignUpPage() {
  // Request time, not build time: the session check needs the Supabase keys,
  // which CI's build has none of (the seeker layout's rule).
  await connection();
  await redirectIfSignedIn();

  return (
    <main className="flex flex-1 items-start justify-center p-6 lg:pt-[12vh]">
      <SkylineBackdrop />

      <div className="rounded-card border-border bg-surface shadow-card w-full max-w-xl border p-6">
        <Logo size="card" className="mx-auto" />

        <h1 className="text-title text-ink mt-2.5 text-center">Create Your Account</h1>
        <p className="text-body text-ink-muted mt-1 text-center">
          Join WorkIt to find your next role or your next hire
        </p>

        <SignupForm formId={FORM_ID} />

        <AuthAlternatives />

        <p className="text-body text-ink-muted mt-6 text-center">
          Already have an account? <TextLink href="/login">Sign In</TextLink>
        </p>
      </div>
    </main>
  );
}
