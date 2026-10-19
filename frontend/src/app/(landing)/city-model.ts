/**
 * The hero's city, as SVG path data: a flattened isometric skyline of New
 * York-style towers in a 1600x460 strip. Deterministic (a fixed seed), so
 * every visit draws the same city. Ported from the "Hiring City" design.
 *
 * Six towers take turns turning into a taller violet wireframe that sends up
 * a job tag; two stay wireframe. Heights are capped per column so no
 * building reaches the hero's text at the 1600px design scale.
 */

export type Tone = "base" | "stone" | "glass" | "deep" | "peri";
export type Mode = "" | "msolid" | "mwire" | "swire";

export type Piece = {
  tone: Tone;
  mode: Mode;
  delay: string;
  op: number;
  /** Solid faces: left, right, top. */
  l: string;
  r: string;
  t: string;
  /** Solid lines: floors and mullions, piers, edges, highlight, spires. */
  fl: string;
  pi: string;
  e: string;
  hi: string;
  sp: string;
  /** Wireframe: see-through fill, floor rings, edges. */
  wf: string;
  wl: string;
  we: string;
};

export type JobTag = {
  x: number;
  y: number;
  delay: string;
  title: string;
  company: string;
  score: string;
  tint: string;
  ink: string;
};

export type City = {
  grid: string;
  streaks: string[];
  glows: { x: number; y: number; delay: string }[];
  pieces: Piece[];
  tags: JobTag[];
};

export const STRIP_WIDTH = 1600;
export const STRIP_HEIGHT = 460;

type P3 = [number, number, number];
type P2 = [number, number];

// Ground squashed to 0.3 of an isometric view, so the city reads as a low
// skyline. Plane units to strip px; the ground starts 200px down the strip.
const C = 0.866;
const S = 0.3;
const K = 0.95;
const P = 46;
const OX = 800;
const OY = 200;
const proj = (x: number, y: number, z: number): P2 => [(x - y) * C + OX, (x + y) * S + OY - z * K];
const pj = (p: P3) => proj(p[0], p[1], p[2]);
const f = (n: number) => Math.round(n * 10) / 10;
const pt = (p: P2) => `${f(p[0])} ${f(p[1])}`;
const polys = (list: P2[][]) => list.map((poly) => `M${poly.map(pt).join("L")}Z`).join("");
const lines = (list: P2[][]) => list.map((ln) => `M${ln.map(pt).join("L")}`).join("");

type Prim = {
  tone: Tone;
  mode: Mode;
  delay: string;
  op: number;
  polys: Record<"l" | "r" | "t", P2[][]>;
  lines: Record<"fl" | "pi" | "e" | "h" | "sp", P2[][]>;
  wire: Record<"wf" | "wl" | "we", P2[][]>;
};

