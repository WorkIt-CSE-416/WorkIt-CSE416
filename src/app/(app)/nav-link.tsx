"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * A top-bar link that underlines itself on the route it points at.
 *
 * This is the only client component in the app shell: the active tab is the
 * one thing the layout cannot know on the server, because the layout is not
 * re-rendered per segment. The transparent border on the inactive state keeps
 * every tab the same height, so switching routes does not shift the bar.
 */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`text-label focus-visible:ring-brand-ring border-b-2 pb-px focus-visible:rounded-xs focus-visible:ring-2 focus-visible:outline-none ${
        isActive ? "text-brand border-brand" : "text-ink-meta hover:text-ink border-transparent"
      }`}
    >
      {children}
    </Link>
  );
}
