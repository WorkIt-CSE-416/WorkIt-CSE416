"use client";

import { AppSidebar, type SidebarNavGroup } from "@/components/app-sidebar";
import { BriefcaseIcon, UserIcon } from "@/components/icons";

import { BuildingIcon, GridIcon } from "./icons";

/**
 * The company shell's left panel.
 *
 * It holds the nav that used to sit in the top bar. Two navs for one section
 * would be a choice a reader has to think about, so the tabs moved here rather
 * than being duplicated; the bar keeps what is genuinely global — the logo,
 * applicant search, the post button, notifications and the account menu.
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
 * It sits under a "Hiring" heading, which is a stretch for a page about the
 * company rather than about a role. One group of four beats two groups of
 * three and one; split it if a second non-hiring row ever arrives.
 */
const GROUPS: SidebarNavGroup[] = [
  {
    label: "Hiring",
    items: [
      { href: "/company", label: "Overview", Icon: GridIcon, exact: true },
      { href: "/company/jobs", label: "Job Postings", Icon: BriefcaseIcon },
      { href: "/company/applicants", label: "Applicants", Icon: UserIcon },
      { href: "/company/profile", label: "Company Profile", Icon: BuildingIcon },
    ],
  },
];

export function CompanySidebar() {
  return <AppSidebar groups={GROUPS} label="Company sections" className="top-(--company-bar)!" />;
}
