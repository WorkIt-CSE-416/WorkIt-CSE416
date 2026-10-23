import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { SettingsNav } from "./settings-nav";

/**
 * Settings (KAN-326), a row in the account menu the bar's photo opens: the
 * heading block every seeker screen has, then the section nav and the
 * section. The sections are routes under /settings (./settings-nav); bare
 * /settings opens Personal Details. A <div>, since SidebarInset is already
 * the <main>.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <h1 className="text-heading text-ink">Settings</h1>
      <p className="text-body text-ink-meta mt-1">
        Your details, sign-in, notifications and job preferences.
      </p>

      <div className="mt-6 flex flex-col gap-6 @3xl/main:grid @3xl/main:grid-cols-[13rem_minmax(0,1fr)] @3xl/main:items-start @3xl/main:gap-8">
        <SettingsNav />
        <div className="flex max-w-2xl min-w-0 flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}
