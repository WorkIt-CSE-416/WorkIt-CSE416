import type { Metadata } from "next";

import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Waiting for Deployment",
  description: "Business accounts are not available yet.",
};

/**
 * Where every business path lands while the business side is hidden
 * (KAN-239). src/proxy.ts sends /company and /onboarding/company here, so the
 * root page's hiring card still shows and a click on it ends on this screen.
 * Delete this page together with that redirect when the business side ships.
 */
export default function ComingSoonPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-10">
      <div className="w-full max-w-md text-center">
        <Logo size="card" className="mx-auto" />
        <h1 className="text-title text-ink mt-4">Waiting for Deployment</h1>
        <p className="text-body text-ink-muted mt-1">
          Business accounts are not available yet. Check back soon.
        </p>
        <ButtonLink href="/" size="lg" className="mt-6">
          Back to Home
        </ButtonLink>
      </div>
    </main>
  );
}
