import Link from "next/link";

import { Logo } from "@/components/logo";

import { site } from "./data";
import { featurePages } from "./features/catalog";
import { resourcePages } from "./resources/catalog";

/** The header's two menus, then the footer's own columns. */
const COLUMNS = [
  {
    title: "Features",
    links: featurePages.map((page) => ({ label: page.name, href: page.href })),
  },
  {
    title: "Resources",
    links: resourcePages.map((resource) => ({ label: resource.name, href: resource.href })),
  },
  ...site.footer,
];

/**
 * A dark rounded panel inset from the window, like the bands above it, that
 * opens on the site's tagline set large. The logo turns white with a filter:
 * the shared Logo draws its word in ink, which would vanish on ink.
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="px-2 pb-2 sm:px-6 sm:pb-6">
      <div className="bg-ink rounded-[2rem] text-white lg:rounded-[3rem]">
        {/* Four link columns: two by two on a phone, one row of four under
            the tagline at md, beside it from lg. */}
        <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-x-6 gap-y-10 px-6 pt-16 pb-14 sm:px-10 md:grid-cols-4 lg:grid-cols-[2fr_repeat(4,1fr)] lg:px-8">
          <div className="col-span-2 max-w-sm md:col-span-4 lg:col-span-1">
            <p className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {site.tagline}
            </p>
            <Logo size="card" className="mt-10 brightness-0 invert" />
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h2 className="text-sm font-semibold">{column.title}</h2>
              <ul className="mt-4 grid gap-3">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-white/65 transition-colors hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mx-auto w-full max-w-6xl px-6 sm:px-10 lg:px-8">
          <div className="flex flex-col gap-4 border-t border-white/10 py-6 text-sm text-white/65 sm:flex-row sm:items-center sm:justify-between">
            <p>
              &copy; {year} {site.name}. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
