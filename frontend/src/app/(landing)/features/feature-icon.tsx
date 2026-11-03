import { cn } from "@/lib/cn";

import type { Feature } from "./catalog";

const SIZES = {
  sm: { tile: "size-6 rounded-md", icon: "size-3.5" },
  md: { tile: "size-9 rounded-lg", icon: "size-[18px]" },
};

/**
 * A feature's mark: its icon on a tile in its own colour, the feature's
 * `onGlow` pair (white on most, ink on Scout's amber). The home
 * tour's stop chips, the Features menu, each feature page's eyebrow and the
 * related-feature cards all draw it, so a feature wears one mark site-wide.
 * The Resources menu draws its items with it too, on one neutral tile
 * (resources/catalog.ts), so the two menus' rows match. An item with no
 * `onGlow` draws white on its `glow`, which must then hold 4.5:1 (the
 * resources' grey does).
 */
export function FeatureIcon({
  feature,
  size = "sm",
  className,
}: {
  feature: Pick<Feature, "icon" | "glow"> & Partial<Pick<Feature, "onGlow">>;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { icon: Icon, glow, onGlow = { fill: glow, ink: "white" } } = feature;
  return (
    <span
      aria-hidden="true"
      className={cn("flex shrink-0 items-center justify-center", SIZES[size].tile, className)}
      style={{ background: onGlow.fill, color: onGlow.ink }}
    >
      <Icon aria-hidden className={SIZES[size].icon} />
    </span>
  );
}
