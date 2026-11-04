import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { ScoutLauncher } from "@/components/scout/scout-buttons";
import { ScoutPanel } from "@/components/scout/scout-panel";
import { RailSidebarProvider } from "@/components/app-sidebar";
import { SidebarInset, SidebarTrigger } from "@/components/shadcn/sidebar";
import { Skeleton } from "@/components/shadcn/skeleton";
import { ShallowRouting } from "@/components/shallow-routing";
import { getCurrentAccount, getSessionUser } from "@/lib/session";

import { SeekerAccount } from "./account-status";
import { BAR_ICON, BAR_TITLE } from "./bar";
import { BarTitle } from "./bar-title";
import { Greeting } from "./greeting";
import { ProfileCacheProvider } from "./profile-cache";
import { ProfileStrength } from "./profile-strength";
import { ScrollMemory } from "./scroll-memory";
import { SeekerNotificationsBell } from "./seeker-notifications-bell";
import { SeekerSidebar } from "./seeker-sidebar";

/**
 * Chrome shared by every signed-in seeker screen, ruled into regions by the
 * control edge (--color-border-control, 2026-11-03), the edge the cards and
 * buttons have, so the frame and what is on it read as one set; in the light
 * hairline it was the only faint line left on the page. The section panel
 * runs the full height
 * on the left, flush with the window; beside it, the top bar along the top,
 * and under the bar the page itself.
 *
 * THE PANEL AND THE BAR ARE WHITE AND THE PAGE IS NEAR WHITE (--color-app,
 * #fcfcfc, 2026-11-03), as Simplify's is. On 2026-11-02 the page went grey
 * (#f5f5f5) because white cards blended into a white page; on the grey,
 * white cards and light edges read as muted. Simplify's own page is #fcfcfc
 * with #e8e8e8 hairlines; here a card's outer edge is --color-border-control,
 * as a button's is (ui/card.tsx), and only its rules are #e8e8e8. Anything that sits on the page and needs its
 * own edge is white; a sticky bar is the page's colour, so it hides what
 * scrolls under it without showing as a strip.
 *
 * IT WAS THREE FLOATING PANELS until 2026-10-27: white rounded panels 12px
 * apart on a lavender ground (--color-frame), after a dashboard the user had
 * pointed at. The user then found the frame wasted room, about 36px of every
 * width and height went to lavender and gaps, and the three boxes read as
 * separate containers rather than one app. Keep it flat: no gaps, no rounded
 * or shadowed shell panels.
 *
 * THE PANEL IS AN 88px RAIL THAT IS ALWAYS OPEN (RAIL in
 * @/components/app-sidebar): an icon over each section's name. It was a
 * 256px panel that collapsed to a 72px rail and opened over the page on
 * hover (KAN-300) until 2026-10-27, when the user found the panel covering
 * the page a flaw. So there is no pin and no peek, and the page never changes
 * width for the panel. shadcn still writes its sidebar_state cookie on a Ctrl
 * or Cmd+B; nothing reads it (the company pin has its own cookie). --sidebar-width is
 * the rail's width, so shadcn's in-flow gap beside it matches it.
 *
 * THE BAR holds, below md, the toggle that opens the panel's sheet, then the
 * page's title (./bar-title.tsx) and, on the right, Scout (archived, `SCOUT_LAUNCHER_LIVE`), the
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
 * shows the mark alone beside the toggle, to leave the title room. The bell is
 * a bare ink glyph in a 40px box (./bar.ts), the photo's height. The toggle
 * is a bare glyph that takes the same fill on hover.
 *
 * THE TITLE LINES UP WITH THE PAGE UNDER IT: the bar's own padding plus its
 * wrapper's matches SEEKER_GUTTER from md. The job search left the bar for the
 * Jobs page on 2026-11-02 (./search/job-search.tsx): it showed on every page.
 * The bell steps out below sm, where the bar has room for the toggle, the mark,
 * the title and the photo and little else.
 *
 * THE PAGE is the one scrolling element, so the bar and the section
 * panel stay put and a scrollbar runs only beside the page. SidebarInset
 * renders the <main>, so pages render a <div>; it is the skip link's target.
 *
 * PAGES BREAK ON @container/main, the width they actually get, never the
 * window's: Scout's panel takes room beside the page when open, and the page
 * fits itself to what is left.
 */

/** The bar's Scout button is archived (2026-11-01). Scout stays: Fill With
 *  Scout still opens its panel. The resume editor's assistant has no other way
 *  in on a laptop, so it waits for this. Set it to true to bring the button
 *  back. */
const SCOUT_LAUNCHER_LIVE = false;

