"use client";

import * as React from "react";
import { motion, useTransform, type MotionValue } from "motion/react";

import { AXES } from "./city-model";

/**
 * The sorting line's drawing, on the hero city's isometric axes (`AXES`), so
 * the section reads as part of that city: a raised belt runs up to the right,
 * from the hiring systems' docks, through WorkIt's gate, to the Jobs page
 * cards. A point on it is (u, d, z): `u` along the belt, `d` across it towards
 * the viewer and `z` up, all in px.
 *
 * Two layers, so a parcel rides between the gate's posts: `LineBack` under the
 * parcels and `LineFront` over them. hiring-pipeline.tsx moves the parcels, and
 * their pills over both, or the near post crossed each title.
 */

/** The belt's width, and how far it stands off the ground. */
const BELT = 60;
const RAISED = 36;
const FRAME = 12;
/** The gate's clear height, and the ribs' pitch along the belt. */
const GATE_H = 92;
const RIB = 26;
/** Across the belt: from its middle to a dock's middle. */
const DOCK_D = 62;
const DOCK = 32;
/** Where a dropped parcel leaves the belt, past the gate. */
const PUSH_AFTER = 34;
/** A coin's face at full size, in px (hiring-pipeline.tsx). */
const COIN = 76;
/** The Jobs page cards' column: never narrower, or a title is cut short. */
const CARDS_MIN = 316;

const COLOR = {
  top: "#fdfcff",
  left: "#e9e5f7",
  right: "#dcd6f1",
  edge: "#b9aee4",
  belt: "#cfc7ea",
  rib: "#b7ace0",
  floor: "#e6e1f4",
  holo: "#6d3fd8",
};

/** A block's faces and edges: pale like the city's buildings, or solid violet
 * for the gate, where see-through glass let the belt and posts show through
 * each other. */
const PALE = { top: COLOR.top, left: COLOR.left, right: COLOR.right, edge: COLOR.edge };
const GATE = { top: "#b9a6f4", left: "#9478ea", right: "#7653dd", edge: COLOR.holo };

/** The belt's slope on screen, in degrees, for a flat thing stood beside it:
 * the status sign. */
export const SIGN_SKEW = (-Math.atan2(AXES.y, AXES.x) * 180) / Math.PI;

type Point = { x: number; y: number };

/** Where things sit on the stage, from its size. */
export function lineFor(w: number, h: number, docks: number) {
  const cardsW = Math.max(CARDS_MIN, Math.min(400, w * 0.27));
  const cardsLeft = w - cardsW;
  // Clear of the panel's edge: the first dock stands left of the belt's start.
  const start = { x: 64, y: h - 66 };
  const at = (u: number, d = 0, z = 0): Point => ({
    x: start.x + (u + d) * AXES.x,
    y: start.y + (d - u) * AXES.y - z,
  });
  // The belt ends 48px short of the cards.
  const run = (cardsLeft - 48 - start.x) / AXES.x;
  const pitch = Math.min(90, run * 0.095);
  const gateU = run * 0.72;
  // How far a dropped parcel travels across, down its chute into the bin:
  // shorter on a narrow stage, or the bin ran under the cards.
  const chute = Math.min(96, run * 0.12);
  const dockU = Array.from({ length: docks }, (_, i) => 26 + i * pitch);
  // A coin as wide as its dock's share of the belt.
  const coinScale = (pitch * AXES.x * 0.92) / COIN;
  return {
    w,
    h,
    run,
    gateU,
    pushU: gateU + PUSH_AFTER,
    chute,
    dockU,
    dockD: -DOCK_D,
    coinScale,
    cardsLeft,
    at,
    ring: { x: w * 0.76, y: h * 0.45, r: Math.min(w * 0.2, h * 0.31, 190) },
    /** Where each coin rests: stood on its dock. */
    coins: dockU.map((u) => at(u, -DOCK_D, DOCK_TOP + (COIN * coinScale) / 2)),
    /** The gate's beam, where WorkIt's mark sits. */
    mark: at(gateU, 0, GATE_H + 46),
    /** By the belt, left of the gate: the status sign's top middle. */
    sign: { x: at(gateU).x - 100, y: at(gateU).y + 93 },
    end: at(run),
  };
}
export type Line = ReturnType<typeof lineFor>;

const DOCK_TOP = 8;

