import type { ComponentType } from "react";

import { cn } from "@/lib/cn";

/**
 * The rounded square standing in for an employer's logo.
 *
 * The mockups draw real company marks and the repo has no image for them, so
 * every screen shows a glyph on a tint instead. That stand-in was written out
 * twice — the applications board and the search results each carried their own
 * tone map, with one tone the other did not have — which is what this replaces.
 *
 * The tile sizes its own glyph. Icon size tracked box size at every call site
 * anyway, and pairing them here is what stops a 16px mark landing in a 64px
 * tile the next time one is added.
 *
 * `tone` is the employer's colour, not a status: the mockups give each company
 * its own so two rows are told apart at a glance. `outline` is the exception —
 * the detail pane draws its tile as an empty bordered square rather than a
 * tinted one, because at 64px a flat tint would outweigh the title beside it.
 */
const SIZES = {
  sm: { box: "size-8 rounded", icon: "size-4" }, // applications board
  md: { box: "size-10 rounded-control", icon: "size-5" }, // search result
  lg: { box: "size-16 rounded-control", icon: "size-7" }, // search detail
  xl: { box: "size-24 rounded-card", icon: "size-10" }, // company profile hero
} as const;

const TONES = {
  brand: "bg-brand-tint text-brand",
  positive: "bg-positive-tint text-positive",
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