export function buildCity(): City {
  let seed = 23;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];

  const pieces: Piece[] = [];
  const glows: City["glows"] = [];
  const tags: JobTag[] = [];
  // Applied to every piece drawn while set.
  let cellOp = 1;
  let curMode: Mode = "";
  let curDelay = "0s";

  const newPrim = (tone: Tone = "base"): Prim => ({
    tone,
    mode: curMode,
    delay: curDelay,
    op: cellOp,
    polys: { l: [], r: [], t: [] },
    lines: { fl: [], pi: [], e: [], h: [], sp: [] },
    wire: { wf: [], wl: [], we: [] },
  });
  const Q = (pr: Prim, cls: "l" | "r" | "t", pts: P3[]) => pr.polys[cls].push(pts.map(pj));
  const L = (pr: Prim, cls: "fl" | "pi" | "e" | "h" | "sp", pts: P3[]) =>
    pr.lines[cls].push(pts.map(pj));
  const W = (pr: Prim, cls: "wf" | "wl" | "we", pts: P3[]) => pr.wire[cls].push(pts.map(pj));
  const emit = (pr: Prim) => {
    pieces.push({
      tone: pr.tone,
      mode: pr.mode,
      delay: pr.delay,
      op: pr.op,
      l: polys(pr.polys.l),
      r: polys(pr.polys.r),
      t: polys(pr.polys.t),
      fl: lines(pr.lines.fl),
      pi: lines(pr.lines.pi),
      e: lines(pr.lines.e),
      hi: lines(pr.lines.h),
      sp: lines(pr.lines.sp),
      wf: polys(pr.wire.wf),
      wl: lines(pr.wire.wl),
      we: lines(pr.wire.we),
    });
  };

  // Window patterns on a vertical face: origin a, direction dir along it,
  // width U and height V.
  const facade = (pr: Prim, a: P3, dir: P2, U: number, V: number, pattern: string) => {
    const at = (u: number, v: number): P3 => [a[0] + dir[0] * u, a[1] + dir[1] * u, a[2] + v];
    const hz = (step: number, cls: "fl" | "pi") => {
      for (let v = step; v < V - 1; v += step) L(pr, cls, [at(0, v), at(U, v)]);
    };
    const vt = (step: number, cls: "fl" | "pi") => {
      for (let u = step; u < U - 0.8; u += step) L(pr, cls, [at(u, 0), at(u, V)]);
    };
    const clip = (cands: P2[]) => {
      const uniq: P2[] = [];
      cands
        .filter(([u, v]) => u >= -0.01 && u <= U + 0.01 && v >= -0.01 && v <= V + 0.01)
        .forEach((q) => {
          if (!uniq.some((r) => Math.abs(r[0] - q[0]) < 0.1 && Math.abs(r[1] - q[1]) < 0.1))
            uniq.push(q);
        });
      return uniq.length >= 2 ? uniq : null;
    };
    const diag = (step: number) => {
      for (let c = -V; c <= U + V; c += step) {
        const a1 = clip([
          [0, -c],
          [U, U - c],
          [c, 0],
          [c + V, V],
        ]);
        if (a1) L(pr, "pi", [at(a1[0][0], a1[0][1]), at(a1[1][0], a1[1][1])]);
        const a2 = clip([
          [0, c],
          [U, c - U],
          [c, 0],
          [c - V, V],
        ]);
        if (a2) L(pr, "pi", [at(a2[0][0], a2[0][1]), at(a2[1][0], a2[1][1])]);
      }
    };
    if (pattern === "grid") {
      hz(7, "fl");
      vt(6, "fl");
    } else if (pattern === "square") {
      hz(5, "fl");
      vt(4.6, "fl");
    } else if (pattern === "glass") {
      hz(6, "fl");
      vt(3.4, "fl");
    } else if (pattern === "piers") {
      hz(9, "fl");
      vt(4.2, "pi");
    } else if (pattern === "diagrid") {
      hz(12, "fl");
      diag(11);
    }
  };

  const prism = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    z0: number,
    z1: number,
    tone: Tone,
    pattern: string,
  ) => {
    const pr = newPrim(tone);
    Q(pr, "l", [
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x0, y1, z1],
    ]);
    Q(pr, "r", [
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x1, y0, z1],
    ]);
    Q(pr, "t", [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ]);
    if (pattern) {
      facade(pr, [x0, y1, z0], [1, 0], x1 - x0, z1 - z0, pattern);
      facade(pr, [x1, y1, z0], [0, -1], y1 - y0, z1 - z0, pattern);
    }
    L(pr, "e", [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
      [x0, y0, z1],
    ]);
    L(pr, "e", [
      [x0, y1, z0],
      [x0, y1, z1],
    ]);
    L(pr, "e", [
      [x1, y1, z0],
      [x1, y1, z1],
    ]);
    L(pr, "e", [
      [x1, y0, z0],
      [x1, y0, z1],
    ]);
    L(pr, "e", [
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y0, z0],
    ]);
    L(pr, "h", [
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y0, z1],
    ]);
    emit(pr);
  };

  // Walls leaning in by t at the top: obelisks, crowns and, with t at half
  // the width, a pyramid roof.
  const frustum = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    z0: number,
    z1: number,
    t: number,
    tone: Tone,
    step: number,
  ) => {
    const pr = newPrim(tone);
    const X0 = x0 + t;
    const Y0 = y0 + t;
    const X1 = x1 - t;
    const Y1 = y1 - t;
    Q(pr, "l", [
      [x0, y1, z0],
      [x1, y1, z0],
      [X1, Y1, z1],
      [X0, Y1, z1],
    ]);
    Q(pr, "r", [
      [x1, y1, z0],
      [x1, y0, z0],
      [X1, Y0, z1],
      [X1, Y1, z1],
    ]);
    if (X1 - X0 > 0.5)
      Q(pr, "t", [
        [X0, Y0, z1],
        [X1, Y0, z1],
        [X1, Y1, z1],
        [X0, Y1, z1],
      ]);
    if (step) {
      const H = z1 - z0;
      for (let z = z0 + step; z < z1 - 1; z += step) {
        const k = (z - z0) / H;
        L(pr, "fl", [
          [x0 + t * k, y1 - t * k, z],
          [x1 - t * k, y1 - t * k, z],
          [x1 - t * k, y0 + t * k, z],
        ]);
      }
      const n = Math.max(2, Math.round((x1 - x0) / 3.6));
      for (let q = 1; q < n; q += 1) {
        const u = q / n;
        L(pr, "fl", [
          [x0 + (x1 - x0) * u, y1, z0],
          [X0 + (X1 - X0) * u, Y1, z1],
        ]);
        L(pr, "fl", [
          [x1, y1 - (y1 - y0) * u, z0],
          [X1, Y1 - (Y1 - Y0) * u, z1],
        ]);
      }
    }
    if (X1 - X0 > 0.5)
      L(pr, "e", [
        [X0, Y0, z1],
        [X1, Y0, z1],
        [X1, Y1, z1],
        [X0, Y1, z1],
        [X0, Y0, z1],
      ]);
    L(pr, "e", [
      [x0, y1, z0],
      [X0, Y1, z1],
    ]);
    L(pr, "e", [
      [x1, y1, z0],
      [X1, Y1, z1],
    ]);
    L(pr, "e", [
      [x1, y0, z0],
      [X1, Y0, z1],
    ]);
    L(pr, "e", [
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y0, z0],
    ]);
    L(pr, "h", [
      [X0, Y1, z1],
      [X1, Y1, z1],
      [X1, Y0, z1],
    ]);
    emit(pr);
  };
  const pyramid = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    z0: number,
    z1: number,
    tone: Tone,
  ) => frustum(x0, y0, x1, y1, z0, z1, (x1 - x0) / 2, tone, 0);

  const pc = (cx: number, cy: number, r: number, deg: number, z: number): P3 => [
    cx + r * Math.cos((deg * Math.PI) / 180),
    cy + r * Math.sin((deg * Math.PI) / 180),
    z,
  ];
  const arc = (cx: number, cy: number, r: number, z: number, a0: number, a1: number, n: number) => {
    const pts: P3[] = [];
    for (let q = 0; q <= n; q += 1) pts.push(pc(cx, cy, r, a0 + ((a1 - a0) * q) / n, z));
    return pts;
  };
  // The near half of a cylinder faces the viewer: -45..45 degrees is the
  // right side, 45..135 the left.
  const cylinder = (
    cx: number,
    cy: number,
    r: number,
    z0: number,
    z1: number,
    tone: Tone,
    rings: number,
    ribs: boolean,
  ) => {
    const pr = newPrim(tone);
    Q(pr, "r", [...arc(cx, cy, r, z0, -45, 45, 6), ...arc(cx, cy, r, z1, 45, -45, 6)]);
    Q(pr, "l", [...arc(cx, cy, r, z0, 45, 135, 6), ...arc(cx, cy, r, z1, 135, 45, 6)]);
    Q(pr, "t", arc(cx, cy, r, z1, 0, 360, 20));
    if (rings)
      for (let z = z0 + rings; z < z1 - 1; z += rings) L(pr, "fl", arc(cx, cy, r, z, -45, 135, 12));
    if (ribs)
      [-30, -10, 10, 30, 50, 70, 90, 110].forEach((deg) =>
        L(pr, "fl", [pc(cx, cy, r, deg, z0), pc(cx, cy, r, deg, z1)]),
      );
    L(pr, "e", arc(cx, cy, r, z1, 0, 360, 20));
    L(pr, "e", arc(cx, cy, r, z0, -45, 135, 12));
    L(pr, "e", [pc(cx, cy, r, -45, z0), pc(cx, cy, r, -45, z1)]);
    L(pr, "e", [pc(cx, cy, r, 135, z0), pc(cx, cy, r, 135, z1)]);
    L(pr, "h", arc(cx, cy, r, z1, -45, 135, 12));
    emit(pr);
  };
  const strokes = (list: P3[][]) => {
    const pr = newPrim("base");
    list.forEach((pts) => L(pr, "sp", pts));
    emit(pr);
  };

  type Cell = { x0: number; y0: number; x1: number; y1: number };
  const mid = (c: Cell): [number, number] => [(c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2];

  // Building types. c is the cell's footprint, H the height it may reach.
  const kinds = {
    podium(c: Cell, H: number) {
      const base = Math.min(H, 10);
      prism(c.x0, c.y0, c.x1, c.y1, 0, base, "stone", "grid");
      if (H > base + 4) prism(c.x0 + 5, c.y0 + 5, c.x1 - 5, c.y1 - 5, base, H, "glass", "glass");
    },
    pavilion(c: Cell, H: number) {
      prism(c.x0 + 3, c.y0 + 3, c.x1 - 3, c.y1 - 3, 0, Math.min(H, 18), "glass", "glass");
    },
    plaza(c: Cell) {
      prism(c.x0, c.y0, c.x1, c.y1, 0, 1.5, "stone", "");
      const [cx, cy] = mid(c);
      cylinder(cx, cy, 6, 1.5, 3.5, "glass", 0, false);
    },
    slab(c: Cell, H: number) {
      prism(c.x0, c.y0, c.x1, c.y1, 0, 8, "stone", "grid");
      prism(c.x0 + 2, c.y0 + 10, c.x1 - 2, c.y0 + 22, 8, H, "glass", "glass");
    },
    setback(c: Cell, H: number) {
      const tone = pick(["stone", "peri", "base"] as const);
      prism(c.x0, c.y0, c.x1, c.y1, 0, Math.round(H * 0.45), tone, "piers");
      prism(
        c.x0 + 4,
        c.y0 + 4,
        c.x1 - 4,
        c.y1 - 4,
        Math.round(H * 0.45),
        Math.round(H * 0.75),
        tone,
        "piers",
      );
      prism(c.x0 + 8, c.y0 + 8, c.x1 - 8, c.y1 - 8, Math.round(H * 0.75), H, tone, "piers");
    },
    empire(c: Cell, H: number) {
      const [cx, cy] = mid(c);
      prism(c.x0, c.y0, c.x1, c.y1, 0, Math.round(H * 0.16), "stone", "grid");
      prism(
        c.x0 + 3,
        c.y0 + 3,
        c.x1 - 3,
        c.y1 - 3,
        Math.round(H * 0.16),
        Math.round(H * 0.6),
        "stone",
        "piers",
      );
      prism(
        c.x0 + 7,
        c.y0 + 7,
        c.x1 - 7,
        c.y1 - 7,
        Math.round(H * 0.6),
        Math.round(H * 0.74),
        "stone",
        "piers",
      );
      prism(
        c.x0 + 11,
        c.y0 + 11,
        c.x1 - 11,
        c.y1 - 11,
        Math.round(H * 0.74),
        Math.round(H * 0.82),
        "stone",
        "piers",
      );
      cylinder(cx, cy, 3.5, Math.round(H * 0.82), Math.round(H * 0.88), "stone", 0, false);
      strokes([
        [
          [cx, cy, Math.round(H * 0.88)],
          [cx, cy, H * 1.04],
        ],
      ]);
    },
    chrysler(c: Cell, H: number) {
      prism(c.x0, c.y0, c.x1, c.y1, 0, Math.round(H * 0.22), "stone", "grid");
      prism(
        c.x0 + 5,
        c.y0 + 5,
        c.x1 - 5,
        c.y1 - 5,
        Math.round(H * 0.22),
        Math.round(H * 0.7),
        "stone",
        "piers",
      );
      frustum(
        c.x0 + 5,
        c.y0 + 5,
        c.x1 - 5,
        c.y1 - 5,
        Math.round(H * 0.7),
        Math.round(H * 0.78),
        2,
        "deep",
        0,
      );
      frustum(
        c.x0 + 7,
        c.y0 + 7,
        c.x1 - 7,
        c.y1 - 7,
        Math.round(H * 0.78),
        Math.round(H * 0.85),
        2,
        "deep",
        0,
      );
      frustum(
        c.x0 + 9,
        c.y0 + 9,
        c.x1 - 9,
        c.y1 - 9,
        Math.round(H * 0.85),
        Math.round(H * 0.91),
        2.5,
        "deep",
        0,
      );
      pyramid(c.x0 + 14, c.y0 + 14, c.x1 - 14, c.y1 - 14, Math.round(H * 0.91), H * 1.1, "deep");
    },
    obelisk(c: Cell, H: number) {
      const [cx, cy] = mid(c);
      prism(c.x0, c.y0, c.x1, c.y1, 0, 6, "stone", "grid");
      frustum(c.x0 + 2, c.y0 + 2, c.x1 - 2, c.y1 - 2, 6, H, 7, "glass", 6);
      strokes([
        [
          [cx, cy, H],
          [cx, cy, H * 1.22],
        ],
      ]);
    },
    pencil(c: Cell, H: number) {
      const m = (c.x1 - c.x0 - 14) / 2;
      prism(c.x0 + m, c.y0 + m, c.x1 - m, c.y1 - m, 0, H, "base", "square");
      prism(c.x0 + m - 0.8, c.y0 + m - 0.8, c.x1 - m + 0.8, c.y1 - m + 0.8, H, H + 2, "stone", "");
    },
    round(c: Cell, H: number) {
      const [cx, cy] = mid(c);
      cylinder(cx, cy, 15, 0, H, "glass", 6, true);
      cylinder(cx, cy, 10, H, H + 5, "glass", 0, false);
    },
    pyramidTop(c: Cell, H: number) {
      const [cx, cy] = mid(c);
      prism(c.x0 + 1, c.y0 + 1, c.x1 - 1, c.y1 - 1, 0, Math.round(H * 0.8), "peri", "grid");
      pyramid(c.x0 + 1, c.y0 + 1, c.x1 - 1, c.y1 - 1, Math.round(H * 0.8), H, "deep");
      strokes([
        [
          [cx, cy, H],
          [cx, cy, H + 12],
        ],
      ]);
    },
    diagrid(c: Cell, H: number) {
      prism(c.x0, c.y0, c.x1, c.y1, 0, Math.round(H * 0.14), "stone", "grid");
      prism(c.x0 + 3, c.y0 + 3, c.x1 - 3, c.y1 - 3, Math.round(H * 0.14), H, "glass", "diagrid");
    },
    jenga(c: Cell, H: number) {
      const n = 5;
      for (let q = 0; q < n; q += 1) {
        const sz = 22 + Math.round(rand() * 8);
        const ox = Math.round(rand() * (c.x1 - c.x0 - sz));
        const oy = Math.round(rand() * (c.y1 - c.y0 - sz));
        prism(
          c.x0 + ox,
          c.y0 + oy,
          c.x0 + ox + sz,
          c.y0 + oy + sz,
          Math.round((H * q) / n),
          Math.round((H * (q + 1)) / n),
          q % 2 ? "glass" : "base",
          "glass",
        );
      }
    },
  };
  type Kind = keyof typeof kinds;
  const TALL: Kind[] = [
    "empire",
    "chrysler",
    "obelisk",
    "pencil",
    "round",
    "pyramidTop",
    "diagrid",
    "setback",
    "jenga",
    "slab",
  ];
  const MID: Kind[] = [
    "obelisk",
    "pencil",
    "round",
    "pyramidTop",
    "diagrid",
    "setback",
    "jenga",
    "slab",
  ];
  const LOW: Kind[] = ["podium", "podium", "pavilion", "plaza"];
  // How far each type reaches above its height H: H * mul + add.
  const REACH: Partial<Record<Kind, [number, number]>> = {
    empire: [1.04, 0],
    chrysler: [1.1, 0],
    obelisk: [1.22, 0],
    pyramidTop: [1, 12],
    round: [1, 5],
    pencil: [1, 2],
  };

  // The text above the city as a ceiling per column, in hero-panel px at the
  // design scale (a 720px panel whose strip starts at y 260): a building's
  // top stays below it.
  const ceiling = (d: number) => {
    const a = Math.abs(d);
    if (a <= 5) return 500; // behind the buttons, which span about ±194px
    if (a <= 9) return 425; // under the subtitle
    if (a <= 11) return 318; // under the headline's ends
    return 120; // clear of the text
  };
  const maxHeight = (d: number, s: number) =>
    Math.max(6, Math.floor((260 + OY + (s + 1) * P * S - ceiling(d)) / K));

  // Towers that rise as a taller wireframe and send up a job, and two that
  // stay wireframe. Keyed by "d,s": column across, row deep. Placed so each
  // tag clears the panel's sides and the text.
  const special: Record<
    string,
    {
      rise: number;
      shape: "box" | "round" | "taper";
      delay: string;
      job?: Omit<JobTag, "x" | "y" | "delay">;
    }
  > = {
    "-13,5": {
      rise: 190,
      shape: "box",
      delay: "0s",
      job: {
        title: "Frontend Intern",
        company: "Nimbus Cloud",
        score: "92%",
        tint: "#e3ebff",
        ink: "#2f5fd6",
      },
    },
    "13,7": {
      rise: 200,
      shape: "round",
      delay: "-2.7s",
      job: {
        title: "Backend Engineer",
        company: "Tempo",
        score: "91%",
        tint: "#fce9eb",
        ink: "#a01f81",
      },
    },
    "-12,10": {
      rise: 180,
      shape: "taper",
      delay: "-5.4s",
      job: {
        title: "Data Analyst",
        company: "Orbit Analytics",
        score: "88%",
        tint: "#efeaff",
        ink: "#5b30c0",
      },
    },
    "12,12": {
      rise: 190,
      shape: "box",
      delay: "-8.1s",
      job: {
        title: "Full-Stack Engineer",
        company: "DataForge",
        score: "89%",
        tint: "#e3f7f0",
        ink: "#107a52",
      },
    },
    "-11,15": {
      rise: 170,
      shape: "taper",
      delay: "-10.8s",
      job: {
        title: "Product Designer",
        company: "Learnly",
        score: "85%",
        tint: "#fdf0d9",
        ink: "#8a5a00",
      },
    },
    "11,13": {
      rise: 160,
      shape: "round",
      delay: "-13.5s",
      job: {
        title: "UI Developer",
        company: "FinTech Corp",
        score: "90%",
        tint: "#fce9eb",
        ink: "#a01f81",
      },
    },
    "-15,5": { rise: 215, shape: "box", delay: "0s" },
    "15,3": { rise: 200, shape: "round", delay: "-3s" },
  };

  // A see-through wireframe tower, every edge drawn. Returns its tip.
  const wireTower = (c: Cell, shape: "box" | "round" | "taper", z1: number) => {
    const pr = newPrim("glass");
    const [cx, cy] = mid(c);
    if (shape === "round") {
      const r = 15;
      W(pr, "wf", [...arc(cx, cy, r, 0, -45, 135, 12), ...arc(cx, cy, r, z1, 135, -45, 12)]);
      W(pr, "wf", arc(cx, cy, r, z1, 0, 360, 24));
      W(pr, "we", arc(cx, cy, r, 0, 0, 360, 24));
      W(pr, "we", arc(cx, cy, r, z1, 0, 360, 24));
      [-45, 0, 45, 90, 135, 180, 225, 270].forEach((deg) =>
        W(pr, "we", [pc(cx, cy, r, deg, 0), pc(cx, cy, r, deg, z1)]),
      );
      for (let z = 10; z < z1 - 2; z += 10) W(pr, "wl", arc(cx, cy, r, z, 0, 360, 24));
    } else {
      const t = shape === "taper" ? 8 : 0;
      const { x0, y0, x1, y1 } = c;
      const X0 = x0 + t;
      const Y0 = y0 + t;
      const X1 = x1 - t;
      const Y1 = y1 - t;
      W(pr, "wf", [
        [x0, y1, 0],
        [x1, y1, 0],
        [X1, Y1, z1],
        [X0, Y1, z1],
      ]);
      W(pr, "wf", [
        [x1, y1, 0],
        [x1, y0, 0],
        [X1, Y0, z1],
        [X1, Y1, z1],
      ]);
      W(pr, "wf", [
        [X0, Y0, z1],
        [X1, Y0, z1],
        [X1, Y1, z1],
        [X0, Y1, z1],
      ]);
      W(pr, "we", [
        [x0, y0, 0],
        [x1, y0, 0],
        [x1, y1, 0],
        [x0, y1, 0],
        [x0, y0, 0],
      ]);
      W(pr, "we", [
        [X0, Y0, z1],
        [X1, Y0, z1],
        [X1, Y1, z1],
        [X0, Y1, z1],
        [X0, Y0, z1],
      ]);
      (
        [
          [x0, y0, X0, Y0],
          [x1, y0, X1, Y0],
          [x1, y1, X1, Y1],
          [x0, y1, X0, Y1],
        ] as const
      ).forEach(([a, b, cc, d]) =>
        W(pr, "we", [
          [a, b, 0],
          [cc, d, z1],
        ]),
      );
      for (let z = 10; z < z1 - 2; z += 10) {
        const k = z / z1;
        W(pr, "wl", [
          [x0 + t * k, y0 + t * k, z],
          [x1 - t * k, y0 + t * k, z],
          [x1 - t * k, y1 - t * k, z],
          [x0 + t * k, y1 - t * k, z],
          [x0 + t * k, y0 + t * k, z],
        ]);
      }
    }
    W(pr, "we", [
      [cx, cy, z1],
      [cx, cy, z1 + 22],
    ]);
    emit(pr);
    return proj(cx, cy, z1 + 22);
  };

  const IN = 6;
  // Rows past 17 sit below the panel, and column 18 under the side fade.
  // Back rows first, so nearer buildings paint over farther ones.
  for (let s = 0; s <= 17; s += 1) {
    let last: Kind | "" = "";
    for (let d = -17; d <= 17; d += 1) {
      if ((s + d) % 2 !== 0) continue;
      const i = (s + d) / 2;
      const j = (s - d) / 2;
      const c: Cell = {
        x0: i * P + IN,
        y0: j * P + IN,
        x1: (i + 1) * P - IN,
        y1: (j + 1) * P - IN,
      };
      const cap = maxHeight(d, s);
      // Distance haze on the back rows.
      cellOp = Math.round((0.55 + 0.45 * Math.min(1, s / 10)) * 100) / 100;
      const sp = special[`${d},${s}`];
      if (sp) {
        cellOp = 1;
        const top = Math.min(sp.rise, cap - 30);
        if (!sp.job) {
          prism(c.x0 - 2, c.y0 - 2, c.x1 + 2, c.y1 + 2, 0, 3, "stone", "");
          curMode = "swire";
          curDelay = sp.delay;
          wireTower(c, sp.shape, top);
        } else {
          const base = proj(...mid(c), 0);
          glows.push({ x: f(base[0]), y: f(base[1]), delay: sp.delay });
          curMode = "msolid";
          curDelay = sp.delay;
          kinds.setback(c, 56);
          curMode = "mwire";
          const tip = wireTower(c, sp.shape, top);
          tags.push({ x: f(tip[0]), y: f(tip[1] - 2), delay: sp.delay, ...sp.job });
        }
        curMode = "";
        curDelay = "0s";
        continue;
      }
      // Under the buttons the cap leaves no room: leave the ground bare.
      if (cap < 10) continue;
      // Tall toward the edges, dipping in the middle, never into the text.
      const e = Math.abs(d) / 18;
      let want = 40 + rand() * 50 + Math.pow(e, 1.2) * (70 + rand() * 160);
      if (s < 6) want *= 1.15;
      const H = Math.min(Math.round(want), cap);
      // Towers wherever the height allows, landmarks where it is tallest.
      const pool = H >= 120 ? TALL : H >= 50 ? MID : LOW;
      let kind = pick(pool);
      if (kind === last) kind = pick(pool);
      last = kind;
      if ((kind === "empire" || kind === "chrysler") && H < 100) kind = "setback";
      // The cap covers the spire, mast or antenna too, not just the roof.
      const [mul, add] = REACH[kind] ?? [1, 0];
      kinds[kind](c, Math.max(6, Math.min(H, Math.floor((cap - add) / mul))));
    }
  }

  // The ground grid, and four lines a streak of light runs along.
  const gseg = (a: [number, number], b: [number, number]) => {
    const p1 = proj(a[0], a[1], 0);
    const p2 = proj(b[0], b[1], 0);
    return `M${pt(p1)}L${pt(p2)}`;
  };
  let grid = "";
  for (let s = 0; s <= 18; s += 1) {
    for (let d = -18; d <= 18; d += 1) {
      if ((s + d) % 2 !== 0) continue;
      const i = (s + d) / 2;
      const j = (s - d) / 2;
      grid +=
        gseg([i * P, j * P], [(i + 1) * P, j * P]) + gseg([i * P, j * P], [i * P, (j + 1) * P]);
    }
  }
  const alongJ = (j: number) =>
    gseg([Math.max(-j, j - 18) * P, j * P], [(Math.min(18 - j, j + 18) + 1) * P, j * P]);
  const alongI = (i: number) =>
    gseg([i * P, Math.max(-i, i - 18) * P], [i * P, (Math.min(18 - i, i + 18) + 1) * P]);

  return { grid, streaks: [alongJ(3), alongI(6), alongJ(8), alongI(11)], glows, pieces, tags };
}