const points = (pts: Point[]) =>
  pts.map((p) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`).join(" ");

/** A block on the axes: its top and the two faces towards the viewer, lit as
 * the city's buildings are. */
function Block({
  at,
  u: [u0, u1],
  d: [d0, d1],
  z: [z0, z1],
  tone = PALE,
}: {
  at: Line["at"];
  u: [number, number];
  d: [number, number];
  z: [number, number];
  tone?: typeof PALE;
}) {
  return (
    <g stroke={tone.edge} strokeWidth={1} strokeLinejoin="round">
      <polygon
        fill={tone.left}
        points={points([at(u0, d0, z1), at(u0, d1, z1), at(u0, d1, z0), at(u0, d0, z0)])}
      />
      <polygon
        fill={tone.right}
        points={points([at(u0, d1, z1), at(u1, d1, z1), at(u1, d1, z0), at(u0, d1, z0)])}
      />
      <polygon
        fill={tone.top}
        points={points([at(u0, d0, z1), at(u1, d0, z1), at(u1, d1, z1), at(u0, d1, z1)])}
      />
    </g>
  );
}

/** The ground's grid, fading out at its edges as the hero's does. */
function Ground({ line, id }: { line: Line; id: string }) {
  const { at, run } = line;
  const lines: [Point, Point][] = [];
  const near = 260;
  const far = -240;
  for (let u = -120; u <= run + 120; u += 46) {
    lines.push([at(u, far, -RAISED), at(u, near, -RAISED)]);
  }
  for (let d = far; d <= near; d += 46) {
    lines.push([at(-120, d, -RAISED), at(run + 120, d, -RAISED)]);
  }
  const middle = at(run / 2, 0, -RAISED);
  return (
    <>
      <defs>
        <radialGradient
          id={`${id}-fade`}
          cx={middle.x}
          cy={middle.y}
          r={line.w * 0.56}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0.45" stopColor="white" />
          <stop offset="1" stopColor="black" />
        </radialGradient>
        <mask
          id={`${id}-ground`}
          maskUnits="userSpaceOnUse"
          x="-200"
          y="-200"
          width={line.w + 400}
          height={line.h + 400}
        >
          <rect
            x="-200"
            y="-200"
            width={line.w + 400}
            height={line.h + 400}
            fill={`url(#${id}-fade)`}
          />
        </mask>
      </defs>
      <g mask={`url(#${id}-ground)`} stroke={COLOR.floor} strokeWidth={1}>
        {lines.map(([a, b], i) => (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        ))}
      </g>
    </>
  );
}

/** Under the parcels: the ground, the docks, the belt, the chute, the bin and
 * the gate's far post. The belt's ribs run on the flow's clock. */
