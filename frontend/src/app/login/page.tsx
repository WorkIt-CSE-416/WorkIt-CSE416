import { WarningCircleIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { connection } from "next/server";

import { AccountTypeSwitcher } from "@/components/account-type-switcher";
import { AuthAlternatives } from "@/components/auth-alternatives";
import { AuthCard } from "@/components/auth-card";
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
 * The card alone at every width (components/auth-card.tsx), the screen KAN-43
 * signed off. Until KAN-259 a violet pitch filled the left of the window from
 * `lg` up. No mockup ever drew that half, and it pulled the eye off the form.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // Request time, not build time: the session check needs the Supabase keys,
  // which CI's build has none of (the seeker layout's rule).
  await connection();
  await redirectIfSignedIn();
  // The page to go back to after signing in: the connector's consent page
  // (actions.ts allows only that one). `error` is set by /auth/confirm when an
  // email link was bad, expired or used, and to `oauth` when a Google or
  // LinkedIn sign-in failed (lib/oauth-actions.ts, auth/callback): the
  // marketing pages' sign-up buttons land a visitor here then (KAN-581).
  const { next, error } = await searchParams;
  const badLink = error === "confirm_failed" || error === "invalid_link";
  const oauthFailed = error === "oauth";

  return (
    <AuthCard
      title="Welcome Back"
      subtitle="Sign in to find your next career move"
      footer={
        <>
          Don&apos;t have an account? <TextLink href="/signup">Create Account</TextLink>
        </>
      }
    >
      {badLink && (
        <p
          role="alert"
          className="text-label text-danger bg-danger-tint rounded-control mt-4 flex items-start gap-2 px-3 py-2"
        >
          <WarningCircleIcon className="mt-px size-4 shrink-0" aria-hidden />
          That email link has expired or was already used. Sign in, or get a new link from Forgot
          Password or Create Account.
        </p>
      )}

      {oauthFailed && (
        <p
          role="alert"
          className="text-label text-danger bg-danger-tint rounded-control mt-4 flex items-start gap-2 px-3 py-2"
        >
          <WarningCircleIcon className="mt-px size-4 shrink-0" aria-hidden />
          We couldn&apos;t sign you in with Google or LinkedIn. Try again, or sign in with your
          email.
        </p>
      )}

      {/* It sits above the form rather than inside it, so its value
          reaches the submission through its hidden input's `form`. */}
      <AccountTypeSwitcher form={FORM_ID} />

      <LoginForm formId={FORM_ID} next={typeof next === "string" ? next : undefined} />

      <AuthAlternatives />
    </AuthCard>
  );
}
