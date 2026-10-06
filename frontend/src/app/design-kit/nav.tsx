"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

import { SECTION_ORDER } from "./data";

/**
 * The kit's section list.
 *
 * A client component only because it reads the pathname to mark the current
 * section; everything it links to renders on the server.
 *
 * A vertical index beside a document, so the active row is filled rather
 * than underlined, the way both shells' left panels mark the section you are
 * on.
 */
export function KitNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Design Kit Sections" className="md:w-44 md:shrink-0">
      <ul className="flex flex-row flex-wrap gap-1 md:sticky md:top-10 md:flex-col md:flex-nowrap">
        <li>
          <KitLink href="/design-kit" active={pathname === "/design-kit"}>
            Overview
          </KitLink>
        </li>
        {SECTION_ORDER.map(({ slug, title }) => {
          const href = `/design-kit/${slug}`;

          return (
            <li key={slug}>
              <KitLink href={href} active={pathname === href}>
                {title}
              </KitLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function KitLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "text-label focus-visible:ring-brand-ring rounded-control block px-2.5 py-1.5 focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "bg-brand-tint text-brand font-medium"
          : "text-ink-meta hover:bg-well hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}
