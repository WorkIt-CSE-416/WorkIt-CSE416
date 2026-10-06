import type { ComponentType } from "react";

import { cn } from "@/lib/cn";

/**
 * The rounded square standing in for an employer's logo.
 *
 * The mockups draw real company marks and the repo has no image for them, so
 * every screen shows a glyph on a tint instead. That stand-in was written out
 * twice (the applications board and the old search results each carried their
 * own tone map, with one tone the other did not have), which is what this
 * replaces.
 *
 * The tile sizes its own glyph. Icon size tracked box size at every call site
 * anyway, and pairing them here is what stops a 16px mark landing in a 64px
 * tile the next time one is added.
 *
 * `tone` is the employer's colour, not a status: the mockups give each company
 * its own so two rows are told apart at a glance. `outline` is the exception,
 * an empty bordered square rather than a tint. The Applications board, grid
 * and list use it at sm, because there a tinted tile read as a stage colour
 * (violet is Applied, green is Offer), so their tiles stay neutral and the
 * column or badge carries the stage. The company job page's header uses it at
 * sm, and the company profile's hero at xl, on a cover nobody has chosen yet.
 */
const SIZES = {
  sm: { box: "size-8 rounded", icon: "size-4" }, // applications board, grid and list
  md: { box: "size-10 rounded-control", icon: "size-5" }, // design kit only
  lg: { box: "size-16 rounded-control", icon: "size-7" }, // design kit only
  xl: { box: "size-24 rounded-card", icon: "size-10" }, // company profile hero
} as const;

const TONES = {
  brand: "bg-brand-tint text-brand",
  positive: "bg-positive-tint text-positive-ink",
  deep: "bg-ink text-on-brand",
  outline: "border-border-subtle bg-panel text-ink-meta border",
} as const;

export type CompanyTileSize = keyof typeof SIZES;
export type CompanyTileTone = keyof typeof TONES;

type CompanyTileProps = {
  Icon: ComponentType<{ className?: string }>;
  size?: CompanyTileSize;
  tone?: CompanyTileTone;
  className?: string;
};

export function CompanyTile({ Icon, size = "md", tone = "brand", className }: CompanyTileProps) {
  const { box, icon } = SIZES[size];

  return (
    <span className={cn("flex shrink-0 items-center justify-center", box, TONES[tone], className)}>
      <Icon className={icon} />
    </span>
  );
}