export default async function AppLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  /** The @modal slot: a route opened as a modal over the page, Settings for
   *  now (KAN-364, @modal/(.)settings), or nothing (@modal/default.tsx). */
  modal: React.ReactNode;
}) {
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

  return (
    /* h-svh makes this row the window, so the only thing left to scroll is
       the page panel: a min-height would hand the scroll back to the
       document, and the bar and the panel would scroll away with it. */
    <RailSidebarProvider
      className="bg-panel h-svh"
      /* Read by the canvas rule in globals.css, which paints the overscroll
         strip the page's grey to match. */
      data-shell="seeker"
      style={
        {
          "--sidebar-width": "5.5rem",
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

      {/* The bar and the page. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 64px with its rule, the rail's logo header's height. The rule stops
            at the rail's edge, which runs the window's full height: the
            logo header has no rule, since one there crossed that edge in a
            "+" (2026-11-03). */}
        <header className="bg-panel border-border-control flex h-16 shrink-0 items-center gap-3 border-b px-3 sm:gap-4 sm:px-4">
          {/* The rail is always open from md, so the toggle only opens the
              phone's sheet. Named here, since shadcn's own name is "Toggle
              Sidebar". No logo beside it: the sheet's header shows the logo,
              and the bar's room on a phone goes to the bell (KAN-570). */}
          <SidebarTrigger
            aria-label="Open Menu"
            className="text-ink hover:bg-well size-10 shrink-0 rounded-full md:hidden [&_svg]:size-4"
          />

          <div className="min-w-0 flex-1 md:pl-2 lg:pl-4">
            <BarTitle
              home={
                <Suspense
                  fallback={<Skeleton aria-hidden="true" className="h-8 w-64 max-w-full" />}
                >
                  <HomeTitle />
                </Suspense>
              }
            />
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {SCOUT_LAUNCHER_LIVE && <ScoutLauncher className={BAR_ICON} />}

            <SeekerNotificationsBell className={BAR_ICON} />

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
            scroll back to the document. overscroll-y-none so a hard scroll
            stops at the page's end with no bounce (globals.css). Y only, so
            the trackpad's swipe back still works. */}
        {/* A row, so Scout's panel docks beside the page, ruled off by its
            own border, instead of covering it; min-w-0 lets the page shrink
            for it. The panel stays mounted to glide open and closed, and a
            closed one takes no room.
            data-scout-row lets the page settle as the panel opens and closes
            (scout-page-in and -out in globals.css), and the row clips the
            panel where it slides in and out past the window's edge. */}
        <div data-scout-row className="flex min-h-0 flex-1 overflow-x-clip">
          <SidebarInset
            id="content"
            tabIndex={-1}
            className="bg-app min-h-0 min-w-0 flex-1 [scrollbar-gutter:stable] overflow-x-clip overflow-y-auto overscroll-y-none focus:outline-none"
          >
            {/* The page, and the container it breaks on. */}
            <div data-scout-page className="@container/main flex w-full flex-1 flex-col">
              {/* Outlives a single page so My Profile renders at once on a
                  return visit; see profile-cache.tsx for why it lives here.
                  The query the pages show, moved in place by their segmented
                  controls and the Calendar's arrows, is held by
                  ShallowRouting. */}
              <ProfileCacheProvider>
                <ShallowRouting>
                  {/* THE PAGE STREAMS IN BEHIND THE SHELL on a hard load (a
                      sign-in landing, a reload, a new tab). Without this
                      boundary the page was part of React's shell, so no byte
                      of the panel or the bar left the server until the page's
                      slowest read had answered: on Home, a whole
                      scoring pass. Now the shell goes out at once and the page
                      follows it in the same response. A soft navigation is
                      unchanged: the boundary is already showing a page, and a
                      navigation is a transition, which keeps the old page up
                      until the new one is ready, so the fallback never shows
                      there. It is empty, for that moment of a hard load only.
                      It wraps the page slot only, never {modal}, so a modal
                      never waits on the page under it.
                      What a page that answers after the shell gives up: a
                      redirect() or notFound() in it can no longer set the
                      status, so the response is a 200 and the browser follows
                      the redirect (a meta refresh without JavaScript) or draws
                      the not-found page itself; and React reveals a streamed
                      boundary no sooner than 300ms after the shell's first
                      frame, so a page that answers inside that window lands up
                      to that much later than it did riding with the shell.
                      THE contents DIV KEEPS PAGE-ENTER TO SOFT NAVIGATIONS.
                      React plays a <ViewTransition>'s enter on a Suspense
                      reveal only when no DOM element sits between the boundary
                      and it, so without this div a hard load's page rose in
                      with the template's page-enter whenever it streamed in
                      (checked in Chromium on a copy of this tree), where it
                      used to simply be there. A soft navigation remounts the
                      template below the div, so its enter and exit still run.
                      display: contents leaves no box, so the page is still the
                      container's flex child. */}
                  <Suspense fallback={null}>
                    <div className="contents">{children}</div>
                  </Suspense>
                </ShallowRouting>
              </ProfileCacheProvider>
            </div>
          </SidebarInset>
          {/* Puts a page back where it was scrolled on a return to it; the
              <main> above scrolls, not the window, so the browser can't. */}
          <ScrollMemory />
          <ScoutPanel />
        </div>
        {modal}
      </div>
    </RailSidebarProvider>
  );
}

/** Home's title: the greeting, or the plain name with no account to greet.
 *  One read, which the bar's account makes too. */
async function HomeTitle() {
  const account = await getCurrentAccount();
  const firstName = account?.full_name.split(" ")[0];
  return firstName ? (
    <Greeting as="h1" firstName={firstName} className={BAR_TITLE} />
  ) : (
    <h1 className={BAR_TITLE}>Home</h1>
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
