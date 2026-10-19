import type { ReactNode } from "react";

/**
 * A flat skyline in WorkIt's violet, behind the auth screens' card (KAN-259).
 * Decoration only.
 *
 * DEPTH COMES FROM FOUR ROWS AND ONE LIGHT. Each row further back is paler,
 * its towers slimmer, its foot lost in the haze. A pale sun hangs low on the
 * left, so every tower in the three near rows has its right face in shade,
 * and the front row has lit windows and trees along its foot.
 *
 * Drawn here rather than shipped as an image: every colour is the brand
 * violet mixed into white, or deepened toward ink for what stands nearest, so
 * it follows the palette the way onboarding's wash does
 * (onboarding/applicant/story-panel.tsx), and there is no asset to keep in
 * step with it.
 *
 * A row is one path with a subpath for each piece of each tower, all wound
 * clockwise, so pieces that touch merge rather than cancel. A piece's shade is
 * the right third of its box, clipped to the row's outline so it follows
 * domes and slopes. Windows are patterns over an inset of each body; the lit
 * ones sit on the same grid, picked by a seeded random so every render draws
 * the same city. The farthest row is generated the same way.
 *
 * Drawn to cover its box (`slice`), floor down: a narrow box crops the sides,
 * a wide one the sky. The tallest tip stands 138 units under the viewBox's
 * top, so that much sky can go before a tower is cut; the sun's glow and the
 * clouds may lose their tops first.
 */

/** The viewBox is 1600 by 480, and every tower stands on its floor. */
const WIDTH = 1600;
const FLOOR = 480;
/** The street along the floor, which closes the gaps between towers. */
const GROUND = 24;
/** How much of each piece, from its right edge, is in shade. */
const SHADE = 0.34;

type Roof =
  | "flat"
  | "step"
  | "steps"
  | "ziggurat"
  | "antenna"
  | "spire"
  | "boxes"
  | "tank"
  | "pyramid"
  | "gable"
  | "cupola"
  | "crown"
  | "round"
  | "slant"
  | "curve"
  | "cut"
  | "needle"
  | "twin";
type Panes = "rows" | "dots" | "grid" | "columns" | "bands";
type Tower = {
  x: number;
  w: number;
  h: number;
  roof?: Roof;
  panes?: Panes;
  /** The share of its window cells lit. */
  lit?: number;
  /** Drawn in its row's second tone, to set it off from its neighbours. */
  alt?: boolean;
};
type Box = { x: number; y: number; w: number; h: number };
/** One shape of a tower, and the box its shade is cut from. */
type Piece = { d: string; box: Box };

/** The brand violet mixed into white. */
const tint = (pct: number) => `color-mix(in oklab, var(--color-brand) ${pct}%, var(--color-panel))`;
/** The deepest brand violet taken toward ink, for what stands nearest. */
const deep = (pct: number) =>
  `color-mix(in oklab, var(--color-brand-active) ${pct}%, var(--color-ink))`;

/** Whole units: a finer point is invisible at any size the skyline is drawn,
 *  and the paths ship in the markup of every auth screen. */
const n = (v: number) => Math.round(v);
const rectD = ({ x, y, w, h }: Box) => `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`;
const block = (x: number, y: number, w: number, h: number): Piece => ({
  d: rectD({ x, y, w, h }),
  box: { x, y, w, h },
});
/** A triangle on the base from x to x + w at y, its apex `rise` above `apex`. */
const peak = (x: number, y: number, w: number, apex: number, rise: number): Piece => ({
  d: `M${n(x)} ${n(y)}L${n(apex)} ${n(y - rise)}L${n(x + w)} ${n(y)}z`,
  box: { x, y: y - rise, w, h: rise },
});
/** A half ellipse standing on the base from x to x + w at y. */
const dome = (x: number, y: number, w: number, rise: number): Piece => ({
  d: `M${n(x)} ${n(y)}A${n(w / 2)} ${n(rise)} 0 0 1 ${n(x + w)} ${n(y)}z`,
  box: { x, y: y - rise, w, h: rise },
});
const ellipse = (cx: number, cy: number, rx: number, ry: number): Piece => ({
  d: `M${n(cx - rx)} ${n(cy)}a${n(rx)} ${n(ry)} 0 1 1 ${n(rx * 2)} 0a${n(rx)} ${n(ry)} 0 1 1 ${n(-rx * 2)} 0z`,
  box: { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 },
});

