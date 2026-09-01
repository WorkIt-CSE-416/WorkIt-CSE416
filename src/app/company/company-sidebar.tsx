"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/shadcn/sidebar";
import { BriefcaseIcon, UserIcon } from "@/components/icons";

import { ChartIcon, GridIcon } from "./icons";

/**
 * The company shell's left panel.
 *
 * It holds the nav that used to sit in the top bar. Two navs for one section
 * would be a choice a reader has to think about, so the tabs moved here rather
 * than being duplicated; the bar keeps what is genuinely global — the logo,
 * candidate search, the post button, notifications and the account menu.
 *
 * WHY IT IS OFFSET RATHER THAN FULL-HEIGHT: shadcn's Sidebar positions itself
 * `fixed inset-y-0 h-svh`, which assumes it owns the left edge of the viewport
 * and that any header sits inside the content area beside it. This shell keeps
 * a full-width bar across the top instead, so the panel starts where the bar
 * ends — --company-bar, set on the shell in layout.tsx so the bar's height is
 * written once rather than duplicated here as a literal. The override is
 * passed in from here rather than edited into components/shadcn/sidebar.tsx,
 * which `shadcn add` regenerates.
 *
 * WHY THE OFFSET CARRIES AN IMPORTANT: `h-auto` merges cleanly over `h-svh`
 * because both are the height group, but `inset-y-0` and `top-*` are different
 * groups — inset-y also sets `bottom`, so tailwind-merge keeps it rather than
 * drop a value the override never replaced. Both `top: 0` and `top: 4rem` then
 * reach the class attribute, and the winner is decided by the order Tailwind
 * emitted them into the stylesheet rather than by anything written here. That
 * is the failure cn() cannot close, described in cn.ts and in CLAUDE.md; the
 * important is what makes the outcome deterministic instead of incidental.
 *
 * Counts are the reason SidebarMenuBadge is here rather than a plain label: the
 * two numbers a recruiter checks before opening anything are how many roles are
 * live and how many applicants are unread, and a nav that already draws them
 * saves the trip. They are fixtures for now, from ./data.
 */
type NavItem = {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => React.ReactNode;
  /** Rendered as a count beside the label. Omitted when there is nothing to say. */
  badge?: number;
};

export function CompanySidebar({
  openRoles,
  unreadApplicants,
}: {
  openRoles: number;
  unreadApplicants: number;
}) {
  const pathname = usePathname();

  const hiring: NavItem[] = [
    { href: "/company", label: "Overview", Icon: GridIcon },
    { href: "/company/jobs", label: "Job Postings", Icon: BriefcaseIcon, badge: openRoles },
    {
      href: "/company/candidates",
      label: "Candidates",
      Icon: UserIcon,
      badge: unreadApplicants,
    },
  ];

  /* /company/analytics is not built. It is a link that 404s rather than a
   * control that does nothing — the same placeholder both shells already use
   * for routes the mockups imply but nobody has drawn. */
  const insights: NavItem[] = [{ href: "/company/analytics", label: "Analytics", Icon: ChartIcon }];

  return (
    <Sidebar
      collapsible="icon"
      className="border-border top-(--company-bar)! h-auto"
      aria-label="Company sections"
    >
      <SidebarContent className="pt-2">
        <Group label="Hiring" items={hiring} pathname={pathname} />
        <Group label="Insights" items={insights} pathname={pathname} />
      </SidebarContent>
    </Sidebar>
  );
}

function Group({ label, items, pathname }: { label: string; items: NavItem[]; pathname: string }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map(({ href, label: text, Icon, badge }) => (
          <SidebarMenuItem key={href}>
            <SidebarMenuButton
              /* Overview owns /company exactly; every other item owns its
               * subtree, so a future /company/jobs/new still lights Job
               * Postings. Without the exact case, Overview would be active on
               * every company screen. */
              isActive={href === "/company" ? pathname === href : pathname.startsWith(href)}
              tooltip={text}
              render={<Link href={href} />}
            >
              <Icon className="size-4" />
              <span>{text}</span>
            </SidebarMenuButton>
            {badge !== undefined && <SidebarMenuBadge>{badge}</SidebarMenuBadge>}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
