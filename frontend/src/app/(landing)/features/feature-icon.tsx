import { cn } from "@/lib/cn";

import type { Feature } from "./catalog";

const SIZES = {
  sm: { tile: "size-6 rounded-md", icon: "size-3.5" },
  md: { tile: "size-9 rounded-lg", icon: "size-[18px]" },
};

/**
 * A feature's mark: its icon, white on a tile in its own colour. The home
 * tour's stop chips, the Features menu, each feature page's eyebrow and the
 * related-feature cards all draw it, so a feature wears one mark site-wide.
 * The Resources menu draws its items with it too, on one neutral tile
 * (resources/catalog.ts), so the two menus' rows match.
 */
export function FeatureIcon({
  feature,
  size = "sm",
  className,
}: {
  feature: Pick<Feature, "icon" | "glow">;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { icon: Icon, glow } = feature;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center text-white",
        SIZES[size].tile,
        className,
      )}
      style={{ background: glow }}
    >
      <Icon className={SIZES[size].icon} />
    </span>
  );
}