/** A tower's shapes: its body, then whatever stands on its roof. */
function pieces({ x, w, h, roof = "flat" }: Tower): Piece[] {
  const y = FLOOR - h;
  const mid = x + w / 2;
  const body = block(x, y, w, h);
  const mast = (top: number, tall: number) => block(mid - 1.5, top - tall, 3, tall);
  switch (roof) {
    case "step":
      return [body, block(x + w * 0.18, y - 16, w * 0.64, 16)];
    case "steps":
      return [
        body,
        block(x + w * 0.12, y - 20, w * 0.76, 20),
        block(x + w * 0.3, y - 36, w * 0.4, 16),
      ];
    case "ziggurat":
      return [
        body,
        block(x + w * 0.1, y - 14, w * 0.8, 14),
        block(x + w * 0.22, y - 28, w * 0.56, 14),
        block(x + w * 0.34, y - 42, w * 0.32, 14),
        mast(y - 42, 20),
      ];
    case "antenna":
      return [body, block(x + w * 0.3, y - 12, w * 0.4, 12), mast(y - 12, 34)];
    case "spire":
      return [body, block(x + w * 0.22, y - 16, w * 0.56, 16), peak(mid - 7, y - 16, 14, mid, 50)];
    case "boxes":
      return [
        body,
        block(x + w * 0.14, y - 16, 9, 16),
        block(x + w * 0.34, y - 26, 9, 26),
        block(x + w * 0.58, y - 12, 15, 12),
      ];
    case "tank": {
      // A water tank on two legs, under a pointed lid.
      const t = x + w * 0.6;
      return [
        body,
        block(t + 1, y - 10, 2, 10),
        block(t + 11, y - 10, 2, 10),
        block(t, y - 24, 14, 14),
        peak(t - 2, y - 24, 18, t + 7, 8),
      ];
    }
    case "pyramid":
      return [body, peak(x, y, w, mid, w * 0.42)];
    case "gable":
      return [body, peak(x - 3, y, w + 6, mid, 22)];
    case "cupola":
      return [
        body,
        block(x + w * 0.2, y - 10, w * 0.6, 10),
        dome(x + w * 0.2, y - 10, w * 0.6, w * 0.26),
        mast(y - 10 - w * 0.26, 16),
      ];
    case "crown":
      // Art deco: three arched tiers under a needle.
      return [
        body,
        dome(x + w * 0.06, y, w * 0.88, 20),
        dome(x + w * 0.2, y - 14, w * 0.6, 18),
        dome(x + w * 0.34, y - 28, w * 0.32, 16),
        peak(mid - 4, y - 38, 8, mid, 34),
      ];
    case "round": {
      const r = Math.min(w / 2, 16);
      return [
        {
          d: `M${n(x)} ${FLOOR}V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}V${FLOOR}z`,
          box: body.box,
        },
      ];
    }
    case "slant":
      return [{ d: `M${n(x)} ${FLOOR}V${n(y + 28)}L${n(x + w)} ${n(y)}V${FLOOR}z`, box: body.box }];
    case "curve":
      return [
        {
          d: `M${n(x)} ${FLOOR}V${n(y + 30)}Q${n(x + w * 0.55)} ${n(y - 4)} ${n(x + w)} ${n(y)}V${FLOOR}z`,
          box: { x, y: y - 4, w, h: h + 4 },
        },
      ];
    case "cut":
      return [
        {
          d: `M${n(x)} ${FLOOR}V${n(y)}H${n(x + w - 26)}L${n(x + w)} ${n(y + 26)}V${FLOOR}z`,
          box: body.box,
        },
      ];
    case "needle":
      // A TV tower: a shaft, two discs near its top, and a mast.
      return [
        block(mid - 4, y, 8, h),
        ellipse(mid, y + 36, w / 2, 9),
        ellipse(mid, y + 20, w * 0.3, 6),
        mast(y + 14, 48),
      ];
    case "twin": {
      // Two towers, the right one shorter, joined by a sky bridge.
      const side = w * 0.42;
      return [
        block(x, y, side, h),
        block(x + w - side, y + 24, side, h - 24),
        block(x + side, y + 70, w - side * 2, 10),
      ];
    }
    default:
      return [body];
  }
}

/** Where a tower's windows go: in from its walls, under its roof and clear
 *  of the street. A twin tower has two such areas, a TV tower none. */
