import Link from "next/link";

import { Logo } from "@/components/logo";

import { site } from "./data";
import { featurePages } from "./features/catalog";
import { FooterWordmark } from "./footer-wordmark";
import { resourcePages } from "./resources/catalog";

/** The header's two menus, then the footer's own columns. */
const COLUMNS = [
  {
    title: "Features",
    links: featurePages.map((page) => ({ label: page.name, href: page.href })),
  },
  {
    title: "Resources",
    // Marked Soon, as the header's menu marks them: none has a page yet.
    links: resourcePages.map((resource) => ({
      label: resource.name,
      href: resource.href,
      soon: Boolean(resource.soon),
    })),
  },
  ...site.footer,
];

/**
 * A dark rounded panel inset from the window, like the bands above it, that
 * opens on the site's tagline set large and closes on "workit" drawn from
 * job titles (footer-wordmark.tsx). The logo turns white with a filter:
 * the shared Logo draws its word in ink, which would vanish on ink.
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="px-2 pb-2 sm:px-6 sm:pb-6">
      <div className="bg-ink overflow-hidden rounded-[2rem] text-white lg:rounded-[3rem]">
        {/* Five link columns: two a row on a phone, three at md, one row of
            five under the tagline at lg, beside it from xl, where a column
            is still wide enough for "Application Tracker" on one line. */}
        <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-x-6 gap-y-10 px-6 pt-16 pb-14 sm:px-10 md:grid-cols-3 lg:grid-cols-5 lg:px-8 xl:grid-cols-[2fr_repeat(5,1fr)]">
          <div className="col-span-2 max-w-sm md:col-span-3 lg:col-span-5 xl:col-span-1">
            <p className="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
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
                      className="text-sm text-white/80 transition-colors hover:text-white"
                    >
                      {link.label}
                      {"soon" in link && link.soon === true && (
                        <span className="ml-2 rounded-full bg-white/10 px-1.5 py-px text-[11px] leading-4 font-medium text-white/70">
                          Soon
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mx-auto w-full max-w-6xl px-6 sm:px-10 lg:px-8">
          <div className="flex flex-col gap-4 border-t border-white/10 py-6 text-sm text-white/80 sm:flex-row sm:items-center sm:justify-between">
            <p>
              &copy; {year} {site.name}. All rights reserved.
            </p>
          </div>
        </div>

        <div className="px-4 pt-4 pb-6 sm:px-8 lg:px-10 lg:pb-10">
          <FooterWordmark />
        </div>
      </div>
    </footer>
  );
}
