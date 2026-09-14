import type { Metadata } from "next";

import { MailIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { TextLink } from "@/components/ui/text-link";

import { AccountTypeSwitcher } from "./account-type";
import { signIn } from "./actions";
import { BrandPanel } from "./brand-panel";
import { ArrowRightIcon, GoogleIcon, LinkedInIcon, LockIcon } from "./icons";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Log in to find your next career move.",
};

/** Ties the switcher's hidden input to the form it sits above. */
const FORM_ID = "sign-in";

/**
 * Two halves from `lg` up: the pitch on the left, the card on the right.
 *
 * The card is unchanged — same width, border, shadow and contents — so on a
 * narrow viewport, where the left half is dropped, this is still the screen
 * KAN-43 signed off. `justify-center` on the right half keeps it centred in its
 * own column rather than pinned to the divide.
 */
export default function LoginPage() {
  return (
    <main className="flex flex-1">
      <BrandPanel />

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-auth rounded-card border-border bg-surface shadow-card w-full border p-6">
          <Logo size="card" priority className="mx-auto" />

          <h1 className="text-title text-ink mt-2.5 text-center">Welcome Back</h1>
          <p className="text-body text-ink-muted mt-1 text-center">
            Log in to find your next career move
          </p>

          {/* It sits above the form rather than inside it, so its value
              reaches the submission through its hidden input's `form`. */}
          <AccountTypeSwitcher form={FORM_ID} />

          <form id={FORM_ID} action={signIn} className="mt-5 flex flex-col">
            <div className="flex flex-col gap-2.5">
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
                autoComplete="current-password"
                placeholder="••••••••"
                required
                labelAction={
                  <TextLink href="/forgot-password" className="text-label">
                    Forgot password?
                  </TextLink>
                }
              />
            </div>

            <Button type="submit" size="lg" className="mt-2.5">
              Sign In
              <ArrowRightIcon className="size-4" />
            </Button>
          </form>

          <div className="mt-5 flex items-center gap-3">
            <span className="bg-border-subtle h-px flex-1" />
            <span className="text-caption text-ink-muted uppercase">Or continue with</span>
            <span className="bg-border-subtle h-px flex-1" />
          </div>

          <div className="mt-[22px] grid grid-cols-2 gap-3">
            <Button variant="secondary">
              <GoogleIcon className="size-4" />
              Google
            </Button>
            <Button variant="secondary">
              <LinkedInIcon className="size-4" />
              LinkedIn
            </Button>
          </div>

          <p className="text-body text-ink-muted mt-6 text-center">
            Don&apos;t have an account? <TextLink href="/signup">Create Account</TextLink>
          </p>
        </div>
      </div>
    </main>
  );
}
