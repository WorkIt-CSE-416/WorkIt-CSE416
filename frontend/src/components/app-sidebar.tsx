"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode } from "react";

import { Logo, LogoLockup } from "@/components/logo";
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

type NavRowBase = {
  label: string;
  /** A Lucide icon — see "THE ICONS ARE LUCIDE'S" above. */
  Icon: ComponentType<{ className?: string }>;
};

/** A row is a link to a section, or an action that is not a place, like
 *  Sign Out: a button drawn as the same row, never lit as current. */
export type SidebarNavItem = NavRowBase &
  (
    | {
        href: string;
        /** Lit on this exact path only. Without it an item owns its whole
         *  subtree, so /company/jobs/new still lights Job Postings; a shell's
         *  root item (/company) needs it, or it would be lit on every
         *  screen. */
        exact?: boolean;
      }
    | { action: () => void | Promise<void> }
  );

/** `label` is the small heading over the group; leave it out when the panel
 *  has one group and the rows speak for themselves. */
export type SidebarNavGroup = { label?: string; items: SidebarNavItem[] };

/**
 * FLOATING is the seeker shell's panel: a white rounded panel inset 12px on
 * the --color-frame ground, beside a top bar and a page drawn the same way,
 * after the floating-panel dashboards the user pointed at. It runs the full
 * height, so it carries the logo in its own header rather than leaving it to
 * the bar, and its group headings are small uppercase captions ("Menu",
 * "General"), the way those dashboards label a panel's sections.
 *
 * It is shadcn's default `sidebar` variant restyled, not its own `floating`
 * one. shadcn's floating variant pads the panel 8px and sizes the collapsed
 * rail and the in-flow gap beside it with two separate calc()s that both
 * assume that 8px, so a 12px inset would leave the gap 8px short of the
 * collapsed panel. The default variant sizes both from --sidebar-width and
 * --sidebar-width-icon alone, so the shell widens those by the inset (see
 * its layout.tsx) and the padding is just padding.
 *
 * DOCKED is the company shell's: the full-bleed lavender panel under a
 * full-width bar, offset by the bar's height. See "WHY IT IS OFFSET".
 */
const FLOATING =
  "p-3 group-data-[side=left]:border-r-0 " +
  "[&>[data-slot=sidebar-inner]]:rounded-shell [&>[data-slot=sidebar-inner]]:border-rail-border " +
  "[&>[data-slot=sidebar-inner]]:bg-panel [&>[data-slot=sidebar-inner]]:shadow-panel " +
  "[&>[data-slot=sidebar-inner]]:overflow-hidden [&>[data-slot=sidebar-inner]]:border";

/**
 * THE FLOATING PANEL'S SPACING is set on one vertical line, 28px in from the
 * panel's edge: the logo's mark, the "Menu" and "General" captions and every
 * row's icon start on it, as the reference dashboard lines up its logo,
 * section labels and icons. The docked panel's 16px put everything close
 * enough to the edge to read as crammed against it, and its logo 5px in.
 *
 * 28 is a 16px group inset plus 12px of row padding, and the numbers are
 * chosen so the icons do not move when the panel collapses. A row is 40px
 * tall, and on the rail it becomes a 40px square with the same 12px padding,
 * centred in a 72px rail by the same 16px inset: its icon's centre is 36px in
 * whether the panel is open (16 + 12 + 8) or collapsed (72 / 2). The rail was
 * 48px with 32px squares, which left 8px either side and felt pinched; 72
 * gives each icon 28px of air on both sides. The shell sets the matching
 * --sidebar-width-icon (72px plus the panel's 12px inset each side).
 *
 * The captions carry the same 12px inside the group as the rows, so their
 * text starts where the icons do, and each group gets 8px above and below so
 * the two read as separate sections rather than one list.
 */
const FLOATING_GROUP = "px-4 py-2";
const FLOATING_CAPTION = "text-caption text-ink-meta px-3 font-semibold uppercase";
const FLOATING_BUTTON =
  "h-10 px-3 group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-3!";

