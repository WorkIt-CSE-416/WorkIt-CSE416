import { Bell, FileText, Target, Zap, type LucideIcon } from "lucide-react";

import { features, type FeatureId } from "./feature-data";
import { FEATURES, type FeatureSlug } from "./features/catalog";

/**
 * The product tour's four tabs, in the tour's order: each stop's label,
 * icon, feature page and colour. The tour draws its tab bar from these, and
 * the bridge above it (bridge.tsx) draws the same four as pills that fly
 * into that bar, so a label or icon changes in one place. A plain module,
 * not a client one, so both import it as data.
 */
export type TourTab = {
  id: FeatureId;
  label: string;
  icon: LucideIcon;
  page: FeatureSlug;
  glow: string;
};

const META: Record<FeatureId, Omit<TourTab, "id" | "glow">> = {
  resumes: { label: "Resumes", icon: FileText, page: "resumes" },
  matching: { label: "Matching", icon: Target, page: "matching" },
  // The app's own Auto Apply glyph (the Jobs page's filters, the sidebar).
  "auto-apply": { label: "Auto Apply", icon: Zap, page: "auto-apply" },
  // The Application Tracker's page shows this stop's animation.
  updates: { label: "Updates", icon: Bell, page: "tracker" },
};

export const TOUR_TABS: TourTab[] = features.map((feature) => ({
  id: feature.id,
  ...META[feature.id],
  glow: FEATURES[META[feature.id].page].glow,
}));

export const tourTab = (id: FeatureId) => TOUR_TABS.find((tab) => tab.id === id) ?? TOUR_TABS[0];
