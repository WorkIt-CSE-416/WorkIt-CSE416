"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/shadcn/sidebar";
import { BriefcaseIcon, UserIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

import { BuildingIcon, GridIcon } from "./icons";

/**
 * The company shell's left panel.
 *
 * It holds the nav that used to sit in the top bar. Two navs for one section
 * would be a choice a reader has to think about, so the tabs moved here rather
 * than being duplicated; the bar keeps what is genuinely global — the logo,
 * applicant search, the post button, notifications and the account menu.
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
 */
/**
 * Room around a row, and between one row and the next.
 *
 * Both are fixes to the vendored defaults, which draw the nav as a solid
 * column of touching rectangles. That is fine while every row is transparent
 * and stops being fine the moment a row is filled: a hover has no edge of its
 * own, it just butts into its neighbours, and two rows hovered in sequence
 * read as one block growing rather than as two separate targets.
 *
 * MENU adds the gap. shadcn's SidebarMenu is `gap-0`, so the buttons are
 * flush; 4px is enough to let each fill close on all four sides without the
 * group starting to look like a list of cards.
 *
 * MENU_BUTTON makes the row's own padding real. The button is `h-8` — 32px —
 * while its content is a 20px `text-sm` line inside `p-2`, which needs 36px.
 * The height wins, so the 8px padding renders as 6px and the fill hugs the
 * label. `h-9` is not a bigger row so much as the row the padding already
 * asked for. Icon-collapsed mode is untouched: that keeps its square
 * `size-8!`, which is what a 32px icon rail wants.
 */
const MENU = "gap-1";
const MENU_BUTTON = "h-9";

/**
 * What marks the item you are on, once the fill stopped being brand-coloured.
 *
 * A deeper grey than a hover plus a brand label, where stock shadcn gives the
 * current item the same fill as a hovered one and separates the two by
 * font-weight alone. With both of them grey that reads as "something is under
 * the pointer" twice; the brand on the label says which one you are on without
 * putting a coloured slab behind it.
 *
 * EVERY STATE IS RESTATED, INCLUDING THE HOVER ONES, and that is not padding.
 * The obvious spelling is `data-active:*` alone, which loses: Tailwind compiles
 * a data- variant through :where(), which contributes no specificity, so
 * `data-active:text-brand` lands at (0,1,0) while the button's own
 * `hover:text-sidebar-accent-foreground` is (0,2,0) — hovering the current item
 * would drop its label back to ink. Matching the base's own modifiers instead
 * means tailwind-merge recognises each one as the same utility and drops it
 * from the class attribute altogether, so there is no competing rule left to
 * out-specify anything. Deleting the loser is the one move that does not depend
 * on the order Tailwind emitted its stylesheet; see lib/cn.ts.
 *
 * `active:` is the mouse-down state, not this app's notion of a current route —
 * it is here so the fill does not flicker lighter on press.
 *
 * --color-brand-ink rather than --color-brand: the plain brand reads 4.31:1 on
 * this fill, under what AA asks of a 14px label. See the token in globals.css.
 */
const CURRENT_ITEM =
  "data-active:bg-selected data-active:text-brand-ink " +
  "hover:bg-selected hover:text-brand-ink " +
  "active:bg-selected active:text-brand-ink";

type NavItem = {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => React.ReactNode;
};

export function CompanySidebar() {
  const pathname = usePathname();

  /* Company Profile is here rather than in the account menu, which is the
   * trade described in @/components/account-menu: a slot of nav width buys a
   * click of depth. It is worth it for the same reason the seeker's My Profile
   * is a tab — a company's public page is somewhere you go back to while
   * working, not somewhere you visit once to change a setting.
   *
   * It sits under a "Hiring" heading, which is a stretch for a page about the
   * company rather than about a role. One group of four beats two groups of
   * three and one; split it if a second non-hiring row ever arrives. */
  const hiring: NavItem[] = [
    { href: "/company", label: "Overview", Icon: GridIcon },
    { href: "/company/jobs", label: "Job Postings", Icon: BriefcaseIcon },
    { href: "/company/applicants", label: "Applicants", Icon: UserIcon },
    { href: "/company/profile", label: "Company Profile", Icon: BuildingIcon },
  ];

  return (
    <Sidebar
      collapsible="icon"
      className="border-border top-(--company-bar)! h-auto"
      aria-label="Company sections"
    >
      <SidebarContent className="pt-2">
        <Group label="Hiring" items={hiring} pathname={pathname} />
      </SidebarContent>
    </Sidebar>
  );
}

function Group({ label, items, pathname }: { label: string; items: NavItem[]; pathname: string }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu className={MENU}>
        {items.map(({ href, label: text, Icon }) => {
          /* Overview owns /company exactly; every other item owns its subtree,
           * so /company/jobs/new still lights Job Postings. Without the exact
           * case, Overview would be active on every company screen. */
          const active = href === "/company" ? pathname === href : pathname.startsWith(href);

          return (
            <SidebarMenuItem key={href}>
              <SidebarMenuButton
                isActive={active}
                tooltip={text}
                render={<Link href={href} />}
                className={cn(MENU_BUTTON, active && CURRENT_ITEM)}
              >
                <Icon className="size-4" />
                <span>{text}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
