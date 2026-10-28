"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";

import { useSidebarPin } from "@/components/hover-sidebar";
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
  SidebarProvider,
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
 * THE ICONS ARE PHOSPHOR'S (KAN-350), the set every glyph in the app
 * draws, at its regular weight, so a nav row and a card's glyph weigh the
 * same. They were Lucide's, shadcn's own set, until the team found it read
 * as every AI-built dashboard's (components/icons.tsx).
 *
 * WHY IT IS OFFSET RATHER THAN FULL-HEIGHT: shadcn's Sidebar positions itself
 * `fixed inset-y-0 h-svh`, which assumes it owns the left edge of the viewport
 * and that any header sits inside the content area beside it. The company
 * shell keeps a full-width bar across the top instead, so its panel starts
 * where the bar ends: it passes `top-(--company-bar)!` as `className`, the
 * bar height its layout.tsx sets once. The seeker rail runs the full height,
 * with no offset. The override is
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
const CURRENT_ITEM = "data-active:text-brand-ink hover:text-brand-ink active:text-brand-ink";

/**
 * THE FILLS GLIDE. A row no longer paints its own hover or current fill;
 * each menu draws one hover highlight and one current highlight behind its
 * rows (GlideMenu below), and moves them. Pointing down the panel, the hover
 * fill travels from row to row instead of blinking off one and onto the
 * next; following a link, the current fill travels to the new section from
 * the click (GlideMenu says how), while the page changes beside it. Both
 * ride --ease-glide, 320ms.
 *
 * So every row clears the fills shadcn's button paints itself
 * (hover:, active: and data-active: bg-sidebar-accent), each restated with
 * the same modifier so tailwind-merge drops the original, as CURRENT_ITEM
 * explains. The icon still answers the pointer on its own: a 2px nudge
 * toward the label on hover, and a squeeze on press.
 */
const ROW =
  "transition-colors duration-150 hover:bg-transparent active:bg-transparent data-active:bg-transparent " +
  "[&>svg]:transition-transform [&>svg]:duration-200 [&>svg]:ease-glide " +
  "hover:[&>svg]:translate-x-0.5 active:[&>svg]:scale-90";

/** A rail tile's ROW: the same fills, the icon nudged up toward the name. */
const TILE_ROW =
  "transition-colors duration-150 hover:bg-transparent active:bg-transparent data-active:bg-transparent " +
  "[&>svg]:transition-transform [&>svg]:duration-200 [&>svg]:ease-glide " +
  "hover:[&>svg]:-translate-y-0.5 active:[&>svg]:scale-90";

/** How a menu draws its rows: the rail's tiles, the rail's phone sheet, or
 *  the company shell's docked rows. */
type RowLook = "tile" | "sheet" | "docked";

/**
 * Which row of a menu is the current section, or -1. `exact` rows match
 * only their own path (the company Home, whose path prefixes every
 * other); the rest also own the pages below them.
 */
function currentIndex(items: SidebarNavItem[], pathname: string) {
  return items.findIndex((item) => {
    if ("action" in item) return false;
    const { href, exact, also = [] } = item;
    const owns = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
    return exact ? pathname === href : owns(href) || also.some(owns);
  });
}

/**
 * One fill behind a menu's rows, placed by row index rather than measured:
 * every row in a menu is the same height (--row, set by GlideMenu for each
 * panel and for the collapsed rail) with MENU's 4px between, so row i starts
 * at i * (row + 4px). Nothing is measured, so the server draws the current
 * fill in place and nothing jumps when the page hydrates.
 *
 * `glide` false moves it without a transition, for the hover fill's first
 * appearance: arriving from outside the menu, it should appear under the
 * pointer, not slide in from wherever it last faded out. Width and height
 * follow the panel's own 200ms linear when it collapses to the rail.
 */
function Highlight({
  index,
  visible,
  glide,
  className,
}: {
  index: number;
  visible: boolean;
  glide: boolean;
  className: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute top-0 left-0 h-(--row) w-full rounded-md group-data-[collapsible=icon]:w-(--row)",
        className,
      )}
      style={{
        transform: `translateY(calc(${Math.max(index, 0)} * (var(--row) + 0.25rem)))`,
        opacity: visible ? 1 : 0,
        transition: glide
          ? "transform 320ms var(--ease-glide), opacity 150ms ease-out, width 200ms linear, height 200ms linear"
          : "opacity 150ms ease-out, width 200ms linear, height 200ms linear",
      }}
    />
  );
}

