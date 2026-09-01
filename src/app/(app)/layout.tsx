import Link from "next/link";

import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SearchField } from "@/components/ui/search-field";

import { Avatar } from "./avatar";
import { BellIcon, GearIcon } from "./icons";
import { NavLink } from "./nav-link";

/**
 * Chrome shared by every signed-in screen.
 *
 * The bar is padded asymmetrically — 48px on the left so the wordmark lines up
 * with the column of cards below it, 16px on the right — because that is what
 * the mockup measures: at the 1024px design width the account cluster sits
 * about 17px from the edge while the cards sit 48px in. Worth confirming with
 * the designer; it reads more like an oversight in the mockup than an intent.
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
 */

const NAV_ITEMS = [
  { href: "/search", label: "Search" },
  { href: "/applications", label: "Applications" },
  { href: "/recommendations", label: "Recommendations" },
  { href: "/profile", label: "Profile" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-app flex min-h-full flex-1 flex-col">
      <header className="bg-panel border-border border-b">
        <nav aria-label="Main" className="flex h-12 items-center gap-5 pr-4 pl-12">
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
            className="hidden w-59 shrink md:block"
          />

          <ul className="flex items-center gap-5">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <NavLink href={item.href}>{item.label}</NavLink>
              </li>
            ))}
          </ul>

          <div className="ml-auto flex items-center gap-5">
            <ButtonLink href="/apply" variant="primary" size="sm">
              Apply to Job
            </ButtonLink>

            <IconButton label="Notifications">
              <BellIcon className="size-4.5" />
            </IconButton>

            <IconButton label="Settings">
              <GearIcon className="size-4.5" />
            </IconButton>

            <Link
              href="/profile"
              aria-label="Your account"
              className="focus-visible:ring-brand-ring rounded-full focus-visible:ring-2 focus-visible:outline-none"
            >
              <Avatar name="Alex Chen" className="size-7 text-[0.625rem]" />
            </Link>
          </div>
        </nav>
      </header>

      {children}
    </div>
  );
}
