import { Menu, X } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/logo";

import { site } from "./data";
import { FloatingHeader } from "./floating-header";
import { GlassButton, OutlineButton } from "./buttons";

/**
 * The header sits above the hero's rounded panel. Once the page scrolls it
 * floats: the bar becomes a white rounded panel with a shadow, inset from
 * the window's edges like the panels below it (FloatingHeader sets the
 * state).
 *
 * The site's Applicant / Company switcher is left out while the business side
 * is hidden (KAN-239, frontend/CLAUDE.md).
 */
export function Header() {
  return (
    <FloatingHeader>
      <div className="rounded-2xl transition-[background-color,box-shadow] duration-300 group-data-scrolled:bg-white/90 group-data-scrolled:shadow-lg group-data-scrolled:ring-1 group-data-scrolled:shadow-slate-900/5 group-data-scrolled:ring-slate-900/5 group-data-scrolled:backdrop-blur-md">
        {/* From lg up: 1fr | auto | 1fr grid, so the links are centered on the
          page regardless of how wide the groups on either side are. */}
        <nav
          className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:gap-6 lg:px-8"
          aria-label="Main"
        >
          <div className="flex items-center gap-2 sm:gap-3 lg:gap-4 lg:justify-self-start">
            <Link href="/" aria-label={`${site.name} home`} className="flex">
              <Logo size="card" decorative />
            </Link>
          </div>

          <ul className="hidden items-center gap-1 lg:flex">
            {site.nav.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="hover:text-ink rounded-md px-3 py-2 text-sm font-medium text-slate-800 transition-colors"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2 lg:justify-self-end">
            <div className="hidden md:block">
              <OutlineButton href={site.login.href}>{site.login.label}</OutlineButton>
            </div>
            <div className="hidden sm:block">
              <GlassButton href={site.primaryCta.href} label={site.primaryCta.label} />
            </div>
            <button
              type="button"
              popoverTarget="mobile-menu"
              className="text-ink hover:bg-surface inline-flex size-10 items-center justify-center rounded-lg lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="size-6" aria-hidden="true" />
            </button>
          </div>
        </nav>
      </div>

      {/* Native popover: opens/closes, Esc, and light-dismiss with no JavaScript. */}
      <div
        id="mobile-menu"
        popover="auto"
        className="border-border inset-x-4 top-20 bottom-auto m-0 h-auto w-auto rounded-2xl border bg-white p-4 shadow-xl lg:hidden"
      >
        <div className="flex items-center justify-between">
          <Logo size="card" />
          <button
            type="button"
            popoverTarget="mobile-menu"
            popoverTargetAction="hide"
            className="text-ink hover:bg-surface inline-flex size-10 items-center justify-center rounded-lg"
            aria-label="Close menu"
          >
            <X className="size-6" aria-hidden="true" />
          </button>
        </div>
        <ul className="mt-4 grid gap-1">
          {site.nav.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="text-ink hover:bg-surface block rounded-lg px-3 py-2.5 font-medium"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <GlassButton
          href={site.primaryCta.href}
          label={site.primaryCta.label}
          className="mt-4 h-12 w-full text-base"
        />
        <OutlineButton href={site.login.href} size="lg" className="mt-2 w-full">
          {site.login.label}
        </OutlineButton>
      </div>
    </FloatingHeader>
  );
}
