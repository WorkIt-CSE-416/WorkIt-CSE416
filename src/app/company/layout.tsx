import Link from "next/link";

import { AccountMenu, type AccountMenuItem } from "@/components/account-menu";
import { BellIcon, GearIcon, UserIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { NavLink } from "@/components/nav-link";
import { ButtonLink } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SearchField } from "@/components/ui/search-field";

/**
 * Chrome shared by every company screen.
 *
 * A company is a different account type, not a different mode of the seeker
 * app: it posts roles and reads applicants, where a seeker reads roles and
 * sends applications. Everything under /company is behind this bar and nothing
 * else is.
 *
 * The prefix is what makes that split cheap. Route groups — the parentheses
 * around (seeker) — are invisible in the URL, so two of them cannot both own a
 * /profile, and Next.js fails the build when they try. A company has a profile
 * and so does a seeker, so the two audiences needed separate URL space rather
 * than separate layouts over shared URL space. It also means a single path
 * check guards the whole surface once auth exists — see the note in
 * src/app/login/actions.ts.
 *
 * This bar is a near-copy of the seeker's rather than one component taking
 * props, and that is deliberate for now. The parts that are genuinely the same
 * are already shared — the logo, the nav link's active state, the account menu,
 * the field. What is left is a list of tabs and one button, which is the part
 * that differs, and wrapping a component around a difference that size buys
 * nothing. If the two bars are still this close once both sides are real
 * screens rather than stubs, lift a <TopBar items action> into
 * src/components and delete both.
 *
 * The differences that already exist: the field searches candidates, not jobs,
 * and the logo goes to /company so a company never lands on the seeker home.
 */
const NAV_ITEMS = [
  { href: "/company/jobs", label: "Job Postings" },
  { href: "/company/candidates", label: "Candidates" },
];

/* Company Profile, not Profile: this is the page applicants see, so the label
 * has to say whose profile it is. Neither route below /company is built yet —
 * they are links that 404 rather than controls that do nothing, the same
 * placeholder the seeker bar uses. */
const ACCOUNT_ITEMS: readonly AccountMenuItem[] = [
  { href: "/company/profile", label: "Company Profile", icon: <UserIcon className="size-4" /> },
  { href: "/company/settings", label: "Settings", icon: <GearIcon className="size-4" /> },
];

export default function CompanyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-app flex min-h-full flex-1 flex-col">
      <header className="bg-panel border-border border-b">
        <nav
          aria-label="Main"
          className="max-w-app mx-auto flex h-16 w-full items-center gap-5 px-12"
        >
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

          <ul className="flex items-center gap-5">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <NavLink href={item.href}>{item.label}</NavLink>
              </li>
            ))}
          </ul>

          <div className="ml-auto flex items-center gap-5">
            <ButtonLink href="/company/jobs/new" variant="primary" size="md">
              Post a Job
            </ButtonLink>

            <IconButton label="Notifications">
              <BellIcon className="size-5" />
            </IconButton>

            <AccountMenu name="Jordan Reyes" items={ACCOUNT_ITEMS} />
          </div>
        </nav>
      </header>

      {children}
    </div>
  );
}
