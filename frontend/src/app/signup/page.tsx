import type { Metadata } from "next";
import { connection } from "next/server";

import { AuthAlternatives } from "@/components/auth-alternatives";
import { AuthCard } from "@/components/auth-card";
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
 * The card is AuthCard, /login's 360px card (KAN-573; it was 576px here, so
 * the card jumped in width between the two doors). It hangs from the top, so
 * it does not re-centre when the Company fields open below it. The skyline
 * behind it is fixed, so the card scrolls over it once those fields make the
 * page taller than the window.
 */
export default async function SignUpPage() {
  // Request time, not build time: the session check needs the Supabase keys,
  // which CI's build has none of (the seeker layout's rule).
  await connection();
  await redirectIfSignedIn();

  return (
    <AuthCard
      title="Create Your Account"
      subtitle="Join WorkIt to find your next role or your next hire"
      footer={
        <>
          Already have an account? <TextLink href="/login">Sign In</TextLink>
        </>
      }
    >
      <SignupForm formId={FORM_ID} />

      <AuthAlternatives />
    </AuthCard>
  );
}