type NavRowBase = {
  label: string;
  /** The name a rail tile shows where `label` does not fit 72px; `label`
   *  must contain it, so the accessible name holds what is seen. */
  short?: string;
  /** A Phosphor icon — see "THE ICONS ARE PHOSPHOR'S" above. */
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
        /** Other paths this row owns, with their subtrees: one section shown
         *  as two routes, like Resumes & Experiences (/resumes and /bank). */
        also?: string[];
      }
    | { action: () => void | Promise<void> }
  );

/** `label` is the small heading over the group; leave it out when the panel
 *  has one group and the rows speak for themselves. */
export type SidebarNavGroup = { label?: string; items: SidebarNavItem[] };

/**
 * RAIL is the seeker shell's panel: a narrow column that is always open,
 * each section an icon with its name under it, after Jobright's and
 * LinkedIn's navigation (2026-10-27). It replaced a 256px panel that
 * collapsed to an icon rail and opened over the page on hover (KAN-300):
 * the user found the panel covering the page a flaw, and asked for one
 * that stays put, narrower, with bigger icons and the names beneath them.
 * So there is no pin and no peek, and the page never moves for the panel.
 *
 * 88px wide (--sidebar-width, set by the shell), white, flush with the
 * window and ruled off by one hairline. Each row is a 72px by 64px tile:
 * a 24px icon over a 12px name, centred, with 8px of panel either side. A
 * name that does not fit there takes its item's `short` ("Tracker" for
 * Applications Tracker), and the full name stays the link's accessible
 * name, which contains the short one.
 *
 * Below md the panel is shadcn's sheet, as before: there the rows go back
 * to an icon beside the full name (RAIL_SHEET_*), since a sheet has the
 * room and a phone reads a list faster than a grid of tiles.
 *
 * It is shadcn's default `sidebar` variant held open (RailSidebarProvider),
 * not its `collapsible="none"`, which would drop the phone's sheet.
 *
 * DOCKED is the company shell's: the full-bleed lavender panel under a
 * full-width bar, offset by the bar's height. See "WHY IT IS OFFSET".
 */
const RAIL = "group-data-[side=left]:border-border-subtle [&>[data-slot=sidebar-inner]]:bg-panel";
const RAIL_GROUP = "px-2 py-2";
const RAIL_BUTTON =
  "h-16 flex-col justify-center gap-1 px-1 text-center text-note leading-tight font-medium [&_svg]:size-6 " +
  // A lighter line than the app's other icons: at 24px globals.css's added
  // outline (KAN-365) drew a 2px line that read heavy beside the 12px
  // names (2026-10-27). About 1.7px for Phosphor's 256 grid (16 + 2) and
  // the custom glyphs' 24 grid alike.
  "[&_svg[viewBox='0_0_256_256']]:[stroke-width:2] [&_svg[viewBox='0_0_24_24']]:[stroke-width:1.7]";
const RAIL_SHEET_GROUP = "px-4 py-2";
const RAIL_SHEET_BUTTON = "h-10 px-3";
const RAIL_CAPTION = "text-caption text-ink-meta px-3 font-semibold uppercase";

/** The seeker shell's provider: shadcn's, held open on a desktop, so the
 *  bar's toggle and Ctrl or Cmd+B only open and close the phone's sheet. */
