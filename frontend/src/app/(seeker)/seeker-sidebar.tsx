"use client";

import { AppSidebar, type SidebarNavGroup } from "@/components/app-sidebar";
import type { ReactNode } from "react";

import {
  BriefcaseBusiness,
  CircleUserRound,
  LayoutDashboard,
  Settings,
  SquareKanban,
} from "lucide-react";

/**
 * The seeker shell's left panel: the sections a job seeker moves between all
 * through a hunt, Dashboard first as the home, which used to be tabs in the
 * top bar. The bar
 * keeps what is global to every screen — the logo, job search,
 * notifications and the account menu — the same split the company shell
 * makes. The panel itself is @/components/app-sidebar, shared with that
 * shell, so it collapses to an icon rail on desktop and opens as a sheet on a
 * phone the same way.
 *
 * There is no Search row. /search is where the bar's own field lands a query
 * (and, on a phone, the bar's magnifier), and a row beside that field would
 * be a second, contradictory way to reach it.
 *
 * Settings is pinned to the panel's foot rather than living in the account
 * menu: it is where you change how the app works, not part of the hunt, and
 * a dashboard keeps that at the bottom of its panel. /settings has nothing
 * to change yet, and says so inside the shell.
 *
 * My Profile is a row rather than an item in the account menu: a profile is
 * somewhere a job seeker goes back to all through a hunt, not somewhere they
 * visit once, and a click of depth is the wrong price for that. "My" is what
 * separates it from an employer's profile, which the company shell also has
 * to name.
 */
const GROUPS: SidebarNavGroup[] = [
  {
    // No group heading: one group of four rows needs no title over it.
    items: [
      { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
      { href: "/jobs", label: "Jobs", Icon: BriefcaseBusiness },
      { href: "/applications", label: "Applications", Icon: SquareKanban },
      { href: "/profile", label: "My Profile", Icon: CircleUserRound },
    ],
  },
];

const FOOTER = [{ href: "/settings", label: "Settings", Icon: Settings }];

/** `card` is the profile strength card, rendered on the server by the layout
 *  (it reads the API) and passed through, since this panel is a client
 *  component. */
export function SeekerSidebar({ card }: { card?: ReactNode }) {
  return (
    <AppSidebar
      groups={GROUPS}
      footer={FOOTER}
      footerCard={card}
      label="Job Search Sections"
      className="top-(--seeker-bar)!"
    />
  );
}
