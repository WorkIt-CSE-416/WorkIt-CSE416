import type { Metadata } from "next";

import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { SetPasswordForm } from "@/components/set-password-form";

export const metadata: Metadata = {
  title: "Settings",
  description: "Notifications, team and account.",
};

/**
 * /company/settings, the panel's footer row. Password is the first section
 * to grow a real layout, so this stops importing ../placeholder — its own
 * docblock says to, the day a page has real content. Same container gutter
 * Placeholder used, so the screen doesn't jump now that it's gone.
 *
 * No <main>: the company shell's SidebarInset is the landmark for every
 * screen under /company (see company/profile/page.tsx's own note).
 */
export default function CompanySettingsPage() {
  return (
    <div className="max-w-app mx-auto w-full flex-1 px-4 py-6 sm:px-8 lg:px-12">
      <h1 className="text-heading text-ink">Settings</h1>
      <p className="text-body text-ink-meta mt-1">Notifications, team and account.</p>

      <Card as="section" padding="md" aria-labelledby="password" className="mt-4 max-w-md">
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
