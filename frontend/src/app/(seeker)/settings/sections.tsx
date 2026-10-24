import { Suspense } from "react";

import { NotificationsSection } from "./notifications/section";
import { PersonalSection } from "./personal/section";
import { PreferencesSection } from "./preferences/section";
import { SecuritySection } from "./security/section";

/**
 * Every Settings section, drawn on the server and handed to the modal
 * (./settings-modal.tsx), which shows one and keeps the rest mounted
 * (KAN-364). Both ways into Settings call this: ./layout.tsx on a hard load
 * and ../@modal/(.)settings/layout.tsx on a soft navigation.
 */
export function allSections() {
  return {
    personal: <PersonalSection />,
    // Suspense for the notice's useSearchParams (./security/notice.tsx).
    security: (
      <Suspense>
        <SecuritySection />
      </Suspense>
    ),
    notifications: <NotificationsSection />,
    preferences: <PreferencesSection />,
  };
}