function glazing({ x, w, h, roof }: Tower, wall: number): Box[] {
  const under =
    roof === "round" ? 24 : roof === "slant" || roof === "curve" ? 42 : roof === "cut" ? 32 : 12;
  const top = FLOOR - h + under;
  const bottom = FLOOR - GROUND - 6;
  if (roof === "needle") return [];
  if (roof === "twin") {
    const side = w * 0.42;
    return [
      { x: x + wall, y: top, w: side - wall * 2, h: bottom - top },
      { x: x + w - side + wall, y: top + 24, w: side - wall * 2, h: bottom - top - 24 },
    ];
  }
  return [{ x: x + wall, y: top, w: w - wall * 2, h: bottom - top }];
}

/** Each window style's grid, as its pattern draws it: the step between
 *  cells, and the pane at the top left of each. */
const PANES: Record<Panes, { dx: number; dy: number; w: number; h: number }> = {
  rows: { dx: 10, dy: 9, w: 10, h: 2 },
  dots: { dx: 12, dy: 10, w: 7, h: 2 },
  grid: { dx: 9, dy: 11, w: 5, h: 6 },
  columns: { dx: 8, dy: 10, w: 2, h: 10 },
  bands: { dx: 10, dy: 14, w: 10, h: 6 },
};

/** mulberry32, a small seeded random: the same seed draws the same city. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lit panes, on the grid of each tower's own window pattern. */
function litPanes(towers: Tower[], wall: number, random: () => number) {
  let d = "";
  for (const tower of towers) {
    if (!tower.lit || !tower.panes) continue;
    const { dx, dy, w, h } = PANES[tower.panes];
    for (const area of glazing(tower, wall)) {
      for (let y = Math.ceil(area.y / dy) * dy; y + h <= area.y + area.h; y += dy) {
        for (let x = Math.ceil(area.x / dx) * dx; x + w <= area.x + area.w; x += dx) {
          if (random() < tower.lit) d += rectD({ x, y, w, h });
        }
      }
    }
  }
  return d;
}

/** Pieces as one outline, and the shade on their right faces. */
function shapes(parts: Piece[]) {
  return {
    outline: parts.map((p) => p.d).join(""),
    shade: parts
      .map(({ box }) => rectD({ ...box, x: box.x + box.w * (1 - SHADE), w: box.w * SHADE }))
      .join(""),
  };
}

/** Everything a row draws, worked out once. */
function row(towers: Tower[], wall: number, seed: number) {
  const panes: Partial<Record<Panes, string>> = {};
  for (const tower of towers) {
    if (!tower.panes) continue;
    panes[tower.panes] = (panes[tower.panes] ?? "") + glazing(tower, wall).map(rectD).join("");
  }
  return {
    ...shapes(towers.flatMap(pieces)),
    alt: shapes(towers.filter((t) => t.alt).flatMap(pieces)).outline,
    panes,
    lit: litPanes(towers, wall, seeded(seed)),
  };
}

type RowPaths = ReturnType<typeof row>;

/** The farthest row is generated, not placed: slim towers too faint for any
 *  one of them to matter. */
function farthest(): Tower[] {
  const random = seeded(7);
  const roofs: Roof[] = ["flat", "step", "steps", "antenna", "spire", "round"];
  const towers: Tower[] = [];
  for (let x = -16; x < WIDTH;) {
    const w = 24 + random() * 30;
    const roof = roofs[Math.floor(random() * roofs.length)];
    towers.push({ x, w, h: 200 + random() * 100, roof });
    x += w + 6 + random() * 24;
  }
  return towers;
}

const BACK: Tower[] = [
  { x: -6, w: 58, h: 220, roof: "steps" },
  { x: 60, w: 44, h: 262, roof: "spire", panes: "columns" },
  { x: 112, w: 82, h: 205, roof: "twin" },
  { x: 204, w: 50, h: 240, roof: "antenna", panes: "columns" },
  { x: 262, w: 70, h: 196, roof: "pyramid" },
  { x: 340, w: 56, h: 285, roof: "steps", panes: "columns" },
  { x: 404, w: 64, h: 214, roof: "round" },
  { x: 476, w: 48, h: 250, roof: "spire", panes: "columns" },
  { x: 532, w: 86, h: 200, roof: "boxes" },
  { x: 626, w: 58, h: 270, roof: "ziggurat", panes: "columns" },
  { x: 692, w: 66, h: 222 },
  { x: 766, w: 52, h: 258, roof: "antenna", panes: "columns" },
  { x: 826, w: 80, h: 208, roof: "gable" },
  { x: 914, w: 56, h: 290, roof: "steps", panes: "columns" },
  { x: 978, w: 70, h: 230, roof: "cupola" },
  { x: 1056, w: 48, h: 262, roof: "spire", panes: "columns" },
  { x: 1112, w: 84, h: 200, roof: "twin" },
  { x: 1204, w: 58, h: 245, roof: "antenna", panes: "columns" },
  { x: 1270, w: 66, h: 215, roof: "pyramid" },
  { x: 1344, w: 54, h: 280, roof: "ziggurat", panes: "columns" },
  { x: 1406, w: 78, h: 205 },
  { x: 1492, w: 52, h: 255, roof: "spire", panes: "columns" },
  { x: 1552, w: 60, h: 225, roof: "steps" },
];

