import Link from "next/link";

import { AccountMenu, type AccountMenuItem } from "@/components/account-menu";
import { BellIcon, GearIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/shadcn/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { IconButton } from "@/components/ui/icon-button";
import { SearchField } from "@/components/ui/search-field";

import { CompanySidebar } from "./company-sidebar";

/**
 * Chrome shared by every company screen.
 *
 * A company is a different account type, not a different mode of the seeker
 * app: it posts roles and reads applicants, where a seeker reads roles and
 * sends applications. Everything under /company is behind this shell and
 * nothing else is.
 *
 * The prefix is what makes that split cheap. Route groups — the parentheses
 * around (seeker) — are invisible in the URL, so two of them cannot both own a
 * /profile, and Next.js fails the build when they try. A company has a profile
 * and so does a seeker, so the two audiences needed separate URL space rather
 * than separate layouts over shared URL space. It also means a single path
 * check guards the whole surface once auth exists.
 *
 * WHERE THE NAV WENT: this shell now has a left panel, and the tabs that used
 * to sit in the bar moved into it. Running both would mean two navigations for
 * one section and a reader having to learn which owns what. The bar keeps only
 * what is global to a company rather than to a section of it — the logo,
 * applicant search, notifications, the account menu.
 *
 * Post a Job is not among them, and that is the same rule applied once more.
 * It acts on one screen's subject rather than on the whole company, so it
 * belongs beside that screen's heading where the thing it creates is listed —
 * see app/company/jobs/page.tsx. A bar-level button would also claim to be
 * available everywhere while meaning nothing on Applicants or the profile.
 *
 * That is where the two shells stop resembling each other. The seeker bar is
 * still tabs-in-the-bar, because a seeker moves between four peer screens and a
 * panel would spend a fifth of the width on a list of four things. A company
 * accumulates roles and stages, which is what a panel is for. The earlier note
 * here proposed lifting a shared <TopBar items action> once both sides were
 * real; that is now the wrong move, and what is genuinely shared — the logo,
 * the account menu, the field — is already shared as components.
 *
 * The panel is a client component (it reads the pathname for its active state)
 * and so is its provider. Children still render on the server: a client
 * boundary wraps them, it does not absorb them. The TooltipProvider the panel's
 * collapsed tooltips need used to wrap this shell too; it is in the root layout
 * now, since the seeker shell's icon buttons need one as well.
 */
/* One row, now that Company Profile is a panel item. That is the same move the
 * seeker shell made with My Profile, and it lands the same way: the menu is
 * for what you change and leave, the nav is for what you come back to.
 *
 * A menu holding a single item is worth a second look — the alternative is a
 * bare gear beside the bell — but it is the right shape to leave in place while
 * the account rows are still arriving: sign out has nowhere else to go, and
 * neither will billing or notification preferences.
 *
 * /company/settings is not built. A link that 404s rather than a control that
 * does nothing, which is the placeholder both shells already use. */
const ACCOUNT_ITEMS: readonly AccountMenuItem[] = [
  { href: "/company/settings", label: "Settings", icon: <GearIcon className="size-4" /> },
];

export default function CompanyLayout({ children }: { children: React.ReactNode }) {
  return (
    /* flex-col, because SidebarProvider lays its children out in a row by
     * default — it assumes the panel owns the left edge and any header sits
     * inside the content beside it. Here the bar spans the full width above
     * both, so the provider becomes a column holding the bar and then the row.
     *
     * h-svh, not min-h-full, and that is what moves the scrollbar. A
     * min-height leaves the document as the thing that scrolls, so the bar
     * overlays a scrollbar that runs the whole window — a track beside the
     * logo, sliding under a bar it does not belong to. An exact viewport
     * height makes this column the full window and nothing more, so the only
     * thing that can scroll is the region below the bar, and its scrollbar
     * starts where it does. */
    <SidebarProvider
      className="bg-background h-svh flex-col"
      /* Read by the canvas rule in globals.css. <body> paints the strip an
         overscroll exposes and sits above this shell, so it cannot inherit
         the white --background this page paints; it matches on this instead. */
      data-shell="company"
      /* --company-bar is the bar's height, in one place. Both the bar and the
       * panel below it need it — the panel starts where the bar ends — and
       * when the two were written as separate h-16/top-16 literals there was
       * nothing linking them: changing one silently misaligned the other.
       *
       * The white page is not set here any more. This shell used to retarget
       * --background to --color-panel on its own; now that the seeker shell
       * is white too, the default in globals.css says so for both.
       *
       * SidebarProvider spreads `style` over its own, so this rides along
       * with the --sidebar-width it already sets. */
      style={{ "--company-bar": "4rem" } as React.CSSProperties}
    >
      {/* IN FLOW, AND IT NO LONGER NEEDS TO BE ANYTHING ELSE.
          This was `fixed`, over a long note about fixed versus sticky: the
          document scrolled, so the bar had to be pulled out of the flow to
          stay put, and `fixed` beat `sticky` because a sticky bar drifts on a
          rubber-band overscroll while the fixed panel beside it does not.

          Moving the scroll into the region below retires the whole argument.
          The bar is now a sibling of the scroller rather than a thing
          floating over it, so it cannot move: there is no scroll on this
          element to move it. That also settles the overscroll case the old
          note was worried about, since the bar and the panel are both outside
          what bounces. shrink-0 so a tall page cannot squeeze it, and z-20 to
          stay over the fixed panel's z-10. */}
      <header className="bg-panel border-border relative z-20 h-(--company-bar) shrink-0 border-b">
        <div className="mx-auto flex h-full w-full items-center gap-5 px-6">
          {/* An icon-only button that is not an IconButton — it is shadcn's,
              and owns the toggle — so it takes its tooltip here. The
              trigger renders as SidebarTrigger itself rather than wrapping
              it, which keeps the bar's flex row one element shorter. */}
          <Tooltip>
            <TooltipTrigger
              render={
                <SidebarTrigger className="text-ink-meta hover:text-ink hover:bg-transparent" />
              }
            />
            <TooltipContent>Toggle sidebar</TooltipContent>
          </Tooltip>

          <Link
            href="/company"
            className="focus-visible:ring-brand-ring flex shrink-0 rounded-xs focus-visible:ring-2 focus-visible:outline-none"
          >
            <Logo size="bar" priority />
          </Link>

          <SearchField
            id="applicant-search"
            label="Search applicants"
            name="q"
            placeholder="Name, skill, or role applied to"
            className="hidden min-w-0 md:block md:max-w-80 md:flex-1"
          />

          <div className="ml-auto flex items-center gap-5">
            <IconButton label="Notifications">
              <BellIcon className="size-5" />
            </IconButton>

            <AccountMenu name="Jordan Reyes" items={ACCOUNT_ITEMS} />
          </div>
        </div>
      </header>

      {/* min-h-0 is what lets the inset scroll at all. A flex item's default
          min-height is auto — it refuses to shrink below its content — so
          without this the row grows to fit the page, the column overflows
          h-svh, and the document is scrolling again. The padding that used to
          reserve the fixed bar's height is gone with the bar back in flow.

          The panel is still `fixed`, offset to --company-bar, which is why
          the token stays: it is positioned by the viewport, so it has to be
          told where the bar ends. It is not clipped by anything here — a
          fixed element's containing block is the viewport unless an ancestor
          carries a transform, and none does. */}
      <div className="flex min-h-0 w-full flex-1">
        <CompanySidebar />
        <SidebarInset className="flex-1 overflow-y-auto">{children}</SidebarInset>
      </div>
    </SidebarProvider>
  );
}
