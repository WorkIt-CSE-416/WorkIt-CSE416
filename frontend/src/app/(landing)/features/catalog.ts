import { FileTextIcon, KanbanIcon, TargetIcon } from "@phosphor-icons/react/ssr";
import { LightningRoundedIcon } from "@/components/custom-icons";
import type { ComponentType } from "react";

import { SparkleIcon } from "@/components/icons";

/**
 * The five feature pages, in the Features menu's order: each page's slug,
 * name, icon and colour. The header's Features menu, the footer, each page's
 * related-feature cards and the home tour's "Learn more" links all read
 * this list, so a page added or renamed here moves everywhere at once.
 * Each page's copy lives in its own file under `content/`, never here.
 *
 * The colours are the home tour's (product-tour.tsx reads them from here):
 * the advanced blue for resumes, violet for matching, positive green for
 * auto apply, the match pink on the danger tint for the tracker (the
 * tour's Updates stop). Scout had no stop, so it takes amber, the one app
 * colour the others leave free.
 */
export type FeatureSlug = "resumes" | "matching" | "auto-apply" | "tracker" | "scout";

export type Feature = {
  slug: FeatureSlug;
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  /** The soft ground behind the feature's visuals. */
  tint: string;
  /** The feature's own colour: its icon tile and the ground's blobs. */
  glow: string;
};

function feature(slug: FeatureSlug, rest: Omit<Feature, "slug" | "href">): Feature {
  return { slug, href: `/features/${slug}`, ...rest };
}

export const FEATURES: Record<FeatureSlug, Feature> = {
  resumes: feature("resumes", {
    name: "Resume Builder",
    icon: FileTextIcon,
    tint: "var(--color-advanced-tint)",
    glow: "var(--color-advanced)",
  }),
  matching: feature("matching", {
    name: "Job Matching",
    icon: TargetIcon,
    tint: "var(--color-brand-tint)",
    glow: "var(--color-brand)",
  }),
  "auto-apply": feature("auto-apply", {
    name: "Auto Apply",
    // The app's own Auto Apply glyph (the sidebar, the Jobs page's filters).
    icon: LightningRoundedIcon,
    tint: "var(--color-positive-tint)",
    glow: "var(--color-positive)",
  }),
  tracker: feature("tracker", {
    name: "Application Tracker",
    // The sidebar's Applications glyph.
    icon: KanbanIcon,
    tint: "var(--color-danger-tint)",
    glow: "var(--color-match-good)",
  }),
  scout: feature("scout", {
    name: "Scout",
    // The one mark for Scout and AI (frontend/CLAUDE.md).
    icon: SparkleIcon,
    tint: "var(--color-warning-tint)",
    glow: "var(--color-warning-strong)",
  }),
};

/** The five pages in menu order. */
export const featurePages = Object.values(FEATURES);

export function isFeatureSlug(slug: string): slug is FeatureSlug {
  return featurePages.some((page) => page.slug === slug);
}

/** A feature's soft, two-blob gradient over its tint: the home tour's
 *  backdrop, behind every visual of that feature. */
export function backdrop({ tint, glow }: Pick<Feature, "tint" | "glow">) {
  const blob = (amount: number) => `color-mix(in oklab, ${glow} ${amount}%, transparent)`;
  return `radial-gradient(55% 65% at 12% 18%, ${blob(38)}, transparent), radial-gradient(50% 60% at 88% 85%, ${blob(30)}, transparent), radial-gradient(40% 50% at 70% 10%, white, transparent), ${tint}`;
}
