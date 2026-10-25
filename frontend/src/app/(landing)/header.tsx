import { ArrowRightIcon, CaretDownIcon, ListIcon, XIcon } from "@phosphor-icons/react/ssr";
import Image from "next/image";
import Link from "next/link";

import { Logo } from "@/components/logo";
import { cn } from "@/lib/cn";

import { hiringSystems, site } from "./data";
import { featurePages, type Feature } from "./features/catalog";
import { featureContent } from "./features/content";
import { FeatureIcon } from "./features/feature-icon";
import { FloatingHeader } from "./floating-header";
import { GlassButton, OutlineButton } from "./buttons";
import { NAV_ITEM } from "./layout-parts";
import { MobileMenu } from "./mobile-menu";
import { NavMenu, NavMenuGroup } from "./nav-menu";
import { resourcePages, type Resource } from "./resources/catalog";

/** The Features menu's foot row: the first few hiring systems by name. */
const WORKS_WITH = hiringSystems.slice(0, 3);

/**
 * The header sits above the hero's rounded panel. Once the page scrolls it
 * floats: the bar becomes a white rounded panel with a shadow, inset from
 * the window's edges like the panels below it (FloatingHeader sets the
 * state). The links: Features ▾ (the feature pages, features/catalog.ts),
 * Resources ▾ (resources/catalog.ts), Pricing, then Log in and Get started.
 *
 * The site's Applicant / Company switcher is left out while the business side
 * is hidden (KAN-239, frontend/CLAUDE.md).
 */
export function Header() {
  return (
    <FloatingHeader>
      <div className="relative isolate">
        {/* The bar's fill is a layer behind the nav, not the nav's parent:
            its backdrop-filter would make it the menu panels' backdrop
            root, and a panel's own blur would see nothing behind it. */}
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

          <NavMenuGroup>
            <ul className="hidden items-center gap-1 lg:flex">
              <li>
                <NavMenu label="Features">
                  <FeaturesPanel />
                </NavMenu>
              </li>
              <li>
                <NavMenu label="Resources">
                  <ResourcesPanel />
                </NavMenu>
              </li>
              <li>
                <Link href={site.pricing.href} className={NAV_ITEM}>
                  {site.pricing.label}
                </Link>
              </li>
            </ul>
          </NavMenuGroup>

          <div className="flex items-center gap-2 lg:justify-self-end">
            <div className="hidden md:block">
              <OutlineButton href={site.login.href}>{site.login.label}</OutlineButton>
            </div>
            <div className="hidden sm:block">
              <GlassButton href={site.primaryCta.href} label={site.primaryCta.label} />
            </div>
            {/* On a phone too, shortened to fit beside the logo and the menu:
                with only the menu there, the sign-up was two taps away
                (KAN-368). */}
            <div className="sm:hidden">
              <GlassButton href={site.primaryCta.href} label="Get started" className="px-3" />
            </div>
            <button
              type="button"
              popoverTarget="mobile-menu"
              className="text-ink hover:bg-surface inline-flex size-10 items-center justify-center rounded-lg lg:hidden"
              aria-label="Open menu"
            >
              <ListIcon className="size-6" aria-hidden="true" />
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
            <XIcon className="size-6" aria-hidden="true" />
          </button>
        </div>
        <ul className="mt-4 grid gap-1">
          {/* The two header menus as expandable lists. */}
          <MobileGroup label="Features" items={featurePages} />
          <MobileGroup label="Resources" items={resourcePages} />
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

/** A menu item's mark, name and link: a feature or a resource. A resource
 *  with no page yet carries `soon`. */
type MenuItem = Pick<Feature, "href" | "name" | "icon" | "glow"> & Partial<Pick<Resource, "soon">>;

/** The surface both menu panels share, the floating bar's. */
const MENU_PANEL =
  "rounded-2xl bg-white/90 p-2 shadow-lg ring-1 shadow-slate-900/5 ring-slate-900/5 backdrop-blur-md";

/**
 * The Features menu's panel: the feature pages in two columns, each with its
 * mark, its name and its content file's `line`, then the hiring systems.
 * Drawn here on the server and passed into NavMenu, so the content files
 * never reach the browser.
 */
function FeaturesPanel() {
  return (
    <div className={cn(MENU_PANEL, "w-[36rem]")}>
      <ul className="grid grid-cols-2 gap-1">
        {featurePages.map((page) => (
          <li key={page.slug}>
            <MenuLink item={page} line={featureContent[page.slug].line} />
          </li>
        ))}
      </ul>
      {/* The home page's hiring-systems section, which has no page of its own. */}
      <Link
        href="/#hiring-systems"
        className="group text-ink-meta hover:text-ink mt-1 flex items-center gap-3 rounded-xl bg-slate-900/[0.03] px-3 py-2.5 text-[13px] font-medium transition-colors duration-200"
      >
        <span className="flex -space-x-1.5" aria-hidden="true">
          {WORKS_WITH.map((system) => (
            <Image
              key={system.name}
              src={system.logo}
              alt=""
              width={20}
              height={20}
              className="size-5 rounded-md bg-white ring-2 ring-white"
            />
          ))}
        </span>
        Works with {WORKS_WITH.map((system) => system.name).join(", ")} and more
        <ArrowRightIcon
          aria-hidden="true"
          className="ml-auto size-4 transition-transform duration-200 group-hover:translate-x-0.5"
        />
      </Link>
    </div>
  );
}

/** The Resources menu's panel: one column, drawn like the Features panel's
 *  items. An item with no page yet is marked Soon. */
function ResourcesPanel() {
  return (
    <div className={cn(MENU_PANEL, "w-[21rem]")}>
      <ul className="grid gap-1">
        {resourcePages.map((resource) => (
          <li key={resource.slug}>
            <MenuLink item={resource} line={resource.line} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One item in a desktop menu panel: its mark, its name and a line under it. */
function MenuLink({ item, line }: { item: MenuItem; line: string }) {
  return (
    <Link
      href={item.href}
      className="flex items-start gap-3 rounded-xl p-3 transition-colors duration-200 hover:bg-slate-900/[0.04]"
    >
      <FeatureIcon feature={item} size="md" />
      <span className="min-w-0">
        <span className="text-ink flex items-center gap-2 text-sm font-semibold">
          {item.name}
          {item.soon && <SoonBadge />}
        </span>
        <span className="text-ink-meta mt-0.5 block text-[13px] leading-5">{line}</span>
      </span>
    </Link>
  );
}

/** One header menu in the phone menu: a native disclosure listing its items. */
function MobileGroup({ label, items }: { label: string; items: MenuItem[] }) {
  return (
    <li>
      <details className="group">
        <summary className="text-ink hover:bg-surface flex cursor-pointer list-none items-center justify-between rounded-lg px-3 py-2.5 font-medium [&::-webkit-details-marker]:hidden">
          {label}
          <CaretDownIcon
            aria-hidden="true"
            className="ease-glide size-5 opacity-60 transition-transform duration-200 group-open:rotate-180"
          />
        </summary>
        <ul className="grid gap-0.5 pt-1 pb-2">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="text-ink hover:bg-surface flex items-center gap-3 rounded-lg px-3 py-2"
              >
                <FeatureIcon feature={item} />
                {item.name}
                {item.soon && <SoonBadge />}
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

/** Marks a menu item whose page is a coming-soon placeholder. */
function SoonBadge() {
  return (
    <span className="text-ink-meta rounded-full bg-slate-900/[0.06] px-1.5 py-px text-[11px] leading-4 font-medium">
      Soon
    </span>
  );
}
