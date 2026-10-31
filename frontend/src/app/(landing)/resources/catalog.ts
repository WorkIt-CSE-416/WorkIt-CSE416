import { LifebuoyIcon, NewspaperIcon, PlugIcon } from "@phosphor-icons/react/ssr";
import type { ComponentType } from "react";

/**
 * The Resources menu's items, in menu order: each one's name, link, icon and
 * the line under its name. The header's Resources menu, the phone menu and
 * the footer's Resources column all read this list, the way
 * features/catalog.ts feeds the Features menu.
 *
 * While an item has `soon`, the menu marks it Soon and its route renders
 * ComingSoonPage (coming-soon.tsx) with this copy. When a real page lands,
 * it replaces the route file and the item drops `soon`. Every line here is
 * a claim. MCP docs has its page (KAN-383): the connector for Claude
 * (auto-apply/architecture.md, 14.6); Help Center and Blog are still soon.
 */
export type ResourceSlug = "mcp" | "help" | "blog";

export type Resource = {
  slug: ResourceSlug;
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  /** The tile behind the icon: one neutral colour for all three, so a
   *  resource never reads as one of the coloured features. */
  glow: string;
  /** One short line under the name in the menu. */
  line: string;
  /** Set while the item has no page: the coming-soon page's copy. */
  soon?: {
    /** What the page will hold, said plainly as not here yet. */
    summary: string;
    /** A page that exists now and covers some of the same ground. */
    meanwhile: { label: string; href: string };
  };
};

function resource(slug: ResourceSlug, rest: Omit<Resource, "slug" | "glow">): Resource {
  return { slug, glow: "var(--color-ink-meta)", ...rest };
}

export const RESOURCES: Record<ResourceSlug, Resource> = {
  mcp: resource("mcp", {
    name: "MCP docs",
    href: "/docs/mcp",
    icon: PlugIcon,
    line: "Let your Claude write your answers",
  }),
  help: resource("help", {
    name: "Help Center",
    href: "/help-center",
    icon: LifebuoyIcon,
    line: "Guides and answers for WorkIt",
    soon: {
      summary:
        "Step-by-step guides for each part of WorkIt are on the way. Until then, the FAQ on the home page answers the common questions.",
      meanwhile: { label: "Read the FAQ", href: "/#faq" },
    },
  }),
  blog: resource("blog", {
    name: "Blog",
    href: "/blog",
    icon: NewspaperIcon,
    line: "News and tips from the team",
    soon: {
      summary:
        "The WorkIt blog has no posts yet. Product news and job-search tips from the team will appear here.",
      meanwhile: { label: "See what WorkIt does", href: "/" },
    },
  }),
};

/** The three items in menu order. */
export const resourcePages = Object.values(RESOURCES);
