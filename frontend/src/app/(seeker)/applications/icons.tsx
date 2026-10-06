import {
  Box,
  Building,
  Cloud,
  Landmark,
  LayoutGrid,
  Leaf,
  List,
  Network,
  Orbit,
  Plane,
  SquareKanban,
  Store,
} from "lucide-react";

type IconProps = { className?: string };

/* The glyphs only this screen draws. Like @/components/icons, they are thin
 * wrappers over Lucide at its default stroke: they used to be hand-drawn at a
 * 1.4 stroke on a 16-unit grid, a second icon family beside the shared one.
 * The ellipsis, the calendar and the clock live in @/components/icons, since
 * other screens draw them too. */

/* Company marks ----------------------------------------------------------
 * Stand-ins, the same bargain the Avatar strikes: KAN-43 ships no company
 * logos, and an outlined tile with a glyph holds the right size and weight
 * until real artwork exists. The first five are the shapes the mockup draws
 * for those companies; the rest were picked from each company's name.
 *
 * Every company keeps its own glyph, and none is a stage's (../stage-colors.ts
 * STAGE_ICON). Two fixtures used to share a building and two a briefcase, and
 * the briefcase is the Applied glyph and the award the Offer one, so a tile
 * in those columns read as a second stage marker.
 * -------------------------------------------------------------------- */

export function BuildingIcon({ className }: IconProps) {
  return <Building aria-hidden className={className} />;
}

export function CubeIcon({ className }: IconProps) {
  return <Box aria-hidden className={className} />;
}

export function NodesIcon({ className }: IconProps) {
  return <Network aria-hidden className={className} />;
}

export function StorefrontIcon({ className }: IconProps) {
  return <Store aria-hidden className={className} />;
}

export function CloudIcon({ className }: IconProps) {
  return <Cloud aria-hidden className={className} />;
}

export function OrbitIcon({ className }: IconProps) {
  return <Orbit aria-hidden className={className} />;
}

/** A bank's columned front, for Harbor Bank. */
export function LandmarkIcon({ className }: IconProps) {
  return <Landmark aria-hidden className={className} />;
}

export function PlaneIcon({ className }: IconProps) {
  return <Plane aria-hidden className={className} />;
}

export function LeafIcon({ className }: IconProps) {
  return <Leaf aria-hidden className={className} />;
}

/* View switcher ----------------------------------------------------------
 * Each glyph draws the shape of its layout: columns, cells, rows.
 * ---------------------------------------------------------------------- */

export function BoardIcon({ className }: IconProps) {
  return <SquareKanban aria-hidden className={className} />;
}

export function GridIcon({ className }: IconProps) {
  return <LayoutGrid aria-hidden className={className} />;
}

export function ListIcon({ className }: IconProps) {
  return <List aria-hidden className={className} />;
}
