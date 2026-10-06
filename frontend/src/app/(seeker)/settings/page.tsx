import type { Metadata } from "next";

import { GearIcon } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";

export const metadata: Metadata = {
  title: "Settings",
  description: "Notifications, privacy and your account.",
};

/**
 * /settings, the panel's footer row. Nothing can be changed here yet, so it
 * says so inside the shell, under the same heading block as every other
 * seeker screen, rather than leaving a permanent row that opens Next's stock
 * 404. A <div>, since SidebarInset is already the <main>.
 */
export default function SettingsPage() {
  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <h1 className="text-heading text-ink">Settings</h1>
      <p className="text-body text-ink-meta mt-1">Notifications, privacy and your account.</p>

      <EmptyState Icon={GearIcon} title="Settings are on the way" className="mt-4">
        Nothing to change here yet.
      </EmptyState>
    </div>
  );
}
