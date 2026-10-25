import type { ReactNode } from "react";

import DashboardPage from "../dashboard/page";
import { allSections } from "./sections";
import { SettingsModal } from "./settings-modal";

/**
 * A hard load or a reload of a Settings address (KAN-364): Settings is
 * always a modal, so with no page to open over it opens over the Dashboard,
 * drawn here in full, and closing goes to the Dashboard. A soft navigation
 * never reaches this layout: ../@modal/(.)settings intercepts it and opens
 * the same modal over the page it came from. `children` is the section's
 * page, which draws nothing (bare /settings redirects to Personal Details).
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <DashboardPage />
      {children}
      <SettingsModal sections={allSections()} closeTo="/dashboard" />
    </>
  );
}
