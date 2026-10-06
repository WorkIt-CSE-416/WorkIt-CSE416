"use client";

import {
  BriefcaseBusiness,
  CircleHelp,
  CircleUserRound,
  LayoutDashboard,
  LogIn,
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
 * GENERAL is everything about the app rather than the work: Settings, Help,
 * and Sign Out or Sign In. Settings sat alone at the panel's foot; Help and
 * the account row joined it when the shell took the floating layout, which
 * groups them under one caption straight after the sections. The account
 * row is the only way in or out of an account in this shell: the bar's
 * photo, name and email are a label now, not a menu (see SeekerAccount in
 * ./account-status.tsx). Sign Out is a button, not a link: it is an action,
 * and it is never lit as the current page.
 *
 * There is no Search row. /search is where the bar's own field lands a query
 * (and, on a phone, the bar's magnifier), and a row beside that field would
 * be a second, contradictory way to reach it.
 *
 * My Profile is a row rather than something behind the account in the bar: a
 * profile is
 * somewhere a job seeker goes back to all through a hunt, not somewhere they
 * visit once, and a click of depth is the wrong price for that. "My" is what
 * separates it from an employer's profile, which the company shell also has
 * to name.
 */
function groups(signedIn: boolean): SidebarNavGroup[] {
  return [
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
        signedIn
          ? { action: signOut, label: "Sign Out", Icon: LogOut }
          : { href: "/login", label: "Sign In", Icon: LogIn },
      ],
    },
  ];
}

/** `card` is the profile strength card, rendered on the server by the layout
 *  (it reads the API) and passed through, since this panel is a client
 *  component. `signedIn` picks the account row, from the session cookie the
 *  layout reads, so the panel never waits on the API. */
export function SeekerSidebar({ card, signedIn }: { card?: ReactNode; signedIn: boolean }) {
  return (
    <AppSidebar
      groups={groups(signedIn)}
      footerCard={card}
      label="Job Search Sections"
      variant="floating"
      home="/dashboard"
    />
  );
}
