import type { Metadata } from "next";

import { AuthCard } from "@/components/auth-card";

import { ChooseAccountTypeForm } from "./choose-account-type-form";

export const metadata: Metadata = {
  title: "Choose Account Type",
  description: "One more step: tell us which side of WorkIt you're on.",
};

/**
 * Where /auth/callback sends a first-time Google/LinkedIn sign-in once the
 * business side is back. While it is hidden (KAN-239) the callback skips this
 * page and finishes the account as an applicant itself (KAN-573): with no
 * Company option, the page asked a question it offered no answer to. Same
 * card as /login and /signup (AuthCard), the one step a password sign-up
 * doesn't need because the account-type switcher sits above its own form.
 */
export default function ChooseAccountTypePage() {
  return (
    <AuthCard title="Almost There" subtitle="Tell us which kind of account this is">
      <ChooseAccountTypeForm />
    </AuthCard>
  );
}