export function AppSidebar({
  groups,
  footer,
  footerCard,
  label,
  variant = "docked",
  home,
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
  /** The name of the panel's <nav> landmark, e.g. "Company Sections". */
  label: string;
  /** See FLOATING above. */
  variant?: "docked" | "floating";
  /** Where the floating panel's logo goes home to. */
  home?: string;
  /** The docked shell's bar offset; see "WHY IT IS OFFSET" above. */
  className?: string;
}) {
  const pathname = usePathname();
  const { isMobile } = useSidebar();
  const floating = variant === "floating";

  return (
    <Sidebar
      collapsible="icon"
      className={cn(floating ? FLOATING : "border-rail-border h-auto", className)}
    >
      {/* The sheet keeps shadcn's lavender, so on a phone the floating panel
          paints its own white to match the panels it opens over. */}
      <div className={cn("flex size-full min-h-0 flex-col", floating && "bg-panel")}>
        {isMobile && (
          <SidebarHeader className="border-rail-border h-16 shrink-0 flex-row items-center gap-3 border-b px-4 sm:px-8">
            <SidebarTrigger className="text-ink-meta hover:text-ink shrink-0 hover:bg-transparent [&_svg]:size-4" />
            {floating ? <LogoLockup /> : <Logo size="bar" />}
          </SidebarHeader>
        )}

        {floating && !isMobile && home && <PanelBrand href={home} />}

        <nav aria-label={label} className="flex min-h-0 flex-1 flex-col">
          <SidebarContent className={floating ? "gap-2 pt-3" : "pt-2"}>
            {groups.map((group, i) => (
              <SidebarGroup key={group.label ?? i} className={cn(floating && FLOATING_GROUP)}>
                {group.label && (
                  <SidebarGroupLabel className={cn(floating && FLOATING_CAPTION)}>
                    {group.label}
                  </SidebarGroupLabel>
                )}
                <SidebarMenu className={MENU}>
                  {group.items.map((item) => (
                    <NavRow key={item.label} item={item} pathname={pathname} floating={floating} />
                  ))}
                </SidebarMenu>
              </SidebarGroup>
            ))}
          </SidebarContent>

          {(footerCard || (footer && footer.length > 0)) && (
            <SidebarFooter className={cn("gap-3 pb-3", floating && "px-4 pb-4")}>
              {footerCard}
              {footer && footer.length > 0 && (
                <SidebarMenu className={MENU}>
                  {footer.map((item) => (
                    <NavRow key={item.label} item={item} pathname={pathname} />
                  ))}
                </SidebarMenu>
              )}
            </SidebarFooter>
          )}
        </nav>
      </div>
    </Sidebar>
  );
}

/**
 * The floating panel's logo: <LogoLockup> from @/components/logo, the mark
 * 40px tall (its ink about 37px square) beside the wordmark sized to about
 * 55% of it.
 *
 * Open, the mark's ink starts on the panel's 28px line with the captions and
 * the row icons (the image carries 1.4px of transparent padding, so the box
 * sits at 27px). Collapsed, it is centred in the 72px rail instead, its 43px
 * box at 14px: a mark wider than two icons cannot share both their left edge and
 * their centre. So the inset slides between the two on the panel's own 200ms
 * linear, the same time the width takes, while the wordmark fades and the
 * narrowing panel clips it. Nothing swaps mid-way and nothing jumps. The link
 * stays live on the rail, where the mark alone still goes home.
 *
 * 64px tall, the top bar's height, so the panel's header and the bar beside
 * it share one top line and one bottom line, and the logo sits on the bar's
 * centre line as the reference's does.
 */
function PanelBrand({ href }: { href: string }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <SidebarHeader
      className={cn(
        "h-16 shrink-0 flex-row items-center p-0 pl-[27px] transition-[padding] duration-200 ease-linear",
        collapsed && "pl-3.5",
      )}
    >
      <Link
        href={href}
        className="focus-visible:ring-brand-ring flex shrink-0 items-center rounded-xs focus-visible:ring-2 focus-visible:outline-none"
      >
        <LogoLockup priority wordmarkHidden={collapsed} />
      </Link>
    </SidebarHeader>
  );
}

function NavRow({
  item,
  pathname,
  floating = false,
}: {
  item: SidebarNavItem;
  pathname: string;
  floating?: boolean;
}) {
  const { label, Icon } = item;
  const { setOpenMobile } = useSidebar();
  const size = floating ? FLOATING_BUTTON : MENU_BUTTON;

  if ("action" in item) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={label}
          onClick={() => {
            setOpenMobile(false);
            void item.action();
          }}
          className={cn(size, "cursor-pointer")}
        >
          <Icon className="size-4" />
          <span>{label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  const { href, exact } = item;
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={label}
        render={<Link href={href} aria-current={active ? "page" : undefined} />}
        // Closes the phone sheet on the way out; a no-op on the desktop panel.
        onClick={() => setOpenMobile(false)}
        className={cn(size, active && CURRENT_ITEM)}
      >
        <Icon className="size-4" />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
