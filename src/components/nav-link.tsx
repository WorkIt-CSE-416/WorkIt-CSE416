"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * A top-bar link that underlines itself on the route it points at.
 *
 * A client component because the active tab is the one thing a layout cannot
 * know on the server: the layout is not re-rendered per segment. It is a leaf,
 * so the bar around it still renders on the server. The transparent border on
 * the inactive state keeps every tab the same height, so switching routes does
 * not shift the bar.
 *
 * Shared by both shells. `startsWith` is what makes a tab stay lit on the
 * routes below it — /company/jobs keeps the Jobs tab active on
 * /company/jobs/eng-intern — and the trailing slash is what stops /company
 * from claiming /company-something.
 */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`text-body focus-visible:ring-brand-ring border-b-2 pb-px font-medium focus-visible:rounded-xs focus-visible:ring-2 focus-visible:outline-none ${
        isActive ? "text-brand border-brand" : "text-ink-meta hover:text-ink border-transparent"
      }`}
    >
      {children}
    </Link>
  );
}
