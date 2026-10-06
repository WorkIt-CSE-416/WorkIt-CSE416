"use client";

import {
  BriefcaseBusiness,
  CalendarDays,
  CircleUserRound,
  LayoutDashboard,
  SquareKanban,
} from "lucide-react";
import type { ReactNode } from "react";

import { AppSidebar, type SidebarNavGroup } from "@/components/app-sidebar";

/**
 * The seeker shell's left panel, floating (see FLOATING in
 * @/components/app-sidebar): the hunt itself, the sections a job seeker
 * moves between all through a search, Dashboard first as the home, with no
 * caption over them. These used to be tabs in the top bar.
 *
 * Nothing about the app rather than the work lives here. Settings, Help and
 * Sign Out were a second group, General, under this one; they moved to the
 * menu the bar's photo opens (SeekerAccount in ./account-status.tsx), where
 * people look for them, so the panel holds only the search and each of
 * those has one home. There is no Sign In anywhere in the shell: it only
 * renders for someone signed in, and the layout sends anyone else to
 * /login.
 *
 * There is no Search row. /search is where the bar's own field lands a query
 * (and, on a phone, the bar's magnifier), and a row beside that field would
 * be a second, contradictory way to reach it.
 *
 * Calendar sits after Applications, as the same applications read by date.
 * Its glyph is CalendarDays, not Calendar: the plain calendar is the
 * Interviewing stage's glyph (../stage-colors.ts), and a nav row wearing it
 * would read as a stage.
 *
 * My Profile is a row rather than something behind the account in the bar:
 * a profile is somewhere a job seeker goes back to all through a hunt, not
 * somewhere they visit once, and a click of depth is the wrong price for
 * that. "My" is what separates it from an employer's profile, which the
 * company shell also has to name.
 */
const GROUPS: SidebarNavGroup[] = [
  {
    // No caption: with one group there is nothing to tell it apart from.
    items: [
      { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
      { href: "/jobs", label: "Jobs", Icon: BriefcaseBusiness },
      { href: "/applications", label: "Applications", Icon: SquareKanban },
      { href: "/calendar", label: "Calendar", Icon: CalendarDays },
      { href: "/profile", label: "My Profile", Icon: CircleUserRound },
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