export function LineBack({
  line,
  clock,
  speed,
  style,
}: {
  line: Line;
  clock: MotionValue<number>;
  speed: number;
  style?: React.ComponentProps<typeof motion.svg>["style"];
}) {
  const id = `line${React.useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const { at, run, gateU, pushU, dockU, dockD, chute } = line;
  const half = BELT / 2;
  const ribs = useTransform(clock, (t) => {
    const moved = (speed * t) % RIB;
    return `translate(${moved * AXES.x}px, ${-moved * AXES.y}px)`;
  });
  const legs: number[] = [];
  for (let u = 30; u < run; u += 150) legs.push(u);
  const ribLines: number[] = [];
  for (let u = -RIB; u <= run; u += RIB) ribLines.push(u);
  const binNear = half + chute + 34;

  return (
    <motion.svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[5] size-full overflow-visible"
      style={style}
    >
      <Ground line={line} id={id} />

      {/* The docks, one per hiring system, each with a short chute. */}
      {dockU.map((u) => (
        <g key={u}>
          <polygon
            fill={COLOR.belt}
            stroke={COLOR.edge}
            points={points([
              at(u - 12, dockD + DOCK / 2, 4),
              at(u + 12, dockD + DOCK / 2, 4),
              at(u + 12, -half, 0),
              at(u - 12, -half, 0),
            ])}
          />
          <Block
            at={at}
            u={[u - DOCK / 2, u + DOCK / 2]}
            d={[dockD - DOCK / 2, dockD + DOCK / 2]}
            z={[-RAISED, DOCK_TOP]}
          />
        </g>
      ))}

      {/* The gate's far post, behind the belt. */}
      <Block
        at={at}
        u={[gateU - 6, gateU + 6]}
        d={[-half - 14, -half - 4]}
        z={[-RAISED, GATE_H]}
        tone={GATE}
      />

      {legs.map((u) => (
        <Block key={u} at={at} u={[u - 5, u + 5]} d={[half - 12, half - 2]} z={[-RAISED, -FRAME]} />
      ))}

      {/* The belt: its frame, then its top with ribs that run. */}
      <Block at={at} u={[0, run]} d={[-half, half]} z={[-FRAME, 0]} />
      <clipPath id={`${id}-belt`}>
        <polygon points={points([at(0, -half), at(run, -half), at(run, half), at(0, half)])} />
      </clipPath>
      <polygon
        fill={COLOR.belt}
        points={points([at(0, -half + 3), at(run, -half + 3), at(run, half - 3), at(0, half - 3)])}
      />
      <g clipPath={`url(#${id}-belt)`}>
        <motion.g style={{ transform: ribs }} stroke={COLOR.rib} strokeWidth={2}>
          {ribLines.map((u) => {
            const a = at(u, -half + 3);
            const b = at(u, half - 3);
            return <line key={u} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
        </motion.g>
      </g>

      {/* The chute off the belt's near side, and the bin at its foot. */}
      <polygon
        fill={COLOR.left}
        stroke={COLOR.edge}
        points={points([
          at(pushU - 22, half, -2),
          at(pushU + 22, half, -2),
          at(pushU + 22, half + chute, -28),
          at(pushU - 22, half + chute, -28),
        ])}
      />
      <polygon
        fill="#a79bd3"
        stroke={COLOR.edge}
        points={points([
          at(pushU - 34, half + chute - 10, -8),
          at(pushU + 34, half + chute - 10, -8),
          at(pushU + 34, binNear, -8),
          at(pushU - 34, binNear, -8),
        ])}
      />

      {/* The scan: a sheet of light across the belt, in the gate. */}
      <polygon
        className="line-scan"
        fill={COLOR.holo}
        points={points([
          at(gateU, -half - 4, GATE_H),
          at(gateU, half + 4, GATE_H),
          at(gateU, half + 4, 0),
          at(gateU, -half - 4, 0),
        ])}
      />
    </motion.svg>
  );
}

/** Over the parcels: the gate's near post and beam, and the bin's walls. */
export function LineFront({
  line,
  style,
}: {
  line: Line;
  style?: React.ComponentProps<typeof motion.svg>["style"];
}) {
  const { at, gateU, pushU, chute } = line;
  const half = BELT / 2;
  const binNear = half + chute + 34;
  return (
    <motion.svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[14] size-full overflow-visible"
      style={style}
    >
      <Block at={at} u={[pushU - 34, pushU + 34]} d={[binNear, binNear + 4]} z={[-RAISED, -8]} />
      <Block
        at={at}
        u={[pushU - 38, pushU - 34]}
        d={[half + chute - 10, binNear + 4]}
        z={[-RAISED, -8]}
      />
      <Block
        at={at}
        u={[gateU - 6, gateU + 6]}
        d={[half + 4, half + 14]}
        z={[-RAISED, GATE_H]}
        tone={GATE}
      />
      <Block
        at={at}
        u={[gateU - 9, gateU + 9]}
        d={[-half - 17, half + 17]}
        z={[GATE_H, GATE_H + 14]}
        tone={GATE}
      />
    </motion.svg>
  );
}

/** A parcel's faces, on its own axes, in a 56 × 46 box. */
const parcelAt = (u: number, d: number, z: number): Point => ({
  x: 28 + (u + d) * AXES.x,
  y: 32 + (d - u) * AXES.y - z,
});
const PARCEL = 13;
const PARCEL_H = 15;

/**
 * A posting on the belt, as a box. Its lid takes the gate's verdict: violet
 * for a role WorkIt keeps, red for one it drops (`kept`, `dropped`, each 0 to
 * 1).
 */
export function Parcel({
  kept,
  dropped,
}: {
  kept: MotionValue<number>;
  dropped: MotionValue<number>;
}) {
  const a = PARCEL;
  const lid = points([
    parcelAt(-a, -a, PARCEL_H),
    parcelAt(a, -a, PARCEL_H),
    parcelAt(a, a, PARCEL_H),
    parcelAt(-a, a, PARCEL_H),
  ]);
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 56 46"
      className="absolute -top-8 -left-7 h-[46px] w-14 overflow-visible"
    >
      <g stroke={COLOR.edge} strokeWidth={1} strokeLinejoin="round">
        <polygon
          fill={COLOR.left}
          points={points([
            parcelAt(-a, -a, PARCEL_H),
            parcelAt(-a, a, PARCEL_H),
            parcelAt(-a, a, 0),
            parcelAt(-a, -a, 0),
          ])}
        />
        <polygon
          fill={COLOR.right}
          points={points([
            parcelAt(-a, a, PARCEL_H),
            parcelAt(a, a, PARCEL_H),
            parcelAt(a, a, 0),
            parcelAt(-a, a, 0),
          ])}
        />
        <polygon fill={COLOR.top} points={lid} />
      </g>
      <motion.polygon
        fill="var(--color-landing-brand-500)"
        points={lid}
        style={{ opacity: kept }}
      />
      <motion.polygon fill="var(--color-danger)" points={lid} style={{ opacity: dropped }} />
    </svg>
  );
}
