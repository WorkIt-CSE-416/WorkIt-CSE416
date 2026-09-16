import type { Metadata } from "next";

import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Set Up Your Company",
  description: "Business onboarding is coming soon.",
};

/**
 * /onboarding/company — the business half of KAN-113.
 *
 * A stub rather than a built screen: what a business account needs here is
 * still undecided (see the ticket), so there is nothing to design against
 * yet. It exists so the route resolves once sign-up can reach it, rather than
 * a company account hitting a 404 the day this ships — the same reasoning
 * ../../company/jobs/new/stepper.tsx gives for drawing steps nobody has built.
 */
export default function CompanyOnboardingPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-10">
      <div className="w-full max-w-md text-center">
        <Logo size="card" priority className="mx-auto" />
        <h1 className="text-title text-ink mt-4">Company onboarding is on its way</h1>
        <p className="text-body text-ink-muted mt-1">
          We&apos;re still designing this step for business accounts — check back soon.
        </p>
        <ButtonLink href="/company" size="lg" className="mt-6">
          Continue to Dashboard
        </ButtonLink>
      </div>
    </main>
  );
}
