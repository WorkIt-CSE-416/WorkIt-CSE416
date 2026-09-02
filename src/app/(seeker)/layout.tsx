import Link from "next/link";

import { AccountMenu, type AccountMenuItem } from "@/components/account-menu";
import { BellIcon, GearIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { NavLink } from "@/components/nav-link";
import { ButtonLink } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SearchField } from "@/components/ui/search-field";

/**
 * Chrome shared by every signed-in seeker screen.
 *
 * The company shell has its own bar at src/app/company/layout.tsx. The two are
 * deliberately separate files rather than one bar taking props — the note there
 * explains why, and is the place to revisit if they stop drifting apart.
 *
 * The bar is a full-bleed band with contained content: <header> paints the
 * surface and the rule edge to edge, and the <nav> inside it takes the same
 * container every page takes — max-w-app, centred, px-12 — so the wordmark and
 * the account cluster land on the same two vertical edges as the cards below
 * them, at every viewport width.
 *
 * It was padded asymmetrically before this — 48px left, 16px right — copied
 * from what the mockup measures. A mockup is one width, though, and those are
 * viewport-anchored gutters against a centred container: the left edges agreed
 * at exactly 1024px and drifted apart by half the overflow past it, and the
 * right edges never agreed at all. The mockup's ~17px right gap is read as an
 * artefact of its single width rather than an intent.
 *
 * /search is the screen this does not align to. It is a full-bleed two-pane
 * workspace rather than a centred container, so its results pane starts at
 * x=0 and no single bar can align to both it and the cards on the other three
 * screens. The container is the majority case, so the bar follows it; if the
 * two-pane layout is meant to be the rule rather than the exception, this is
 * the line to revisit.
 *
 * The mockup leaves the left of the bar empty, with the first nav link starting
 * 128px in. That slot holds the icon rather than the full lockup: at 32px tall
 * the mark is only ~34px wide, which is the point — the search field sits right
 * beside it, and the lockup at 2.8:1 would crowd both. The mockup's 128px no
 * longer maps onto one thing, since the field now intervenes: above md the
 * first nav link lands well past that mark, and below md, where the field is
 * hidden, well short of it (48 + 34 + 20 = ~102px).
 *
 * The search field comes from the search mockup, the only one that draws it.
 * It sits in the shared bar rather than on that page because that is where the
 * mockup puts it, and because searching jobs is global rather than something
 * one screen owns — but it does mean profile and applications now carry a
 * field their own mockups do not. Hidden below md, where the bar has no room.
 *
 * It grows into whatever the bar has spare and stops at 320px, rather than
 * taking a fixed width. Its width was hard-coded at 236px, and that is the kind
 * of number somebody has to recompute by hand every time the bar's contents
 * change — which is exactly what dropping the Search tab would have required.
 * The cap is what keeps it from crowding the nav once it has room.
 */

/**
 * Search is the one thing that used to sit here and does not: /search is where
 * the bar's own field would land a query, and a tab beside that field would be
 * a second, contradictory way to reach it. The route still exists and still
 * renders; it has no tab.
 *
 * My Profile is a tab rather than a row in the account menu. It briefly was one
 * — the reasoning is still in @/components/account-menu — and the trade did not
 * hold: a profile is not somewhere you visit once and leave, it is somewhere a
 * job seeker goes back to all through a hunt, and a click of depth is the wrong
 * price for that. "My" is what separates it from an employer's profile, which
 * the company shell also has to name.
 */
const NAV_ITEMS = [
  { href: "/applications", label: "Applications" },
  { href: "/jobs", label: "Jobs" },
  { href: "/profile", label: "My Profile" },
];

/* One row, now that My Profile is a tab again. A menu holding a single item is
 * worth a second look — the alternative is the bare gear this replaced, back
 * beside the bell — but it is the right shape to leave in place while the
 * account rows are still arriving: sign out has nowhere else to go, and neither
 * will billing or notification preferences.
 *
 * /settings is not built yet, the same way /apply in the bar is not. Both are
 * links that 404 rather than controls that do nothing, which is the more honest
 * placeholder and the one that stops needing a note the day the route lands. */
const ACCOUNT_ITEMS: readonly AccountMenuItem[] = [
  { href: "/settings", label: "Settings", icon: <GearIcon className="size-4" /> },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="bg-app flex h-svh flex-col"
      /* The bar's height, in one place, the way the company shell keeps its
         own. Nothing below reserves it any more — the bar is back in flow, so
         it takes its own room — but it stays a token because it is one number
         two shells and a fixed panel all measure against.

         h-svh rather than min-h-full is what moves the scrollbar under the bar:
         a min-height leaves the document scrolling, and a document scrollbar
         runs the full window height, past the bar it has nothing to do with. An
         exact viewport height makes this column the window, so the only thing
         left to scroll is the region below the bar. */
      style={{ "--seeker-bar": "4rem" } as React.CSSProperties}
    >
      {/* BACK IN FLOW, which it was long ago for the wrong reason and is again
          for the right one. In flow it used to scroll away with the document,
          so it was pulled out to `fixed` — the note that stood here weighed
          fixed against sticky on how each behaves during a rubber-band
          overscroll.

          None of that applies once the document is not what scrolls. The bar is
          a sibling of the scroller now, not a layer over it, so nothing can
          slide it and nothing bounces underneath it. shrink-0 so a tall page
          cannot squeeze it. */}
      <header className="bg-panel border-border relative z-20 h-(--seeker-bar) shrink-0 border-b">
        <nav
          aria-label="Main"
          className="max-w-app mx-auto flex h-full w-full items-center gap-5 px-12"
        >
          <Link
            href="/"
            className="focus-visible:ring-brand-ring flex shrink-0 rounded-xs focus-visible:ring-2 focus-visible:outline-none"
          >
            <Logo size="bar" priority />
          </Link>

          <SearchField
            id="job-search"
            label="Search jobs"
            name="q"
            placeholder="Job title, keywords, or company"
            className="hidden min-w-0 md:block md:max-w-80 md:flex-1"
          />

          <ul className="flex items-center gap-5">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <NavLink href={item.href}>{item.label}</NavLink>
              </li>
            ))}
          </ul>

          <div className="ml-auto flex items-center gap-5">
            <ButtonLink href="/apply">Apply to Job</ButtonLink>

            <IconButton label="Notifications">
              <BellIcon className="size-5" />
            </IconButton>

            <AccountMenu name="Alex Chen" items={ACCOUNT_ITEMS} />
          </div>
        </nav>
      </header>

      {/* The one scrolling element in the shell. min-h-0 because a flex item
          will not shrink below its content by default, which would push the
          column past h-svh and hand the scroll back to the document. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  );
}
