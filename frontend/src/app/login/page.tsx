import type { Metadata } from "next";
import { connection } from "next/server";

import { AccountTypeSwitcher } from "@/components/account-type-switcher";
import { AuthAlternatives } from "@/components/auth-alternatives";
import { Logo } from "@/components/logo";
import { SkylineBackdrop } from "@/components/skyline";
import { TextLink } from "@/components/ui/text-link";
import { redirectIfSignedIn } from "@/lib/session";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to find your next career move.",
};

/** Ties the switcher's hidden input to the form it sits above. */
const FORM_ID = "sign-in";

/**
 * The card alone at every width, with KAN-43's width, border and shadow: the
 * screen KAN-43 signed off, over the skyline that all three auth screens
 * share (components/skyline.tsx). Until KAN-259 a violet pitch filled the
 * left of the window from `lg` up. No mockup ever drew that half, and it
 * pulled the eye off the form.
 *
 * The card hangs from the top (12vh down from `lg` up) rather than centring,
 * the same as /signup's and /signup/choose-account-type's. Centred, it moved
 * every time its height changed, and the control just clicked slid out from
 * under the pointer.
 */
export default async function LoginPage() {
  // Request time, not build time: the session check needs the Supabase keys,
  // which CI's build has none of (the seeker layout's rule).
  await connection();
  await redirectIfSignedIn();

  return (
    <main className="flex flex-1 items-start justify-center p-6 lg:pt-[12vh]">
      <SkylineBackdrop />

      <div className="max-w-auth rounded-card border-border bg-surface shadow-card w-full border p-6">
        <Logo size="card" className="mx-auto" />

        <h1 className="text-title text-ink mt-2.5 text-center">Welcome Back</h1>
        <p className="text-body text-ink-muted mt-1 text-center">
          Sign in to find your next career move
        </p>

        {/* It sits above the form rather than inside it, so its value
            reaches the submission through its hidden input's `form`. */}
        <AccountTypeSwitcher form={FORM_ID} />

        <LoginForm formId={FORM_ID} />

        <AuthAlternatives />

        <p className="text-body text-ink-muted mt-6 text-center">
          Don&apos;t have an account? <TextLink href="/signup">Create Account</TextLink>
        </p>
      </div>
    </main>
  );
}
