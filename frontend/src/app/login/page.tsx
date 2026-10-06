import type { Metadata } from "next";

import { AccountTypeSwitcher } from "@/components/account-type-switcher";
import { AuthAlternatives } from "@/components/auth-alternatives";
import { BrandPanel } from "@/components/brand-panel";
import { Logo } from "@/components/logo";
import { TextLink } from "@/components/ui/text-link";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to find your next career move.",
};

/** Ties the switcher's hidden input to the form it sits above. */
const FORM_ID = "sign-in";

/**
 * Two halves from `lg` up: the pitch on the left, the card on the right.
 *
 * The card keeps KAN-43's width, border and shadow, so on a narrow viewport,
 * where the left half is dropped, this is still the screen KAN-43 signed off.
 * `justify-center` on the right half keeps it centred in its own column
 * rather than pinned to the divide.
 *
 * The card hangs from the top of its column (12vh down from `lg` up) rather
 * than centring in it, the same as /signup's. Centred, it moved every time its
 * height changed, and the control just clicked slid out from under the
 * pointer. The 5:7 split lives in BrandPanel, so both screens share it.
 */
export default function LoginPage() {
  return (
    <main className="flex flex-1">
      <BrandPanel />

      <div className="flex flex-1 items-start justify-center p-6 lg:flex-[7] lg:pt-[12vh]">
        <div className="max-w-auth rounded-card border-border bg-surface shadow-card w-full border p-6">
          <Logo size="card" priority className="mx-auto" />

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
      </div>
    </main>
  );
}
