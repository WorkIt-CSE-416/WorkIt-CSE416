import { SidebarMenuBadge } from "@/components/shadcn/sidebar";

import { getUpdatesOnce } from "./applications/data";

/**
 * The Applications Tracker row's badge (KAN-413, docs/email_tracker.md): how
 * many email updates wait in its Updates strip. Rendered on the server by the
 * layout inside its own <Suspense>, so the panel never waits on the read; it
 * shares the page's read through `getUpdatesOnce` when the page is the
 * tracker. Nothing waits, or the read failed: no badge. It is a layout read,
 * so it updates on a hard load or a refresh (every decision refreshes the
 * page), not on a soft navigation, which keeps the layout as it was.
 */
export async function UpdatesBadge() {
  const count = (await getUpdatesOnce())?.length ?? 0;
  if (count === 0) return null;
  return (
    <SidebarMenuBadge
      aria-label={`${count} ${count === 1 ? "update" : "updates"} waiting`}
      className="bg-brand text-on-brand top-2.5 right-3 rounded-full px-1.5"
    >
      {count > 99 ? "99+" : count}
    </SidebarMenuBadge>
  );
}
