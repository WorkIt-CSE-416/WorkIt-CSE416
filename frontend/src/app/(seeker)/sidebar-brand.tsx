"use client";

import Link from "next/link";

import { Logo } from "@/components/logo";
import { SidebarTrigger, useSidebar } from "@/components/shadcn/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { cn } from "@/lib/cn";

/**
 * The top bar's left cell: the sidebar toggle and the logo, in a cell exactly
 * as wide as the panel below it, ruled off on the right where the panel is.
 * The bar and the panel then read as one frame around the page, the way a
 * dashboard's corner does, instead of a bar whose logo and search float at
 * their own offsets above a panel edge that lines up with nothing.
 *
 * The widths are shadcn's own --sidebar-width and --sidebar-width-icon, set on
 * the provider, so the cell cannot drift from the panel; and it eases on the
 * same 200ms linear as the panel's gap, so the rule moves with the edge.
 *
 * COLLAPSED, THE CELL IS THE RAIL'S 48px AND HOLDS THE TOGGLE ALONE, centred
 * over the rail's icons. The lockup does not fit in 48px, so it steps out of
 * the cell to the far side of the rule (<CollapsedLogo>, rendered in the
 * bar's content area) rather than disappearing: the brand stays on screen at
 * every state. The toggle sits 10px in when open for the same reason, which
 * puts its centre on the rail icons' 24px line in both states.
 *
 * BELOW md THERE IS NO PANEL TO MATCH — it opens as a sheet — so the cell
 * drops its width and rule and is just the toggle and the logo. md is 768px,
 * the same line useIsMobile draws, so the CSS and the JS agree on which
 * layout is showing.
 *
 * A client component because the open state lives in the sidebar's React
 * context: the panel carries data-state, but it comes after the bar in the
 * DOM, so no CSS selector in the bar can read it.
 */
export function SidebarBrand() {
  const { state, isMobile } = useSidebar();
  const collapsed = !isMobile && state === "collapsed";

  return (
    <div
      className={cn(
        "flex h-full shrink-0 items-center gap-3 overflow-hidden px-4 sm:px-6",
        "md:border-border md:w-(--sidebar-width) md:border-r md:pr-4 md:pl-2.5 md:transition-[width] md:duration-200 md:ease-linear",
        collapsed && "md:w-(--sidebar-width-icon) md:justify-center md:px-0",
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={<SidebarTrigger className="text-ink-meta hover:text-ink hover:bg-transparent" />}
        />
        <TooltipContent>Toggle sidebar</TooltipContent>
      </Tooltip>

      {!collapsed && <LogoLink />}
    </div>
  );
}

/** The logo on the content side of the rule, while the cell is too narrow to
 *  hold it. See <SidebarBrand>. */
export function CollapsedLogo() {
  const { state, isMobile } = useSidebar();
  if (isMobile || state !== "collapsed") return null;

  return <LogoLink />;
}

function LogoLink() {
  return (
    <Link
      href="/"
      className="focus-visible:ring-brand-ring flex shrink-0 rounded-xs focus-visible:ring-2 focus-visible:outline-none"
    >
      <Logo size="bar" priority />
    </Link>
  );
}
