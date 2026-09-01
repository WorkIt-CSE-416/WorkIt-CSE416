import Link from "next/link";

import { AccountMenu, type AccountMenuItem } from "@/components/account-menu";
import { BellIcon, GearIcon, UserIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/shadcn/sidebar";
import { TooltipProvider } from "@/components/shadcn/tooltip";
import { ButtonLink } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SearchField } from "@/components/ui/search-field";

import { CompanySidebar } from "./company-sidebar";
import { OPEN_ROLES, UNREAD_APPLICANTS } from "./data";

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
 * candidate search, the post button, notifications, the account menu.
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
 * and so are both providers. Children still render on the server: a client
 * boundary wraps them, it does not absorb them.
 */
const ACCOUNT_ITEMS: readonly AccountMenuItem[] = [
  { href: "/company/profile", label: "Company Profile", icon: <UserIcon className="size-4" /> },
  { href: "/company/settings", label: "Settings", icon: <GearIcon className="size-4" /> },
];

export default function CompanyLayout({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      {/* flex-col, because SidebarProvider lays its children out in a row by
          default — it assumes the panel owns the left edge and any header sits
          inside the content beside it. Here the bar spans the full width above
          both, so the provider becomes a column holding the bar and then the
          row. min-h-svh would add the bar's height to a full viewport and
          overflow; min-h-full is what the rest of the app uses. */}
      <SidebarProvider
        className="bg-background min-h-full flex-1 flex-col"
        /* Two values scoped to this shell.
         *
         * --company-bar is the bar's height, in one place. Both the bar and the
         * panel below it need it — the panel starts where the bar ends — and
         * when the two were written as separate h-16/top-16 literals there was
         * nothing linking them: changing one silently misaligned the other.
         *
         * --background is what makes the company pages white where the seeker
         * shell stays grey. Retargeting the role beats swapping bg-app for
         * bg-panel at each call site: `panel` means a card or the bar, so
         * painting a page with it would name the colour rather than the job,
         * and SidebarInset already paints bg-background — one override here
         * moves the page, the inset, and any shadcn component that grounds
         * itself against the page, all together. --color-app still backs the
         * seeker shell, untouched.
         *
         * SidebarProvider spreads `style` over its own, so both ride along with
         * the --sidebar-width it already sets. */
        style={
          {
            "--company-bar": "4rem",
            "--background": "var(--color-panel)",
          } as React.CSSProperties
        }
      >
        {/* FIXED, NOT STICKY, and that distinction is the whole reason this
            comment exists. A sticky element is positioned by its scroll
            container and travels with the document; a fixed one is positioned
            by the viewport and does not. The panel below is fixed — shadcn
            ships it that way — so a sticky bar put two different positioning
            models in one shell. They agree while the page sits still and part
            company the moment it overscrolls: rubber-band a trackpad and the
            document slides while the viewport does not, so the bar drifts and
            the panel stays, opening a gap that snaps shut. Same model for
            both, and the pair moves as one. */}
        <header className="bg-panel border-border fixed inset-x-0 top-0 z-20 h-(--company-bar) border-b">
          <div className="mx-auto flex h-full w-full items-center gap-5 px-6">
            <SidebarTrigger className="text-ink-meta hover:text-ink hover:bg-transparent" />

            <Link
              href="/company"
              className="focus-visible:ring-brand-ring flex shrink-0 rounded-xs focus-visible:ring-2 focus-visible:outline-none"
            >
              <Logo size="bar" priority />
            </Link>

            <SearchField
              id="candidate-search"
              label="Search candidates"
              name="q"
              placeholder="Name, skill, or role applied to"
              className="hidden min-w-0 md:block md:max-w-80 md:flex-1"
            />

            <div className="ml-auto flex items-center gap-5">
              <ButtonLink href="/company/jobs/new">Post a Job</ButtonLink>

              <IconButton label="Notifications">
                <BellIcon className="size-5" />
              </IconButton>

              <AccountMenu name="Jordan Reyes" items={ACCOUNT_ITEMS} />
            </div>
          </div>
        </header>

        {/* The bar is out of flow now that it is fixed, so the row has to
            reserve its height rather than start underneath it. */}
        <div className="flex w-full flex-1 pt-(--company-bar)">
          <CompanySidebar openRoles={OPEN_ROLES} unreadApplicants={UNREAD_APPLICANTS} />
          <SidebarInset className="flex-1">{children}</SidebarInset>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}
