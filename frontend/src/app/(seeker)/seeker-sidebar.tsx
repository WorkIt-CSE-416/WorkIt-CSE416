"use client";

import { AppSidebar, type SidebarNavGroup } from "@/components/app-sidebar";
import { BriefcaseIcon, UserIcon } from "@/components/icons";

import { BoardIcon } from "./applications/icons";

/**
 * The seeker shell's left panel: the three sections a job seeker moves
 * between all through a hunt, which used to be tabs in the top bar. The bar
 * keeps what is global to every screen — the logo, job search,
 * notifications and the account menu — the same split the company shell
 * makes. The panel itself is @/components/app-sidebar, shared with that
 * shell, so it collapses to an icon rail on desktop and opens as a sheet on a
 * phone the same way.
 *
 * There is no Search row. /search is where the bar's own field lands a query,
 * and a row beside that field would be a second, contradictory way to reach
 * it; the route still renders.
 *
 * My Profile is a row rather than an item in the account menu: a profile is
 * somewhere a job seeker goes back to all through a hunt, not somewhere they
 * visit once, and a click of depth is the wrong price for that. "My" is what
 * separates it from an employer's profile, which the company shell also has
 * to name.
 */
const GROUPS: SidebarNavGroup[] = [
  {
    label: "Job search",
    items: [
      { href: "/jobs", label: "Jobs", Icon: BriefcaseIcon },
      { href: "/applications", label: "Applications", Icon: BoardIcon },
      { href: "/profile", label: "My Profile", Icon: UserIcon },
    ],
  },
];

export function SeekerSidebar() {
  return <AppSidebar groups={GROUPS} label="Job search sections" className="top-(--seeker-bar)!" />;
}