export function RailSidebarProvider(
  props: Omit<ComponentProps<typeof SidebarProvider>, "open" | "onOpenChange" | "defaultOpen">,
) {
  return <SidebarProvider {...props} open onOpenChange={() => {}} />;
}

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
  /** A card above the footer rows — the seeker's profile strength, which
   *  draws a compact form of itself on the rail. */
  footerCard?: ReactNode;
  /** Rows pinned to the bottom of the panel, apart from the sections: the
   *  things you visit to change how the app works rather than to work in it,
   *  like Settings. */
  footer?: SidebarNavItem[];
  /** The name of the panel's <nav> landmark, e.g. "Company Sections". */
  label: string;
  /** See RAIL above. */
  variant?: "docked" | "rail";
  /** Where the rail's logo goes home to. */
  home?: string;
  /** The docked shell's bar offset; see "WHY IT IS OFFSET" above. */
  className?: string;
}) {
  const pathname = usePathname();
  const { isMobile } = useSidebar();
  const { peeking, hoverProps } = useSidebarPin();
  const rail = variant === "rail";
  // The rail's tiles on a desktop; its sheet below md lists rows.
  const tiles = rail && !isMobile;

  return (
    <Sidebar
      collapsible="icon"
      className={cn(
        rail ? RAIL : "border-rail-border h-auto",
        // A peek opens over the page (hover-sidebar.tsx); the docked panel
        // has only a border, so it takes a shadow to read as above it.
        peeking && "shadow-panel",
        className,
      )}
      // Unpinned on a desktop, pointing at the rail or tabbing into it opens
      // it over the page. Never on the phone's sheet, which has no hover.
      {...(!isMobile && hoverProps)}
    >
      {/* The sheet keeps shadcn's lavender, so on a phone the seeker panel
          paints its own white to match the shell it opens over. */}
      <div className={cn("flex size-full min-h-0 flex-col", rail && "bg-panel")}>
        {isMobile && (
          <SidebarHeader className="border-rail-border h-16 shrink-0 flex-row items-center gap-3 border-b px-4 sm:px-8">
            <SidebarTrigger className="text-ink-meta hover:text-ink shrink-0 hover:bg-transparent [&_svg]:size-4" />
            {rail ? <LogoLockup /> : <Logo size="bar" />}
          </SidebarHeader>
        )}

        {tiles && home && <RailBrand href={home} />}

        <nav aria-label={label} className="flex min-h-0 flex-1 flex-col">
          <SidebarContent className="pt-2">
            {groups.map((group, i) => (
              <SidebarGroup
                key={group.label ?? i}
                className={cn(rail && (tiles ? RAIL_GROUP : RAIL_SHEET_GROUP))}
              >
                {group.label && (
                  <SidebarGroupLabel className={cn(rail && RAIL_CAPTION)}>
                    {group.label}
                  </SidebarGroupLabel>
                )}
                <GlideMenu
                  items={group.items}
                  pathname={pathname}
                  look={tiles ? "tile" : rail ? "sheet" : "docked"}
                />
              </SidebarGroup>
            ))}
          </SidebarContent>

          {(footerCard || (footer && footer.length > 0)) && (
            <SidebarFooter
              className={cn("gap-3 pb-3", rail && (tiles ? "px-2 pb-3" : "px-4 pb-4"))}
            >
              {footerCard}
              {footer && footer.length > 0 && <GlideMenu items={footer} pathname={pathname} />}
            </SidebarFooter>
          )}
        </nav>
      </div>
    </Sidebar>
  );
}

/**
 * The rail's logo: WorkIt's mark alone, centred in a 64px header with a
 * bottom rule, the top bar's height, so the header's rule and the bar's run
 * on as one line across the window. The wordmark does not fit 88px. It goes
 * home, and presses in on the click like every control.
 */
function RailBrand({ href }: { href: string }) {
  return (
    <SidebarHeader className="border-border-subtle h-16 shrink-0 flex-row items-center justify-center border-b p-0">
      <Link
        href={href}
        aria-label="WorkIt Home"
        className="focus-visible:ring-brand-ring flex shrink-0 items-center rounded-xs transition-transform duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none active:scale-[0.97]"
      >
        <Logo size="mark" />
      </Link>
    </SidebarHeader>
  );
}

/**
 * A menu with its two gliding fills: hover under the current, so pointing
 * at the current row leaves its stronger fill in charge. The hover fill
 * follows the pointer and keyboard focus (focus-visible only, so a click does
 * not leave it behind), and fades where it is when the pointer leaves.
 *
 * THE CURRENT FILL LEAVES ON THE CLICK, not when the new page commits. A
 * section the router has not prefetched waits on the server before its
 * pathname changes, and the fill, placed from the pathname, sat on the old
 * row for that whole wait, so the click looked ignored. Each row's link
 * reports while its navigation is pending (PendingMark, Next's
 * useLinkStatus), and the fill glides to that row at once, on the same
 * 320ms glide; its label takes the current colour with it. The pending row
 * holds only for the pathname it was clicked from, so the commit, or any
 * other move, hands the fill back to the pathname. `aria-current` stays on
 * the committed row: a screen reader is not told of a page that has not
 * loaded. A prefetched section (one with a loading.tsx) commits in the next
 * frame, and Next reports no pending state for it.
 */
