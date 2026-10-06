import { cookies } from "next/headers";
import Form from "next/form";
import { Suspense } from "react";

import { NotificationsMenu } from "@/components/notifications-menu";
import { SidebarInset, SidebarProvider } from "@/components/shadcn/sidebar";
import { SidebarBrand } from "@/components/sidebar-brand";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/cn";

import { SeekerAccount, SeekerStatusLine } from "./account-status";
import { SEEKER_GUTTER } from "./gutter";
import { MobileSearch } from "./mobile-search";
import { ProfileStrength } from "./profile-strength";
import { SeekerSidebar } from "./seeker-sidebar";

/**
 * Chrome shared by every signed-in seeker screen: a full-width bar across the
 * top, and the sections in a panel down the left, the same dashboard layout
 * the company shell uses (src/app/company/layout.tsx). The two are still
 * separate files rather than one shell taking props (each bar carries its
 * own search target, copy and account data), but the corner, the panel, the
 * bell and the account menu are shared components, so they cannot drift.
 *
 * Jobs, Applications and My Profile were tabs in this bar. They moved to the
 * panel because that is where a dashboard keeps its sections, and because a
 * phone had no room for them: three tabs beside the lockup and the avatar
 * came to ~420px, so "My Profile" wrapped and the avatar fell off the edge.
 * On a phone the panel opens as a sheet from the toggle instead.
 *
 * The toggle sits left of the logo, as it does on the company side, in a
 * corner cell the panel's own width; see @/components/sidebar-brand.
 *
 * The search field comes from the search mockup, the only one that draws it.
 * It sits in the shared bar rather than on that page because searching jobs
 * is global rather than something one screen owns. It is a GET form to
 * /search, so Enter lands the query there as ?q; next/form makes that a
 * client-side navigation. It grows into whatever the bar has spare and stops
 * at 320px, rather than taking a fixed width somebody has to recompute every
 * time the bar's contents change. Below md the bar has no room for it, so a
 * magnifier takes its place before the bell and opens the same field in a
 * sheet; see ./mobile-search.tsx.
 *
 * The bell steps out below sm: it has nothing behind it yet but an empty
 * state, and the avatar's menu is the one control in that cluster a phone
 * cannot do without. The magnifier and the bell are 32px circles with the same
 * hover fill; the avatar takes it as a pill from xl, where its name shows.
 *
 * The panel's open or collapsed state survives a reload: shadcn writes it to
 * the sidebar_state cookie on every toggle, and this layout reads it back as
 * the provider's defaultOpen, so the page does not open expanded and jump
 * 208px when the user collapses it again.
 */

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const defaultOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    /* flex-col, because SidebarProvider lays its children out in a row by
       default and this shell stacks the bar over the panel and the page.

       h-svh rather than min-h-full is what moves the scrollbar under the bar:
       a min-height leaves the document scrolling, and a document scrollbar
       runs the full window height, past the bar it has nothing to do with. An
       exact viewport height makes this column the window, so the only thing
       left to scroll is the region below the bar. */
    <SidebarProvider
      defaultOpen={defaultOpen}
      className="bg-background h-svh flex-col"
      /* Read by the canvas rule in globals.css, which paints the overscroll
         strip white to match — the company shell sets the same attribute. */
      data-shell="seeker"
      /* The bar's height, in one place. The panel is `fixed` and positioned
         by the viewport, so it has to be told where the bar ends; see "WHY IT
         IS OFFSET" in @/components/app-sidebar. */
      style={{ "--seeker-bar": "4rem" } as React.CSSProperties}
    >
      {/* The first stop on every page, shown only once focused, so a keyboard
          user can step past the bar and the panel to the page itself. The
          padding is focus: too, because sr-only zeroes it and the focus:
          variant is what comes after it in the stylesheet. */}
      <a
        href="#content"
        className="bg-panel rounded-control text-label text-ink shadow-panel focus-visible:ring-brand-ring sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus-visible:ring-2 focus-visible:outline-none"
      >
        Skip to content
      </a>

      {/* In flow, as a sibling of the scroller rather than a layer over it,
          so nothing can slide it and nothing bounces underneath it. shrink-0
          so a tall page cannot squeeze it, and z-20 to stay over the fixed
          panel's z-10. */}
      {/* Two cells, ruled where the panel's edge is: <SidebarBrand> on the
          left is the panel's width, and the content side is the page's own
          container — max-w-app and SEEKER_GUTTER inside the space beside
          the panel, exactly as the page below lays itself out — so the
          search field starts on the page heading's left edge and the avatar
          ends on the cards' right edge. */}
      <header className="bg-panel border-border relative z-20 flex h-(--seeker-bar) shrink-0 border-b">
        <SidebarBrand href="/dashboard" />

        <div className="flex h-full min-w-0 flex-1">
          <div
            className={cn(
              "max-w-app mx-auto flex h-full w-full items-center gap-4 sm:gap-5",
              SEEKER_GUTTER,
            )}
          >
            <Form
              action="/search"
              role="search"
              className="hidden min-w-0 md:block md:max-w-80 md:flex-1"
            >
              <SearchField
                id="job-search"
                label="Search jobs"
                name="q"
                placeholder="Search jobs"
                enterKeyHint="search"
                className="w-full"
              />
            </Form>

            <div className="ml-auto flex items-center gap-4 sm:gap-5">
              {/* Streamed: each waits on the API, and nothing else in the
                  bar or the page should wait with it. The account's
                  fallback holds the avatar's 32px, and the name beside it
                  only shows from xl, so the bar doesn't shift when it lands
                  and the search keeps its width. */}
              <Suspense fallback={null}>
                <SeekerStatusLine />
              </Suspense>

              <MobileSearch />

              <NotificationsMenu>
                New matches and replies from employers will show up here.
              </NotificationsMenu>

              <Suspense
                fallback={<span aria-hidden="true" className="bg-hover size-8 rounded-full" />}
              >
                <SeekerAccount />
              </Suspense>
            </div>
          </div>
        </div>
      </header>

      {/* The one scrolling element in the shell. min-h-0 because a flex item
          will not shrink below its content by default, which would push the
          column past h-svh and hand the scroll back to the document.

          overscroll-contain for the same reason from the other direction: a
          trackpad fling that outruns the page's own travel would otherwise
          chain onto the document once the inset hits its scroll limit, and
          drag the bar along with it.

          @container/main because the page's room depends on the panel, not
          just the window: an open panel takes 256px, so a 1024px window
          leaves the page 768. Layouts that split into columns (search,
          profile) break on this width rather than on the viewport's.

          SidebarInset renders the <main>, so the pages inside it don't. It
          is the skip link's target: tabIndex -1 lets it take focus without
          adding a tab stop. */}
      <div className="flex min-h-0 w-full flex-1">
        <SeekerSidebar
          card={
            <Suspense fallback={null}>
              <ProfileStrength />
            </Suspense>
          }
        />
        <SidebarInset
          id="content"
          tabIndex={-1}
          className="@container/main flex-1 overflow-y-auto overscroll-contain focus:outline-none"
        >
          {children}
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
