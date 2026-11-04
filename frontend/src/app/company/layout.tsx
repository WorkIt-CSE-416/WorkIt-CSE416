import Form from "next/form";
import { cookies } from "next/headers";

import { signOut } from "@/app/actions";
import { AccountMenu } from "@/components/account-menu";
import { NotificationsMenu } from "@/components/notifications-menu";
import { HoverSidebarProvider } from "@/components/hover-sidebar";
import { SidebarInset } from "@/components/shadcn/sidebar";
import { SidebarBrand } from "@/components/sidebar-brand";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../(seeker)/gutter";
import { CompanyBarTitle } from "./bar-title";
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
 * see app/company/jobs/(list)/page.tsx. A bar-level button would also claim to be
 * available everywhere while meaning nothing on Applicants or the profile.
 *
 * The seeker shell has since moved to a flat rail (see (seeker)/layout.tsx);
 * this bar keeps the docked layout: <SidebarBrand> as the lavender corner
 * cell the panel's width, then a row on the pages' own gutter (./frame.ts),
 * so the page's title starts on the page's left edge. Settings sits at the
 * foot of the panel in both, so the account menu is your name and Sign Out.
 * What is shared is shared as components (the corner, the panel, the bell,
 * the account menu, the field); each layout keeps only its own search
 * target and copy, which is why there is still no <TopBar>.
 *
 * THE PAGE'S TITLE IS IN THE BAR, as on the seeker side (KAN-582,
 * ./bar-title.tsx): no company page draws its own heading or description
 * under the bar, and every page stands on the grey ground in the seeker's
 * 1440px column (docs/design.md, The two shells).
 *
 * The bar's search is a GET form to /company/applicants, so Enter lands the
 * query there as ?q. The applicants table filters on name alone, and the
 * placeholder says so.
 *
 * The panel is pinned open or opens on hover (KAN-300,
 * components/hover-sidebar.tsx), and the pin survives a reload: it is the
 * company_sidebar_pinned cookie (named there too), which this layout reads
 * back as defaultPinned. Not shadcn's sidebar_state, which a Ctrl or Cmd+B
 * on the seeker rail writes.
 *
 * The panel is a client component (it reads the pathname for its active state)
 * and so is its provider. Children still render on the server: a client
 * boundary wraps them, it does not absorb them. The TooltipProvider the panel's
 * collapsed tooltips need used to wrap this shell too; it is in the root layout
 * now, since the seeker shell's icon buttons need one as well.
 */
export default async function CompanyLayout({ children }: { children: React.ReactNode }) {
  const defaultOpen = (await cookies()).get("company_sidebar_pinned")?.value !== "false";

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
    <HoverSidebarProvider
      defaultPinned={defaultOpen}
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
       * The page's colour is not set here: the white --background is the
       * bar's and the panel's, and the page's grey is on the SidebarInset
       * below.
       *
       * SidebarProvider spreads `style` over its own, so this rides along
       * with the --sidebar-width it already sets. */
      style={{ "--company-bar": "4rem" } as React.CSSProperties}
    >
      {/* The first stop on every page, shown only once focused, so a keyboard
          user can step past the bar and the panel to the page itself. The
          padding is focus: too, because sr-only zeroes it and the focus:
          variant is what comes after it in the stylesheet. */}
      <a
        href="#content"
        className="bg-panel rounded-control text-label text-ink shadow-panel focus-visible:ring-brand-ring sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus-visible:ring-2 focus-visible:outline-none"
      >
        Skip to Content
      </a>

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
          stay over the fixed panel's z-10.

          Two cells, ruled where the panel's edge is: the corner the panel's
          width, then the title, the search and the account on the pages'
          gutter. From md the bar's rule runs under the second cell only, so
          the panel's edge runs up through the corner unbroken and the rule
          stops at it; across the corner too, the two crossed in a "+"
          (2026-11-03). Below md there is no docked panel, and the rule runs
          the bar's width. The title takes its own width and the search what is
          left, up to 20rem; past the search's 10rem floor the title gives
          way (it truncates). */}
      <header className="bg-panel border-border relative z-20 flex h-(--company-bar) shrink-0 border-b md:border-b-0">
        <SidebarBrand href="/company" />

        <div
          className={cn(
            "md:border-border flex h-full min-w-0 flex-1 items-center gap-4 sm:gap-5 md:border-b",
            SEEKER_GUTTER,
          )}
        >
          <div className="min-w-0">
            <CompanyBarTitle />
          </div>

          <Form
            action="/company/applicants"
            role="search"
            className="ml-auto hidden min-w-40 md:block md:max-w-80 md:flex-1"
          >
            <SearchField
              id="applicant-search"
              label="Search Applicants"
              name="q"
              placeholder="Search applicants by name"
              enterKeyHint="search"
              className="w-full"
            />
          </Form>

          <div className="ml-auto flex shrink-0 items-center gap-4 sm:gap-5 md:ml-0">
            <NotificationsMenu>
              New applicants and team activity will show up here.
            </NotificationsMenu>

            {/* Settings is the panel's footer row, so Sign Out is the menu's
                one item under the name. */}
            <AccountMenu name="Jordan Reyes" items={[]} onSignOut={signOut} />
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
          carries a transform, and none does.

          @container/main, overscroll-y-none and the skip link's target, as
          in the seeker shell: pages break on the width beside the panel, a
          fling cannot chain onto the document, and tabIndex -1 lets the
          <main> take focus without adding a tab stop. bg-app is the seeker's
          near-white ground (2026-11-03), and the white cards and tables
          stand on their dark control edge; the bar and the panel stay white. */}
      <div className="flex min-h-0 w-full flex-1">
        <CompanySidebar />
        <SidebarInset
          id="content"
          tabIndex={-1}
          className="bg-app @container/main flex-1 overflow-y-auto overscroll-y-none focus:outline-none"
        >
          {children}
        </SidebarInset>
      </div>
    </HoverSidebarProvider>
  );
}
