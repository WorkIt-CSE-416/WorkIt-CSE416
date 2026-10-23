"use client";

import { AppSidebar, type SidebarNavGroup } from "@/components/app-sidebar";
import {
  BriefcaseIcon,
  BuildingOfficeIcon,
  GearIcon,
  SquaresFourIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react/ssr";

/**
 * The company shell's left panel.
 *
 * It holds the nav that used to sit in the top bar. Two navs for one section
 * would be a choice a reader has to think about, so the tabs moved here rather
 * than being duplicated; the bar keeps what is genuinely global — the logo,
 * applicant search, notifications and the account menu.
 *
 * The panel itself, its row spacing and how it marks the current item live in
 * @/components/app-sidebar, shared with the seeker shell. The offset below is
 * this shell's bar height; see "WHY IT IS OFFSET" there.
 *
 * Company Profile is here rather than in the account menu, which is the trade
 * described in @/components/account-menu: a slot of nav width buys a click of
 * depth. It is worth it for the same reason the seeker's My Profile is in the
 * panel — a company's public page is somewhere you go back to while working,
 * not somewhere you visit once to change a setting.
 *
 * No group heading, as on the seeker panel: one group of four rows needs no
 * title over it. It used to sit under "Hiring", which was a stretch for a
 * page about the company rather than about a role.
 *
 * Settings is pinned to the panel's foot, where the seeker panel keeps its
 * own, rather than living in the account menu: it is where you change how
 * the app works, not part of hiring.
 */
const GROUPS: SidebarNavGroup[] = [
  {
    items: [
      { href: "/company", label: "Overview", Icon: SquaresFourIcon, exact: true },
      { href: "/company/jobs", label: "Job Postings", Icon: BriefcaseIcon },
      { href: "/company/applicants", label: "Applicants", Icon: UsersThreeIcon },
      { href: "/company/profile", label: "Company Profile", Icon: BuildingOfficeIcon },
    ],
  },
];

const FOOTER = [{ href: "/company/settings", label: "Settings", Icon: GearIcon }];

export function CompanySidebar() {
  return (
    <AppSidebar
      groups={GROUPS}
      footer={FOOTER}
      label="Company Sections"
      className="top-(--company-bar)!"
    />
  );
}
