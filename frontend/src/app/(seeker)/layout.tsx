import { cookies } from "next/headers";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { LogoLockup } from "@/components/logo";
import { NotificationsMenu } from "@/components/notifications-menu";
import { ScoutLauncher } from "@/components/scout/scout-buttons";
import { ScoutPanel } from "@/components/scout/scout-panel";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/shadcn/sidebar";
import { ShallowRouting } from "@/components/shallow-routing";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { getSessionUser } from "@/lib/session";

import { SeekerAccount } from "./account-status";
import { BAR_CIRCLE } from "./bar";
import { MobileSearch } from "./mobile-search";
import { ProfileCacheProvider } from "./profile-cache";
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
 * keeps its 256px open and a 72px collapsed rail, and the in-flow gap shadcn
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
 * THE BAR holds the toggle, the job search and, on the right, Scout, the
 * bell, and the photo with the full name and email beside it from lg. It
 * had a "N New Roles Since Yesterday" pill from xl too; it was taken out as
 * a distraction, and a bar message comes back only when it is worth one. That last opens the
 * account menu: Settings, Help and Sign Out, which live there and nowhere
 * else.
 *
 * SIGNED OUT, NOTHING HERE RENDERS: the layout sends the visitor to /login
 * before drawing anything, because every screen behind it is someone's own
 * search. So the bar always has an account to show and the panel always
 * offers Sign Out. The proxy only refreshes sessions (see src/proxy.ts); the
 * API checks every token itself, so this is the shell's rule, not security. The logo moved into the panel's header, which
 * now owns the top-left corner; below md, where the panel is a sheet, the bar
 * shows it again beside the toggle. The search is a light grey pill and the
 * bell and the phone's search magnifier are 40px circles in the same grey
 * (./bar.ts), none of them outlined, all the photo's height, so the bar
 * reads as one family of soft shapes. The toggle is a bare glyph that takes
 * the same fill on hover.
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
 * panel stay put and a scrollbar runs only beside the page. SidebarInset
 * renders the <main>, so pages render a <div>; it is the skip link's target.
 *
 * A PAGE KEEPS THE WIDTH IT HAS WITH THE PANEL OPEN, so collapsing the panel
 * never rearranges it: the page re-centres in the room the collapse frees,
 * as it always has on a window wide enough to cap it at max-w-app, and
 * nothing on it moves relative to anything else. Inside the <main> sits
 * @container/main, kept --panel-gain narrower than the <main> (the 184px a
 * collapse frees, 0 while open and below md, where the panel is a sheet),
 * and pages render inside it. So every @…/main query, every component's own
 * container and every wrapping row sees the same width in both states.
 * Keyed to the <main> itself, collapsing between about 800 and 1300px
 * moved the Dashboard from one column to two and its range switch from the
 * page's right edge to its middle, wrapped the Calendar's view switch onto
 * a new line, and turned the Week from a list into seven columns. Letting
 * the page widen into the room while keying only the page's own queries to
 * the open width was tried and left everything that measures itself (the
 * headline numbers, Up Next, a job card's rail and facts, the stage chips)
 * still reflowing. --panel-gain is a registered <length> (globals.css) that
 * eases over the same 200ms linear as the panel's own width, so the page
 * holds its width through the whole animation and only glides to its new
 * centre; change one duration and change the other. Scout's panel is another
 * matter: open, it takes real room beside the page, and the page does fit
 * itself to what is left.
 */

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Request time, not build time. The sign-in check below needs the Supabase
  // keys, and `next build` prerenders any page that has not yet asked for a
  // request: CI has no keys, so /applications failed its build with "must
  // both be set" the moment the check came first. connection() marks the
  // whole shell per-request before anything reads the session, the same rule
  // as a live fetch in a page (frontend/CLAUDE.md).
  await connection();

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
          "--sidebar-width-icon": "6rem",
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

      {/* --panel-gain: what a collapse frees, eased in step with the panel's
          own 200ms linear width (see "A PAGE KEEPS THE WIDTH" above). */}
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-2 transition-[--panel-gain] duration-200 ease-linear sm:gap-3 sm:p-3 md:pl-0 md:peer-data-[state=collapsed]:[--panel-gain:calc(var(--sidebar-width)_-_var(--sidebar-width-icon))]">
        <header className="bg-panel border-rail-border shadow-panel rounded-shell flex h-16 shrink-0 items-center gap-3 border px-3 sm:gap-4 sm:px-4">
          <Tooltip>
            <TooltipTrigger
              render={
                <SidebarTrigger className="text-ink-meta hover:text-ink hover:bg-app size-10 shrink-0 rounded-full [&_svg]:size-4" />
              }
            />
            <TooltipContent>Toggle sidebar</TooltipContent>
          </Tooltip>

          {/* The panel's header carries the logo from md; below that the
              panel is a sheet and the bar is the only place left for it. */}
          <Link
            href="/dashboard"
            className="focus-visible:ring-brand-ring flex shrink-0 rounded-xs transition-transform duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none active:scale-[0.97] md:hidden"
          >
            <LogoLockup priority />
          </Link>

          <Form
            action="/search"
            role="search"
            className="hidden min-w-0 md:block md:max-w-80 md:flex-1"
          >
            <QueryField id="job-search" />
          </Form>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <MobileSearch />

            <ScoutLauncher className={BAR_CIRCLE} />

            <NotificationsMenu className={BAR_CIRCLE}>
              New matches and replies from employers will show up here.
            </NotificationsMenu>

            {/* Streamed: it waits on the API, and nothing else in the bar or
                the page should wait with it. The fallback holds the photo's
                40px and, from lg, the name and email's two lines, so the bar
                doesn't shift when they land. */}
            <Suspense fallback={<AccountSkeleton />}>
              <SeekerAccount />
            </Suspense>
          </div>
        </header>

        {/* min-h-0 because a flex item will not shrink below its content by
            default, which would push the column past h-svh and hand the
            scroll back to the document. overscroll-contain so a fling that
            outruns the page does not chain onto the document. */}
        {/* A row, so Scout's panel docks beside the page as one more floating
            panel instead of covering it; min-w-0 lets the page shrink for it.
            No gap: the panel stays mounted to glide open and closed, and
            brings its own 12px with it, so a closed one adds nothing.
            data-scout-row lets the page settle as the panel opens and closes
            (scout-page-in and -out in globals.css), and the row clips the
            panel where it slides in and out past the window's edge. */}
        <div data-scout-row className="flex min-h-0 flex-1 overflow-x-clip">
          <SidebarInset
            id="content"
            tabIndex={-1}
            className="bg-panel border-rail-border shadow-panel rounded-shell min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto overscroll-contain border focus:outline-none"
          >
            {/* The page, as wide as the <main> is with the panel open (see "A
                PAGE KEEPS THE WIDTH" above), and the container it breaks on. */}
            <div
              data-scout-page
              className="@container/main mx-auto flex w-[calc(100%_-_var(--panel-gain))] flex-1 flex-col"
            >
              {/* Outlives a single page so My Profile renders at once on a
                  return visit; see profile-cache.tsx for why it lives here.
                  The query the pages show, moved in place by their segmented
                  controls and the Calendar's arrows, is held by
                  ShallowRouting. */}
              <ProfileCacheProvider>
                <ShallowRouting>{children}</ShallowRouting>
              </ProfileCacheProvider>
            </div>
          </SidebarInset>
          <ScoutPanel />
        </div>
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
