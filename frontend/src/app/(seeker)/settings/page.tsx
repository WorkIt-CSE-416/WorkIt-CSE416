import type { Metadata } from "next";

import { Card } from "@/components/ui/card";
import { getProfile } from "@/lib/profile-actions";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { JobAlertsToggle } from "./job-alerts-toggle";

export const metadata: Metadata = {
  title: "Settings",
  description: "Notifications, privacy and your account.",
};

/**
 * /settings, a row in the account menu the bar's photo opens. Real content
 * for the first time (KAN-298) — a <div>, since SidebarInset is already the
 * <main>, same shell as every other seeker screen.
 *
 * A failed profile read still renders the toggle, defaulted off: Settings
 * should never block on My Profile's cache, and a student who can't load
 * their own state here isn't opted into a daily email either way.
 */
export default async function SettingsPage() {
  const { profile } = await getProfile();

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <h1 className="text-heading text-ink">Settings</h1>
      <p className="text-body text-ink-meta mt-1">Notifications, privacy and your account.</p>

      <Card as="section" className="mt-4" aria-labelledby="notifications-heading">
        <h2 id="notifications-heading" className="text-subtitle text-ink">
          Notifications
        </h2>
        <div className="mt-3">
          <JobAlertsToggle initialEnabled={profile?.job_alerts_enabled ?? false} />
        </div>
      </Card>
    </div>
  );
}