const MIDDLE: Tower[] = [
  { x: -14, w: 92, h: 168, roof: "step", panes: "columns" },
  { x: 86, w: 64, h: 214, roof: "antenna", panes: "columns", alt: true },
  { x: 158, w: 104, h: 150, roof: "boxes", panes: "grid" },
  { x: 270, w: 78, h: 236, roof: "crown", panes: "columns" },
  { x: 356, w: 96, h: 178, roof: "slant", panes: "grid", alt: true },
  { x: 460, w: 70, h: 222, roof: "steps", panes: "columns" },
  { x: 538, w: 112, h: 160, panes: "grid", alt: true },
  { x: 658, w: 76, h: 246, roof: "pyramid", panes: "columns" },
  { x: 742, w: 92, h: 190, roof: "round", panes: "bands", alt: true },
  { x: 842, w: 70, h: 232, roof: "ziggurat", panes: "columns" },
  { x: 920, w: 112, h: 168, roof: "tank", panes: "grid", alt: true },
  { x: 1040, w: 76, h: 238, roof: "antenna", panes: "columns" },
  { x: 1124, w: 40, h: 300, roof: "needle" },
  { x: 1172, w: 98, h: 176, roof: "gable", panes: "grid", alt: true },
  { x: 1278, w: 72, h: 228, roof: "steps", panes: "columns" },
  { x: 1358, w: 104, h: 160, roof: "slant", panes: "grid", alt: true },
  { x: 1470, w: 66, h: 218, roof: "spire", panes: "columns" },
  { x: 1544, w: 80, h: 184, roof: "step", panes: "grid", alt: true },
];

/** The front row's one curved tower, which wears a glass arch. */
const CURVED: Tower = { x: 586, w: 96, h: 152, roof: "curve" };

const FRONT: Tower[] = [
  { x: -12, w: 76, h: 116, panes: "rows", lit: 0.16 },
  { x: 70, w: 70, h: 184, roof: "spire", panes: "dots", lit: 0.14, alt: true },
  { x: 146, w: 108, h: 124, roof: "tank", panes: "rows", lit: 0.16 },
  { x: 260, w: 84, h: 156, roof: "round", panes: "bands", alt: true },
  { x: 350, w: 140, h: 100, roof: "step", panes: "grid", lit: 0.14 },
  { x: 496, w: 84, h: 190, roof: "boxes", panes: "rows", lit: 0.16, alt: true },
  CURVED,
  { x: 688, w: 88, h: 178, roof: "round", panes: "dots", lit: 0.14, alt: true },
  { x: 782, w: 150, h: 212, roof: "cut", panes: "rows", lit: 0.12 },
  { x: 938, w: 62, h: 128, roof: "antenna", panes: "grid", lit: 0.2, alt: true },
  { x: 1006, w: 92, h: 166, roof: "slant", panes: "rows", lit: 0.16 },
  { x: 1104, w: 124, h: 104, roof: "boxes", panes: "dots", lit: 0.14, alt: true },
  { x: 1234, w: 80, h: 158, roof: "pyramid", panes: "grid", lit: 0.16 },
  { x: 1320, w: 112, h: 124, roof: "ziggurat", panes: "rows", lit: 0.16, alt: true },
  { x: 1438, w: 72, h: 190, roof: "spire", panes: "dots", lit: 0.14 },
  { x: 1516, w: 96, h: 118, roof: "tank", panes: "grid", lit: 0.16, alt: true },
];

/** The curved tower's glass front: a pointed arch from the street up. */
const ARCH = `M${n(CURVED.x + CURVED.w * 0.22)} ${FLOOR - GROUND}V${FLOOR - 72}Q${n(CURVED.x + CURVED.w / 2)} ${FLOOR - 120} ${n(CURVED.x + CURVED.w * 0.78)} ${FLOOR - 72}V${FLOOR - GROUND}z`;

