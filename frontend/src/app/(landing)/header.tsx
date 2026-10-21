import { ArrowRight, ChevronDown, Menu, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Logo } from "@/components/logo";

import { hiringSystems, site } from "./data";
import { featurePages } from "./features/catalog";
import { featureContent } from "./features/content";
import { FeatureIcon } from "./features/feature-icon";
import { FloatingHeader } from "./floating-header";
import { GlassButton, OutlineButton } from "./buttons";
import { MobileMenu } from "./mobile-menu";
import { ProductMenu } from "./product-menu";

/** The Product menu's foot row: the first few hiring systems by name. */
const WORKS_WITH = hiringSystems.slice(0, 3);

/**
 * The header sits above the hero's rounded panel. Once the page scrolls it
 * floats: the bar becomes a white rounded panel with a shadow, inset from
 * the window's edges like the panels below it (FloatingHeader sets the
 * state). The links: Product ▾ (the feature pages, features/catalog.ts),
 * Pricing, then Log in and Get started.
 *
 * The site's Applicant / Company switcher is left out while the business side
 * is hidden (KAN-239, frontend/CLAUDE.md).
 */
export function Header() {
  return (
    <FloatingHeader>
      <div className="relative isolate">
        {/* The bar's fill is a layer behind the nav, not the nav's parent:
            its backdrop-filter would make it the Product panel's backdrop
            root, and the panel's own blur would see nothing behind it. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 rounded-2xl transition-[background-color,box-shadow] duration-300 group-data-scrolled:bg-white/90 group-data-scrolled:shadow-lg group-data-scrolled:ring-1 group-data-scrolled:shadow-slate-900/5 group-data-scrolled:ring-slate-900/5 group-data-scrolled:backdrop-blur-md"
        />
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
            <li>
              <ProductMenu label="Product">
                <ProductPanel />
              </ProductMenu>
            </li>
            <li>
              <Link
                href={site.pricing.href}
                className="hover:text-ink rounded-md px-3 py-2 text-sm font-medium text-slate-800 transition-colors"
              >
                {site.pricing.label}
              </Link>
            </li>
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

      <MobileMenu
        id="mobile-menu"
        className="border-border inset-x-4 top-20 bottom-auto m-0 h-auto max-h-[calc(100dvh-6rem)] w-auto overflow-y-auto rounded-2xl border bg-white p-4 shadow-xl lg:hidden"
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
          <li>
            {/* The Product menu as an expandable list. */}
            <details className="group">
              <summary className="text-ink hover:bg-surface flex cursor-pointer list-none items-center justify-between rounded-lg px-3 py-2.5 font-medium [&::-webkit-details-marker]:hidden">
                Product
                <ChevronDown
                  aria-hidden="true"
                  className="ease-glide size-5 opacity-60 transition-transform duration-200 group-open:rotate-180"
                />
              </summary>
              <ul className="grid gap-0.5 pt-1 pb-2">
                {featurePages.map((page) => (
                  <li key={page.slug}>
                    <Link
                      href={page.href}
                      className="text-ink hover:bg-surface flex items-center gap-3 rounded-lg px-3 py-2"
                    >
                      <FeatureIcon feature={page} />
                      {page.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          </li>
          <li>
            <Link
              href={site.pricing.href}
              className="text-ink hover:bg-surface block rounded-lg px-3 py-2.5 font-medium"
            >
              {site.pricing.label}
            </Link>
          </li>
        </ul>
        <GlassButton
          href={site.primaryCta.href}
          label={site.primaryCta.label}
          className="mt-4 h-12 w-full text-base"
        />
        <OutlineButton href={site.login.href} size="lg" className="mt-2 w-full">
          {site.login.label}
        </OutlineButton>
      </MobileMenu>
    </FloatingHeader>
  );
}

/**
 * The Product menu's panel: the feature pages in two columns, each with its
 * mark, its name and its content file's `line`, then the hiring systems.
 * Drawn here on the server and passed into ProductMenu, so the content
 * files never reach the browser. Its surface is the floating bar's.
 */
function ProductPanel() {
  return (
    <div className="w-[36rem] rounded-2xl bg-white/90 p-2 shadow-lg ring-1 shadow-slate-900/5 ring-slate-900/5 backdrop-blur-md">
      <ul className="grid grid-cols-2 gap-1">
        {featurePages.map((page) => (
          <li key={page.slug}>
            <Link
              href={page.href}
              className="flex items-start gap-3 rounded-xl p-3 transition-colors duration-200 hover:bg-slate-900/[0.04]"
            >
              <FeatureIcon feature={page} size="md" />
              <span className="min-w-0">
                <span className="text-ink block text-sm font-semibold">{page.name}</span>
                <span className="text-ink-meta mt-0.5 block text-[13px] leading-5">
                  {featureContent[page.slug].line}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {/* The home page's hiring-systems section, until a page of its own. */}
      <Link
        href="/#hiring-systems"
        className="group text-ink-meta hover:text-ink mt-1 flex items-center gap-3 rounded-xl bg-slate-900/[0.03] px-3 py-2.5 text-[13px] font-medium transition-colors duration-200"
      >
        <span className="flex -space-x-1.5" aria-hidden="true">
          {WORKS_WITH.map((system) => (
            <Image
              key={system.name}
              src={`https://www.google.com/s2/favicons?domain=${system.domain}&sz=64`}
              alt=""
              width={20}
              height={20}
              className="size-5 rounded-md bg-white ring-2 ring-white"
            />
          ))}
        </span>
        Works with {WORKS_WITH.map((system) => system.name).join(", ")} and more
        <ArrowRight
          aria-hidden="true"
          className="ml-auto size-4 transition-transform duration-200 group-hover:translate-x-0.5"
        />
      </Link>
    </div>
  );
}
