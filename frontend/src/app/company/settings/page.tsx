import type { Metadata } from "next";

import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { SetPasswordForm } from "@/components/set-password-form";

export const metadata: Metadata = {
  title: "Settings",
  description: "Account settings.",
};

/**
 * Where the account menu's "Settings" row has pointed since before this
 * route existed (src/app/company/layout.tsx) — same reasoning and the same
 * form as (seeker)/settings/page.tsx, just under the company shell.
 *
 * No <main>: the company shell's SidebarInset is the landmark for every
 * screen under /company (see company/profile/page.tsx's own note).
 */
export default function CompanySettingsPage() {
  return (
    <div className="max-w-app mx-auto w-full flex-1 px-6 py-6 sm:px-12">
      <h1 className="text-heading text-ink">Settings</h1>

      <Card as="section" padding="md" aria-labelledby="password" className="mt-5 max-w-md">
        <SectionHeading as="h2" id="password">
          Password
        </SectionHeading>
        <p className="text-meta text-ink-meta mt-1">
          Set a WorkIt password so you can sign in with your email, in addition to any Google or
          LinkedIn account you&apos;ve connected.
        </p>
        <SetPasswordForm />
      </Card>
    </div>
  );
}
