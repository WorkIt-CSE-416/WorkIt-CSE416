import type { Metadata } from "next";

import { AccountTypeSwitcher } from "@/components/account-type-switcher";
import { BrandPanel } from "@/components/brand-panel";
import { ArrowRightIcon, GoogleIcon, LinkedInIcon, LockIcon, MailIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { TextLink } from "@/components/ui/text-link";

import { createAccount } from "./actions";

export const metadata: Metadata = {
  title: "Create Account",
  description: "Join WorkIt to find your next role or your next hire.",
};

/** Ties the switcher's hidden input to the form it sits above. */
const FORM_ID = "create-account";

/**
 * /signup — the login card's counterpart. Same two-pane layout, same card,
 * same account-type switcher: a returning and a new user should recognise
 * this as one screen with two doors, not two different products.
 *
 * There is no submission to wire up yet (see ./actions.ts), so the fields
 * collect nothing but a name, email and password for whenever the backend
 * lands — the one working piece of behaviour is Create Account routing into
 * onboarding for the selected account type.
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

          <AccountTypeSwitcher form={FORM_ID} />

          <form id={FORM_ID} action={createAccount} className="mt-4 flex flex-col">
            <div className="flex flex-col gap-2.5">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <TextField
                  id="first-name"
                  name="firstName"
                  type="text"
                  label="First Name"
                  autoComplete="given-name"
                  placeholder="Jane"
                  required
                />

                <TextField
                  id="middle-name"
                  name="middleName"
                  type="text"
                  label="Middle Name"
                  labelAction={<span className="text-meta text-ink-faint">Optional</span>}
                  autoComplete="additional-name"
                  placeholder="Marie"
                />

                <TextField
                  id="last-name"
                  name="lastName"
                  type="text"
                  label="Last Name"
                  autoComplete="family-name"
                  placeholder="Doe"
                  required
                />
              </div>

              <TextField
                id="email"
                name="email"
                type="email"
                label="Email Address"
                icon={MailIcon}
                autoComplete="email"
                placeholder="name@example.com"
                required
              />

              <TextField
                id="password"
                name="password"
                type="password"
                label="Password"
                icon={LockIcon}
                autoComplete="new-password"
                placeholder="••••••••"
                required
              />

              <TextField
                id="confirm-password"
                name="confirmPassword"
                type="password"
                label="Confirm Password"
                icon={LockIcon}
                autoComplete="new-password"
                placeholder="••••••••"
                required
              />
            </div>

            <Button type="submit" size="lg" className="mt-2.5">
              Create Account
              <ArrowRightIcon className="size-4" />
            </Button>
          </form>

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
