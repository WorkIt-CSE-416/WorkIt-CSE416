import type { Metadata } from "next";

import { BrandPanel } from "@/components/brand-panel";
import { GoogleIcon, LinkedInIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/ui/text-link";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Create Account",
  description: "Join WorkIt to find your next role or your next hire.",
};

/** Ties the switcher's hidden input (inside SignupForm) to the form below it. */
const FORM_ID = "create-account";

/**
 * /signup — the login card's counterpart. Same two-pane layout, same card,
 * same account-type switcher: a returning and a new user should recognise
 * this as one screen with two doors, not two different products.
 *
 * Create Account calls POST /auth/signup (see ./actions.ts and
 * src/lib/auth.ts) for applicant accounts. The Company tab asks Create or
 * Join first (see ./signup-form.tsx); Create Company sends the company's
 * fields along with the owner's, and shows whatever the API says back — 501
 * until the backend handles company signup. Join has no form yet.
 */
export default function SignUpPage() {
  return (
    <main className="flex flex-1">
      {/* 5:7 rather than login's 1:1 — this card carries twice the fields
          (three name inputs, a confirm-password) and wants the width to lay
          the name row out in one line instead of wrapping. */}
      <BrandPanel className="lg:flex-[5]" />

      <div className="flex flex-1 items-center justify-center p-5 lg:flex-[7]">
        <div className="rounded-card border-border bg-surface shadow-card w-full max-w-xl border p-5">
          <Logo size="card" priority className="mx-auto" />

          <h1 className="text-title text-ink mt-2.5 text-center">Create Your Account</h1>
          <p className="text-body text-ink-muted mt-1 text-center">
            Join WorkIt to find your next role or your next hire
          </p>

          <SignupForm formId={FORM_ID} />

          <div className="mt-4 flex items-center gap-3">
            <span className="bg-border-subtle h-px flex-1" />
            <span className="text-caption text-ink-muted uppercase">Or continue with</span>
            <span className="bg-border-subtle h-px flex-1" />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Button variant="secondary">
              <GoogleIcon className="size-4" />
              Google
            </Button>
            <Button variant="secondary">
              <LinkedInIcon className="size-4" />
              LinkedIn
            </Button>
          </div>

          <p className="text-body text-ink-muted mt-4 text-center">
            Already have an account? <TextLink href="/login">Sign In</TextLink>
          </p>
        </div>
      </div>
    </main>
  );
}
