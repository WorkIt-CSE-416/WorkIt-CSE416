import { redirect } from "next/navigation";

/** Bare /settings, the account menu's link, opens the first section. */
export default function SettingsPage() {
  redirect("/settings/personal");
}