/** A flat cloud: a pill along its base, two puffs on top. */
function cloud(x: number, y: number, w: number) {
  return (
    `M${n(x + 7)} ${n(y)}H${n(x + w - 7)}A7 7 0 0 1 ${n(x + w - 7)} ${n(y + 14)}H${n(x + 7)}A7 7 0 0 1 ${n(x + 7)} ${n(y)}z` +
    ellipse(x + w * 0.36, y + 2, w * 0.16, w * 0.16).d +
    ellipse(x + w * 0.6, y, w * 0.2, w * 0.2).d
  );
}

/** Trees along the front row's foot, a few at each spot: a round crown on a
 *  short trunk, lit and shaded like the towers. */
function trees(): RowPaths {
  const random = seeded(23);
  const street = FLOOR - GROUND;
  const parts: Piece[] = [];
  for (const at of [30, 214, 444, 744, 1008, 1226, 1468]) {
    for (let i = 0; i < 3; i++) {
      const r = 9 + random() * 6;
      const x = at + i * 20 + random() * 6;
      const y = street - 7 - r * 1.1;
      parts.push(block(x - 1.5, y, 3, street - y + 2), ellipse(x, y, r, r * 1.1));
    }
  }
  return { ...shapes(parts), alt: "", panes: {}, lit: "" };
}

/** The sun, low on the left: every shade falls to the right of what it lights. */
const SUN = { x: 420, y: 212, r: 74 };
const CLOUDS = cloud(330, 226, 130) + cloud(1290, 150, 120) + cloud(60, 118, 90);
const FARTHEST = farthest()
  .flatMap(pieces)
  .map((p) => p.d)
  .join("");
const BACK_ROW = row(BACK, 6, 11);
const MIDDLE_ROW = row(MIDDLE, 7, 13);
const FRONT_ROW = row(FRONT, 8, 17);
const TREES = trees();

/** The horizon's lavender, which every row fades into at its foot. */
const HAZE = tint(16);

