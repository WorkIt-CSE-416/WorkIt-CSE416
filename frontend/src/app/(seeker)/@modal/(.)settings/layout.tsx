import type { ReactNode } from "react";

import { allSections } from "../../settings/sections";
import { SettingsModal } from "../../settings/settings-modal";

/**
 * Settings over the current page (KAN-364): a soft navigation to
 * /settings/<section> from any seeker page (the account menu's Settings)
 * lands here, and the page it came from stays under the modal. Closing goes
 * back to it. A hard load opens the same modal over the Dashboard instead
 * (../../settings/layout.tsx). `children` is the section's page, which draws
 * nothing: the modal draws every section (../../settings/sections.tsx).
 */
export default function SettingsModalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <SettingsModal sections={allSections()} />
    </>
  );
}
