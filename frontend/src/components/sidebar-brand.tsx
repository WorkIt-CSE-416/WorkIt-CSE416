"use client";

import Link from "next/link";

import { Logo } from "@/components/logo";
import { SidebarTrigger, useSidebar } from "@/components/shadcn/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { cn } from "@/lib/cn";

/**
 * The top bar's left cell: the sidebar toggle and the logo, in a cell exactly
 * as wide as the panel below it, ruled off on the right where the panel is.
 * Both shells open their bar with it, so the corner is the same frame whether
 * the panel below lists a seeker's sections or a company's. `href` is where
 * the logo goes home to: /dashboard for a seeker, /company for a company.
 * The bar and the panel then read as one frame around the page, the way a
 * dashboard's corner does, instead of a bar whose logo and search float at
 * their own offsets above a panel edge that lines up with nothing.
 *
 * It is painted the rail's lavender (--color-rail) with the rail's border, so
 * from md the corner and the panel are one coloured L around the white page.
 *
 * The widths are shadcn's own --sidebar-width and --sidebar-width-icon, set on
 * the provider, so the cell cannot drift from the panel; and it eases on the
 * same 200ms linear as the panel's gap, so the rule moves with the edge.
 *
 * COLLAPSED, THE CELL IS THE RAIL'S 48px AND HOLDS THE TOGGLE ALONE. The logo
 * is hidden rather than moved: the lockup does not fit in 48px, and carrying
 * it over the rule to sit beside the search field put the brand in two
 * different places depending on a toggle.
 *
 * NOTHING ABOUT THE TOGGLE CHANGES WITH THE STATE — only the cell's width
 * does — because the width animates and everything else would not. The cell
 * used to switch to justify-center and drop its padding on collapse, which
 * applied at once while the width was still 256px, so the toggle leapt to
 * the middle of the wide cell, out from under the pointer, and slid back as
 * the cell closed. Unmounting the logo had the mirror fault on the way out:
 * it reappeared at full size in a 48px cell, and the flex row squeezed the
 * toggle to its 16px glyph until the width caught up. So: the toggle keeps
 * one 10px inset, which is already centred on the rail icons' 24px line in a
 * 48px cell, and is shrink-0; and the logo stays mounted at its full size,
 * clipped by the narrowing cell's overflow-hidden while it fades on the same
 * 200ms. `inert` takes it out of the tab order and the accessibility tree
 * while it can't be seen, which unmounting used to do.
 *
 * The toggle's glyph is 16px, the rail icons' size, by `[&_svg]:size-4`.
 * shadcn's own button base sizes an svg for it; WorkIt's Button does not, so
 * without this the PanelLeft glyph fell back to Lucide's 24px and was the
 * heaviest mark at the top of the column. It is set here rather than in the
 * Button base, which would resize the glyph in every Button.
 *
 * BELOW md THERE IS NO PANEL TO MATCH — it opens as a sheet — so the cell
 * drops its width and rule and is just the toggle and the logo, on the page
 * gutter's own 16px and 32px insets (SEEKER_GUTTER), so the toggle starts on
 * the heading's left edge rather than 8px short of it. md is 768px,
 * the same line useIsMobile draws, so the CSS and the JS agree on which
 * layout is showing.
 *
 * A client component because the open state lives in the sidebar's React
 * context: the panel carries data-state, but it comes after the bar in the
 * DOM, so no CSS selector in the bar can read it.
 */
export function SidebarBrand({ href }: { href: string }) {
  const { state, isMobile } = useSidebar();
  const collapsed = !isMobile && state === "collapsed";

  return (
    <div
      className={cn(
        "flex h-full shrink-0 items-center gap-3 overflow-hidden px-4 sm:px-8",
        "md:border-rail-border md:bg-rail md:w-(--sidebar-width) md:border-r md:pr-4 md:pl-2.5 md:transition-[width] md:duration-200 md:ease-linear",
        collapsed && "md:w-(--sidebar-width-icon)",
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarTrigger className="text-ink-meta hover:text-ink shrink-0 hover:bg-transparent [&_svg]:size-4" />
          }
        />
        <TooltipContent>Toggle sidebar</TooltipContent>
      </Tooltip>

      <LogoLink href={href} hidden={collapsed} />
    </div>
  );
}

function LogoLink({ href, hidden }: { href: string; hidden: boolean }) {
  return (
    <Link
      href={href}
      inert={hidden}
      className={cn(
        "focus-visible:ring-brand-ring flex shrink-0 rounded-xs transition-opacity duration-200 ease-linear focus-visible:ring-2 focus-visible:outline-none",
        hidden && "opacity-0",
      )}
    >
      <Logo size="bar" priority />
    </Link>
  );
}