function GlideMenu({
  items,
  pathname,
  look = "docked",
}: {
  items: SidebarNavItem[];
  pathname: string;
  look?: RowLook;
}) {
  const [hover, setHover] = useState<{ index: number; glide: boolean } | null>(null);
  const [lastHover, setLastHover] = useState(0);
  const [pending, setPending] = useState<{ index: number; from: string } | null>(null);
  const current = currentIndex(items, pathname);
  const lit = pending?.from === pathname ? pending.index : current;

  function highlight(index: number) {
    // Glide only from another row; from nothing, appear in place.
    setHover((previous) => ({ index, glide: previous !== null }));
    setLastHover(index);
  }

  /** A row's link started or stopped navigating. Returns the old state
   *  where nothing changes, so a report repeated by a re-render is free. */
  function report(index: number, isPending: boolean) {
    setPending((previous) => {
      if (isPending) {
        return previous?.index === index && previous.from === pathname
          ? previous
          : { index, from: pathname };
      }
      return previous?.index === index ? null : previous;
    });
  }

  return (
    <div
      className={cn(
        "relative",
        // A row's height: the rail's 64px tile, its sheet's 40px row, and
        // MENU_BUTTON's 36px open and shadcn's 32px square collapsed.
        look === "tile"
          ? "[--row:4rem]"
          : look === "sheet"
            ? "[--row:2.5rem]"
            : "[--row:2.25rem] group-data-[collapsible=icon]:[--row:2rem]",
      )}
      onPointerLeave={() => setHover(null)}
    >
      <Highlight
        index={hover?.index ?? lastHover}
        visible={hover !== null}
        glide={hover?.glide ?? false}
        className="bg-rail-hover"
      />
      <Highlight index={lit} visible={lit >= 0} glide className="bg-rail-selected" />
      <SidebarMenu className={cn(MENU, "relative")}>
        {items.map((item, i) => (
          <NavRow
            key={item.label}
            item={item}
            current={i === current}
            lit={i === lit}
            look={look}
            onHighlight={() => highlight(i)}
            onUnhighlight={() => setHover(null)}
            onPending={(isPending) => report(i, isPending)}
          />
        ))}
      </SidebarMenu>
    </div>
  );
}

function NavRow({
  item,
  current,
  lit,
  look = "docked",
  onHighlight,
  onUnhighlight,
  onPending,
}: {
  item: SidebarNavItem;
  /** The committed section's row: aria-current. */
  current: boolean;
  /** Drawn as current: the committed row, or the one whose navigation is
   *  pending (GlideMenu). */
  lit: boolean;
  look?: RowLook;
  onHighlight: () => void;
  onUnhighlight: () => void;
  onPending: (pending: boolean) => void;
}) {
  const { label, short, Icon } = item;
  const { setOpenMobile } = useSidebar();
  const tile = look === "tile";
  const size = tile ? RAIL_BUTTON : look === "sheet" ? RAIL_SHEET_BUTTON : MENU_BUTTON;
  const row = tile ? TILE_ROW : ROW;
  // A tile shows the short name; the full one stays the accessible name.
  const text = tile && short ? short : label;
  const name = text === label ? undefined : label;

  // Keyboard focus moves the hover fill too; a mouse click's focus does not.
  const focusProps = {
    onFocus: (event: { currentTarget: Element }) => {
      if (event.currentTarget.matches(":focus-visible")) onHighlight();
    },
    onBlur: onUnhighlight,
  };

  if ("action" in item) {
    return (
      <SidebarMenuItem onPointerEnter={onHighlight}>
        <SidebarMenuButton
          tooltip={label}
          onClick={() => {
            setOpenMobile(false);
            void item.action();
          }}
          {...focusProps}
          aria-label={name}
          className={cn(size, row, "cursor-pointer")}
        >
          <Icon aria-hidden className="size-4" />
          <span>{text}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem onPointerEnter={onHighlight}>
      <SidebarMenuButton
        isActive={lit}
        tooltip={label}
        render={
          <Link href={item.href} aria-current={current ? "page" : undefined} aria-label={name} />
        }
        // Closes the phone sheet on the way out; a no-op on the desktop panel.
        onClick={() => setOpenMobile(false)}
        {...focusProps}
        className={cn(size, row, lit && CURRENT_ITEM)}
      >
        <Icon aria-hidden className="size-4" />
        <span>{text}</span>
        <PendingMark onPending={onPending} />
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Inside a row's <Link> (SidebarMenuButton's render prop keeps its children
 * in the link): tells the menu when that link's navigation starts and ends,
 * through Next's useLinkStatus, which reads the nearest Link's state. Draws
 * nothing. The callback is read from a ref, so a re-render's new function
 * does not report again.
 */
function PendingMark({ onPending }: { onPending: (pending: boolean) => void }) {
  const { pending } = useLinkStatus();
  const report = useRef(onPending);
  useEffect(() => {
    report.current = onPending;
  });
  useEffect(() => {
    report.current(pending);
  }, [pending]);
  return null;
}
