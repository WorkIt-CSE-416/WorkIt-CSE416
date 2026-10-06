import { cookies } from "next/headers";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Logo } from "@/components/logo";
import { NotificationsMenu } from "@/components/notifications-menu";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/shadcn/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { getSessionUser } from "@/lib/session";

import { SeekerAccount, SeekerStatusLine } from "./account-status";
import { BAR_CIRCLE } from "./bar";
import { MobileSearch } from "./mobile-search";
import { ProfileStrength } from "./profile-strength";
import { QueryField } from "./search/query-field";
import { SeekerSidebar } from "./seeker-sidebar";

/**
 * Chrome shared by every signed-in seeker screen: three white rounded panels
 * floating on a lavender ground (--color-frame). The section panel runs the
 * full height on the left; beside it, the top bar, and under the bar the page
 * itself. It replaced a docked layout (a full-width bar ruled off from a
 * full-bleed panel and a white page) after the user pointed at a dashboard
 * built this way: separate rounded panels read as calmer and more finished
 * than one box cut into regions by hairlines.
 *
 * THE INSET IS 12px EVERYWHERE: around the window's edge, between the panel
 * and the bar, and between the bar and the page. The panel pads itself 12px
 * (FLOATING in @/components/app-sidebar), which is why --sidebar-width and
 * --sidebar-width-icon are set here 24px wider than shadcn's own: the panel
 * keeps its 256px open and a 48px collapsed rail, and the in-flow gap shadcn
 * keeps beside it stays the panel's exact width in both states. The column
 * beside it pads itself the same 12px on every side but the left, where the
 * panel's own padding already is. Below md the panel is a sheet, so the
 * column takes the left edge too, and the inset tightens to 8px on a phone,
 * where 12px would be 24px of a 375px screen.
 *
 * The panel's open or collapsed state survives a reload: shadcn writes it to
 * the sidebar_state cookie on every toggle, and this layout reads it back as
 * the provider's defaultOpen, so the page does not open expanded and jump
 * when the user collapses it again.
 *
 * THE BAR holds the toggle, the job search and, on the right, the account:
 * the new-roles status when there is news (from xl), the bell, and the photo
 * with the full name and email beside it from lg. That last is a label, not
 * a menu: Sign Out is a row in the panel's General group.
 *
 * SIGNED OUT, NOTHING HERE RENDERS: the layout sends the visitor to /login
 * before drawing anything, because every screen behind it is someone's own
 * search. So the bar always has an account to show and the panel always
 * offers Sign Out. The proxy only refreshes sessions (see src/proxy.ts); the
 * API checks every token itself, so this is the shell's rule, not security. The logo moved into the panel's header, which
 * now owns the top-left corner; below md, where the panel is a sheet, the bar
 * shows it again beside the toggle. The bell and the phone's search
 * magnifier are white 40px circles (./bar.ts), the photo's size, so the
 * right-hand cluster is one height.
 *
 * The search field sits in the shared bar rather than on a page because
 * searching jobs is global. It is a GET form to /search, so Enter lands the
 * query there as ?q; next/form makes that a client-side navigation. On
 * /search the field keeps showing that query (./search/query-field.tsx reads
 * it, since a layout gets no searchParams). It grows into whatever the bar
 * has spare and stops at 320px. Below md a magnifier takes its place and
 * opens the same field in a sheet; see ./mobile-search.tsx. The bell steps
 * out below sm, where the bar has room for the toggle, the logo, the
 * magnifier and the photo and little else.
 *
 * THE PAGE PANEL is the one scrolling element, so the bar and the section
 * panel stay put and a scrollbar runs only beside the page. It is
 * @container/main, because the page's room depends on the panel as well as
 * the window, and seeker pages break on that width. SidebarInset renders the
 * <main>, so pages render a <div>; it is the skip link's target.
 */

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Every seeker screen is for a signed-in seeker, so the shell never draws
  // a signed-out state: no account, no shell. Verified claims rather than
  // /auth/me, so the check never waits on the API.
  if (!(await getSessionUser())) redirect("/login");

  const defaultOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    /* h-svh makes this row the window, so the only thing left to scroll is
       the page panel: a min-height would hand the scroll back to the
       document, and the bar and the panel would scroll away with it. */
    <SidebarProvider
      defaultOpen={defaultOpen}
      className="bg-frame h-svh"
      /* Read by the canvas rule in globals.css, which paints the overscroll
         strip the frame's lavender to match. */
      data-shell="seeker"
      style={
        {
          "--sidebar-width": "17.5rem",
          "--sidebar-width-icon": "4.5rem",
        } as React.CSSProperties
      }
    >
      {/* The first stop on every page, shown only once focused, so a keyboard
          user can step past the panel and the bar to the page itself. The
          padding is focus: too, because sr-only zeroes it and the focus:
          variant is what comes after it in the stylesheet. */}
      <a
        href="#content"
        className="bg-panel rounded-control text-label text-ink shadow-panel focus-visible:ring-brand-ring sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus-visible:ring-2 focus-visible:outline-none"
      >
        Skip to Content
      </a>

      <SeekerSidebar
        card={
          <Suspense fallback={null}>
            <ProfileStrength />
          </Suspense>
        }
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-2 sm:gap-3 sm:p-3 md:pl-0">
        <header className="bg-panel border-rail-border shadow-panel rounded-shell flex h-16 shrink-0 items-center gap-3 border px-3 sm:gap-4 sm:px-4">
          <Tooltip>
            <TooltipTrigger
              render={
                <SidebarTrigger className="text-ink-meta hover:text-ink hover:bg-hover size-10 shrink-0 rounded-full [&_svg]:size-4" />
              }
            />
            <TooltipContent>Toggle sidebar</TooltipContent>
          </Tooltip>

          {/* The panel's header carries the logo from md; below that the
              panel is a sheet and the bar is the only place left for it. */}
          <Link
            href="/dashboard"
            className="focus-visible:ring-brand-ring flex shrink-0 rounded-xs focus-visible:ring-2 focus-visible:outline-none md:hidden"
          >
            <Logo size="bar" priority className="h-9" />
          </Link>

          <Form
            action="/search"
            role="search"
            className="hidden min-w-0 md:block md:max-w-80 md:flex-1"
          >
            <QueryField id="job-search" />
          </Form>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {/* Streamed: each waits on the API, and nothing else in the bar
                or the page should wait with it. The account's fallback holds
                the photo's 40px and, from lg, the name and email's two
                lines, so the bar doesn't shift when they land. */}
            <Suspense fallback={null}>
              <SeekerStatusLine />
            </Suspense>

            <MobileSearch />

            <NotificationsMenu className={BAR_CIRCLE}>
              New matches and replies from employers will show up here.
            </NotificationsMenu>

            <Suspense fallback={<AccountSkeleton />}>
              <SeekerAccount />
            </Suspense>
          </div>
        </header>

        {/* min-h-0 because a flex item will not shrink below its content by
            default, which would push the column past h-svh and hand the
            scroll back to the document. overscroll-contain so a fling that
            outruns the page does not chain onto the document. */}
        <SidebarInset
          id="content"
          tabIndex={-1}
          className="bg-panel border-rail-border shadow-panel rounded-shell @container/main min-h-0 flex-1 overflow-y-auto overscroll-contain border focus:outline-none"
        >
          {children}
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

/** The account's shape while /auth/me is in flight: the photo's circle and,
 *  from lg, two bars where the name and email will be. */
function AccountSkeleton() {
  return (
    <div aria-hidden="true" className="flex items-center gap-3">
      <span className="bg-hover size-10 rounded-full" />
      <span className="hidden flex-col gap-1.5 lg:flex">
        <span className="bg-hover h-3 w-28 rounded-full" />
        <span className="bg-hover h-2.5 w-36 rounded-full" />
      </span>
    </div>
  );
}