export function Skyline({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${WIDTH} ${FLOOR}`}
      preserveAspectRatio="xMidYMax slice"
      className={className}
    >
      <defs>
        <linearGradient id="skyline-haze" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopOpacity="0" style={{ stopColor: HAZE }} />
          <stop offset="1" style={{ stopColor: HAZE }} />
        </linearGradient>
        <linearGradient
          id="skyline-back"
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="150"
          x2="0"
          y2="440"
        >
          <stop offset="0" style={{ stopColor: tint(32) }} />
          <stop offset="1" style={{ stopColor: tint(22) }} />
        </linearGradient>
        <linearGradient
          id="skyline-middle"
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="180"
          x2="0"
          y2="460"
        >
          <stop offset="0" style={{ stopColor: tint(56) }} />
          <stop offset="1" style={{ stopColor: tint(44) }} />
        </linearGradient>
        <linearGradient
          id="skyline-middle-alt"
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="180"
          x2="0"
          y2="460"
        >
          <stop offset="0" style={{ stopColor: tint(64) }} />
          <stop offset="1" style={{ stopColor: tint(51) }} />
        </linearGradient>
        <radialGradient id="skyline-glow">
          <stop offset="0.45" stopOpacity="0.8" style={{ stopColor: "var(--color-panel)" }} />
          <stop offset="1" stopOpacity="0" style={{ stopColor: "var(--color-panel)" }} />
        </radialGradient>
        <pattern id="skyline-arch" patternUnits="userSpaceOnUse" width="10" height="9">
          <rect width="10" height="3" style={{ fill: "var(--color-brand-active)" }} />
        </pattern>
      </defs>

      <circle cx={SUN.x} cy={SUN.y} r={SUN.r * 2} fill="url(#skyline-glow)" />
      <circle cx={SUN.x} cy={SUN.y} r={SUN.r} style={{ fill: "var(--color-panel)" }} />
      <path d={CLOUDS} fillOpacity="0.9" style={{ fill: "var(--color-panel)" }} />

      <path d={FARTHEST} style={{ fill: tint(22) }} />
      <Haze top={250} strength={0.85} />

      <Row
        name="back"
        paths={BACK_ROW}
        fill="url(#skyline-back)"
        panes={{ fill: tint(24) }}
        shade={{ fill: "var(--color-brand-active)", opacity: 0.08 }}
      />
      <Haze top={330} strength={0.7} />

      <Row
        name="middle"
        paths={MIDDLE_ROW}
        fill="url(#skyline-middle)"
        alt="url(#skyline-middle-alt)"
        panes={{ fill: tint(36) }}
        shade={{ fill: "var(--color-brand-active)", opacity: 0.18 }}
      />
      <Haze top={400} strength={0.45} />

      <Row
        name="front"
        paths={FRONT_ROW}
        fill="var(--color-brand-active)"
        alt={`color-mix(in oklab, var(--color-brand-active) 72%, var(--color-brand))`}
        panes={{ fill: tint(58), opacity: 0.45 }}
        shade={{ fill: "var(--color-ink)", opacity: 0.24 }}
        lit={{ fill: tint(8), opacity: 0.9 }}
      >
        <path d={ARCH} style={{ fill: tint(48) }} />
        <path d={ARCH} fill="url(#skyline-arch)" />
      </Row>

      <rect x="0" y={FLOOR - GROUND} width={WIDTH} height={GROUND} style={{ fill: deep(92) }} />
      <Row
        name="trees"
        paths={TREES}
        fill={deep(86)}
        shade={{ fill: "var(--color-ink)", opacity: 0.24 }}
      />
    </svg>
  );
}

type Paint = { fill: string; opacity?: number };

/** One row: its towers in their two tones, their windows, then the shade over
 *  both, so a pane on a shaded face is dimmer too. Lit panes go on last, since
 *  a lit window shows on either face. `children` draws before the shade, as
 *  part of the row. */
function Row({
  name,
  paths,
  fill,
  alt,
  panes,
  shade,
  lit,
  children,
}: {
  name: string;
  paths: RowPaths;
  fill: string;
  alt?: string;
  panes?: Paint;
  shade: Paint;
  lit?: Paint;
  children?: ReactNode;
}) {
  const kinds = panes ? (Object.keys(paths.panes) as Panes[]) : [];
  return (
    <>
      <defs>
        <clipPath id={`skyline-${name}-shape`}>
          <path d={paths.outline} />
        </clipPath>
        {kinds.map((kind) => {
          const { dx, dy, w, h } = PANES[kind];
          return (
            <pattern
              key={kind}
              id={`skyline-${name}-${kind}`}
              patternUnits="userSpaceOnUse"
              width={dx}
              height={dy}
            >
              <rect
                width={w}
                height={h}
                fillOpacity={panes?.opacity}
                style={{ fill: panes?.fill }}
              />
            </pattern>
          );
        })}
      </defs>
      <path d={paths.outline} style={{ fill }} />
      {alt && paths.alt && <path d={paths.alt} style={{ fill: alt }} />}
      {kinds.map((kind) => (
        <path key={kind} d={paths.panes[kind]} fill={`url(#skyline-${name}-${kind})`} />
      ))}
      {children}
      <path
        d={paths.shade}
        clipPath={`url(#skyline-${name}-shape)`}
        fillOpacity={shade.opacity}
        style={{ fill: shade.fill }}
      />
      {lit && paths.lit && (
        <path d={paths.lit} fillOpacity={lit.opacity} style={{ fill: lit.fill }} />
      )}
    </>
  );
}

/** Haze from `top` down to the floor: clear at its top, `strength` at the
 *  floor, over everything drawn before it. */
function Haze({ top, strength }: { top: number; strength: number }) {
  return (
    <rect
      x="0"
      y={top}
      width={WIDTH}
      height={FLOOR - top}
      fill="url(#skyline-haze)"
      opacity={strength}
    />
  );
}

/** White overhead, thinning to the horizon's lavender. */
export const SKYLINE_SKY = `linear-gradient(to bottom, var(--color-panel) 20%, ${HAZE} 88%)`;

/**
 * The auth screens' ground: the sky over the whole window and the skyline
 * along its floor. Fixed, so the card scrolls over it when Create Account's
 * Company fields make the page taller than the window, and behind the card
 * (`-z-10`), so the card's own fill and shadow sit on top of it.
 *
 * The skyline's box is 40% of the window's height, and never shorter than a
 * quarter of its width. Drawn to cover a wide, short box, the towers would
 * grow with the width until their tops were cut; at 4:1 the crop is 80 units
 * of sky, short of the 138 over the tallest tip.
 *
 * `data-skyline` tells <body> to paint white, the sky's top, where a
 * trackpad's bounce opens past the page (globals.css).
 */
export function SkylineBackdrop() {
  return (
    <div
      aria-hidden="true"
      data-skyline
      className="pointer-events-none fixed inset-0 -z-10"
      style={{ background: SKYLINE_SKY }}
    >
      <Skyline className="absolute inset-x-0 bottom-0 h-[max(40%,25vw)] w-full" />
    </div>
  );
}
