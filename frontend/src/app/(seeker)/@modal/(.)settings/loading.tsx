import { NotificationsSection } from "../../settings/notifications/section";
import { SectionSkeleton } from "../../settings/sections";
import { SettingsModal } from "../../settings/settings-modal";

/**
 * Settings opening over the current page, before its sections arrive
 * (KAN-368): the modal itself, its title and nav live, over each section's
 * skeleton (../../settings/sections.tsx). Notifications reads nothing, so it
 * is drawn as it is.
 *
 * The account menu's Settings link points at a dynamic route, which Next
 * prefetches only down to a loading boundary; with this one the click opens
 * the modal in the next frame instead of after a round trip to the server.
 *
 * ONLY HERE, NEVER BESIDE THE SEEKER LAYOUT. A loading.tsx in (seeker)/
 * would wrap every slot of that layout, this @modal slot included, so a
 * page-sized skeleton could flash where the modal opens. Each section that
 * waits has its own file instead.
 *
 * The real modal replaces this one when the route arrives (React shows a
 * fallback for at least 300ms), and it mounts afresh, so the dialog's 100ms
 * fade and zoom plays a second time then.
 */
export default function SettingsLoading() {
  return (
    <SettingsModal
      sections={{
        personal: <SectionSkeleton id="personal" title="Personal Details" photo />,
        security: <SectionSkeleton id="sign-in" title="Sign-In" />,
        notifications: <NotificationsSection />,
        preferences: <SectionSkeleton id="job-preferences" title="Job Preferences" fields={4} />,
      }}
    />
  );
}
