"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode } from "react";

import { Logo } from "@/components/logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/shadcn/sidebar";
import { cn } from "@/lib/cn";

/**
 * The left panel both shells hang their sections off: shadcn's Sidebar, with
 * WorkIt's row spacing and current-item marking. It started as the company
 * shell's panel and moved here when the seeker shell took the same layout, so
 * the two panels cannot drift apart one fix at a time. What goes in it is
 * each shell's call; see company/company-sidebar.tsx and
 * (seeker)/seeker-sidebar.tsx.
 *
 * THE ICONS ARE LUCIDE'S, shadcn's own set (components.json's iconLibrary).
 * Lucide's are the ones people know from every other dashboard, drawn on one
 * grid by one hand. The panel was the first place they were used; the shared
 * glyphs in components/icons.tsx have since moved to Lucide too, at its
 * default stroke, so a nav row and a card's glyph weigh the same.
 *
 * WHY IT IS OFFSET RATHER THAN FULL-HEIGHT: shadcn's Sidebar positions itself
 * `fixed inset-y-0 h-svh`, which assumes it owns the left edge of the viewport
 * and that any header sits inside the content area beside it. Both shells keep
 * a full-width bar across the top instead, so the panel starts where the bar
 * ends. Each shell passes `top-(--company-bar)!` or `top-(--seeker-bar)!` as
 * `className`: the bar height its own layout.tsx sets once. The override is
 * passed in rather than edited into components/shadcn/sidebar.tsx, which
 * `shadcn add` regenerates.
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
 * ON A PHONE THE PANEL IS A SHEET, and the sheet opens at the top of the
 * viewport, over the bar and the toggle that opened it. So it carries its own
 * 64px header, the toggle and the logo on the bar's own insets, ruled where
 * the bar is: the control that opened the sheet sits in the same spot and
 * closes it. Tapping a row closes it too. shadcn's sheet only closes on a
 * scrim tap or Escape, and this shell stays mounted across the navigation, so
 * the sheet would otherwise sit open over the page the row just opened.
 *
 * THE ROWS ARE A <nav> named by `label`. shadcn's Sidebar renders a plain
 * div, so the name used to sit on an element with no role and the panel was
 * not a landmark. The <nav> wraps the footer as well as the sections, which
 * keeps Settings inside the landmark, and is the flex column that keeps the
 * footer pinned to the bottom. The current row carries aria-current="page",
 * so it is announced and not only coloured.
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
 * A deeper lavender than a hover (--color-rail-selected over
 * --color-rail-hover) plus a brand label, where stock shadcn gives the
 * current item the same fill as a hovered one and separates the two by
 * font-weight alone. With both fills alike that reads as "something is under
 * the pointer" twice; the brand on the label says which one you are on
 * without putting a saturated slab behind it.
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
  "data-active:bg-rail-selected data-active:text-brand-ink " +
  "hover:bg-rail-selected hover:text-brand-ink " +
  "active:bg-rail-selected active:text-brand-ink";

export type SidebarNavItem = {
  href: string;
  label: string;
  /** A Lucide icon — see "THE ICONS ARE LUCIDE'S" above. */
  Icon: ComponentType<{ className?: string }>;
  /** Lit on this exact path only. Without it an item owns its whole subtree,
   *  so /company/jobs/new still lights Job Postings; a shell's root item
   *  (/company) needs it, or it would be lit on every screen. */
  exact?: boolean;
};

/** `label` is the small heading over the group; leave it out when the panel
 *  has one group and the rows speak for themselves, as the seeker's does. */
export type SidebarNavGroup = { label?: string; items: SidebarNavItem[] };

export function AppSidebar({
  groups,
  footer,
  footerCard,
  label,
  className,
}: {
  groups: SidebarNavGroup[];
  /** A card above the footer rows — the seeker's profile strength. It hides
   *  itself on the collapsed rail. */
  footerCard?: ReactNode;
  /** Rows pinned to the bottom of the panel, apart from the sections: the
   *  things you visit to change how the app works rather than to work in it,
   *  like Settings. */
  footer?: SidebarNavItem[];
  /** The name of the panel's <nav> landmark, e.g. "Company sections". */
  label: string;
  /** The shell's bar offset — see "WHY IT IS OFFSET" above. */
  className?: string;
}) {
  const pathname = usePathname();
  const { isMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon" className={cn("border-rail-border h-auto", className)}>
      {isMobile && (
        <SidebarHeader className="border-rail-border h-16 shrink-0 flex-row items-center gap-3 border-b px-4 sm:px-8">
          <SidebarTrigger className="text-ink-meta hover:text-ink shrink-0 hover:bg-transparent [&_svg]:size-4" />
          <Logo size="bar" />
        </SidebarHeader>
      )}

      <nav aria-label={label} className="flex min-h-0 flex-1 flex-col">
        <SidebarContent className="pt-2">
          {groups.map((group, i) => (
            <SidebarGroup key={group.label ?? i}>
              {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
              <SidebarMenu className={MENU}>
                {group.items.map((item) => (
                  <NavRow key={item.href} item={item} pathname={pathname} />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>

        {(footerCard || (footer && footer.length > 0)) && (
          <SidebarFooter className="gap-3 pb-3">
            {footerCard}
            <SidebarMenu className={MENU}>
              {footer?.map((item) => (
                <NavRow key={item.href} item={item} pathname={pathname} />
              ))}
            </SidebarMenu>
          </SidebarFooter>
        )}
      </nav>
    </Sidebar>
  );
}

function NavRow({ item, pathname }: { item: SidebarNavItem; pathname: string }) {
  const { href, label, Icon, exact } = item;
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={label}
        render={<Link href={href} aria-current={active ? "page" : undefined} />}
        // Closes the phone sheet on the way out; a no-op on the desktop panel.
        onClick={() => setOpenMobile(false)}
        className={cn(MENU_BUTTON, active && CURRENT_ITEM)}
      >
        <Icon className="size-4" />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
