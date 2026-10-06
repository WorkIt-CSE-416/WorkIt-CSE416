import type { Metadata } from "next";

import { Placeholder } from "../placeholder";

export const metadata: Metadata = {
  title: "Settings",
  description: "Notifications, team and account.",
};

/** /company/settings, the panel's footer row, scaffolded so it lands inside
 *  the shell rather than on Next's stock 404. */
export default function CompanySettingsPage() {
  return <Placeholder title="Settings" description="Notifications, team and account." />;
}
