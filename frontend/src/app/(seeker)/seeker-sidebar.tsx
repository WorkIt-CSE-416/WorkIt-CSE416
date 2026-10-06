"use client";

import {
  BriefcaseBusiness,
  CircleHelp,
  CircleUserRound,
  LayoutDashboard,
  LogOut,
  Settings,
  SquareKanban,
} from "lucide-react";
import type { ReactNode } from "react";

import { signOut } from "@/app/actions";
import { AppSidebar, type SidebarNavGroup } from "@/components/app-sidebar";

/**
 * The seeker shell's left panel, floating (see FLOATING in
 * @/components/app-sidebar), in two captioned groups:
 *
 * MENU is the hunt itself, the sections a job seeker moves between all
 * through a search, Dashboard first as the home. These used to be tabs in
 * the top bar.
 *
 * GENERAL is everything about the app rather than the work: Settings, Help
 * and Sign Out. Settings sat alone at the panel's foot; Help and Sign Out
 * joined it when the shell took the floating layout, which groups them under
 * one caption straight after the sections. The bar's photo opens a menu
 * with Sign Out as well (SeekerAccount in ./account-status.tsx); this row
 * stays for anyone who looks in the panel first. There is no Sign
 * In row because the shell only renders for someone signed in; the layout
 * sends anyone else to /login. Sign Out is a button, not a link: it is an
 * action, and it is never lit as the current page.
 *
 * There is no Search row. /search is where the bar's own field lands a query
 * (and, on a phone, the bar's magnifier), and a row beside that field would
 * be a second, contradictory way to reach it.
 *
 * My Profile is a row rather than something behind the account in the bar:
 * a profile is somewhere a job seeker goes back to all through a hunt, not
 * somewhere they visit once, and a click of depth is the wrong price for
 * that. "My" is what separates it from an employer's profile, which the
 * company shell also has to name.
 */
const GROUPS: SidebarNavGroup[] = [
  {
    label: "Menu",
    items: [
      { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
      { href: "/jobs", label: "Jobs", Icon: BriefcaseBusiness },
      { href: "/applications", label: "Applications", Icon: SquareKanban },
      { href: "/profile", label: "My Profile", Icon: CircleUserRound },
    ],
  },
  {
    label: "General",
    items: [
      { href: "/settings", label: "Settings", Icon: Settings },
      { href: "/help", label: "Help", Icon: CircleHelp },
      { action: signOut, label: "Sign Out", Icon: LogOut },
    ],
  },
];

/** `card` is the profile strength card, rendered on the server by the layout
 *  (it reads the API) and passed through, since this panel is a client
 *  component. */
export function SeekerSidebar({ card }: { card?: ReactNode }) {
  return (
    <AppSidebar
      groups={GROUPS}
      footerCard={card}
      label="Job Search Sections"
      variant="floating"
      home="/dashboard"
    />
  );
}
