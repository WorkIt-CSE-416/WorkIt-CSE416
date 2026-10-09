/**
 * The Activity streak's maths: a year of applications as a grid of days, the
 * numbers under it, and the camera that folds the flat heat map up into the
 * skyline. Pure and import-free — streak.tsx renders its numbers, and
 * streak-canvas.ts draws its grid.
 *
 * Adapted from the Contribution Skyline component on 21st.dev, the part its
 * author kept pure, with contributions read as applications.
 */

export type AppliedDay = { date: string; count: number };
export type Cell = { date: string; count: number; level: number; week: number; day: number };
export type Run = { days: number; start: string | null; end: string | null };
export type StreakStats = {
  total: number;
  first: string | null;
  last: string | null;
  busiest: { count: number; date: string | null };
  longest: Run;
  current: Run;
};
export type RGB = [number, number, number];

export const DAY_MS = 86_400_000;

export const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const easeInOutCubic = (x: number): number => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
export const easeOutCubic = (x: number): number => 1 - Math.pow(1 - clamp01(x), 3);
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** UTC midnight → "YYYY-MM-DD". */
export const toKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** "YYYY-MM-DD" → UTC midnight of that day, read literally so no timezone can
 *  move it. Anything else is NaN, and buildGrid skips it. */
export const dayMs = (key: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
};

/** Busy never counts as less than this many applications; see levelOf. */
const BUSY_FLOOR = 4;

/**
 * 0 for a day with none, else 1–4 by quarters of a busy day: the 95th
 * percentile, so one marathon day can't wash every other day out to level 1.
 * Busy is floored at 4, so at a student's pace each application is a step —
 * 1, 2, 3, then 4 or more. The original's quarters of the raw percentile put a
 * one-application day at level 2 and never used level 1 at all.
 */
export const levelOf = (count: number, busy: number): number =>
  count <= 0 ? 0 : Math.min(4, Math.ceil((count / Math.max(BUSY_FLOOR, busy)) * 4));

/**
 * The grid: columns are weeks, rows are weekdays with Sunday on top. It ends
 * on `endMs` and starts on the week holding the day a year earlier. Repeated
 * dates add up, so the tracker can pass one entry per application.
 */
export const buildGrid = (data: AppliedDay[], endMs: number) => {
  const counts = new Map<string, number>();
  for (const d of data) {
    const ms = dayMs(d.date);
    const c = Number(d.count);
    if (!Number.isFinite(ms) || !(c > 0) || !Number.isFinite(c)) continue;
    const k = toKey(ms);
    counts.set(k, (counts.get(k) ?? 0) + c);
  }
  const yearAgo = endMs - 364 * DAY_MS;
  const start = yearAgo - new Date(yearAgo).getUTCDay() * DAY_MS;
  const days: { date: string; count: number }[] = [];
  for (let ms = start; ms <= endMs; ms += DAY_MS) {
    const date = toKey(ms);
    days.push({ date, count: counts.get(date) ?? 0 });
  }
  const nz = days
    .map((d) => d.count)
    .filter((c) => c > 0)
    .sort((a, b) => a - b);
  const busy = nz.length ? nz[Math.floor(0.95 * (nz.length - 1))] : 0;
  const cells: Cell[] = days.map((d, i) => ({
    ...d,
    level: levelOf(d.count, busy),
    week: Math.floor(i / 7),
    day: i % 7,
  }));
  return {
    cells,
    weeks: cells.length ? cells[cells.length - 1].week + 1 : 0,
    max: nz.length ? nz[nz.length - 1] : 0,
  };
};

/** Total, busiest day, longest run, and the run that reaches today — or
 *  yesterday, since today isn't over and a streak is not broken until it is. */
export const computeStats = (cells: Cell[]): StreakStats => {
  let total = 0;
  let best = 0;
  let bestDate: string | null = null;
  let run = 0;
  let runStart: string | null = null;
  let longest: Run = { days: 0, start: null, end: null };
  for (const c of cells) {
    total += c.count;
    if (c.count > best) {
      best = c.count;
      bestDate = c.date;
    }
    if (c.count > 0) {
      if (run === 0) runStart = c.date;
      run++;
      if (run > longest.days) longest = { days: run, start: runStart, end: c.date };
    } else run = 0;
  }
  let j = cells.length - 1;
  if (j >= 0 && cells[j].count === 0) j--;
  const endAt = j;
  while (j >= 0 && cells[j].count > 0) j--;
  const days = endAt - j;
  const current: Run =
    days > 0
      ? { days, start: cells[j + 1].date, end: cells[endAt].date }
      : { days: 0, start: null, end: null };
  return {
    total,
    first: cells.length ? cells[0].date : null,
    last: cells.length ? cells[cells.length - 1].date : null,
    busiest: { count: best, date: bestDate },
    longest,
    current,
  };
};

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

/** A label on each week whose first day starts a new month; a cramped first
 *  label is dropped. */
export const monthLabels = (cells: Cell[], weeks: number) => {
  const out: { week: number; label: string }[] = [];
  let prev = -1;
  for (let w = 0; w < weeks; w++) {
    const c = cells[w * 7];
    if (!c) break;
    const m = +c.date.slice(5, 7);
    if (m !== prev) out.push({ week: w, label: MONTH.format(dayMs(c.date)) });
    prev = m;
  }
  if (out.length > 1 && out[1].week - out[0].week < 3) out.shift();
  return out;
};

/** Box height in grid units. Empty days are thin slabs; the busiest day is
 *  about 7.6 cells tall. */
export const barHeight = (count: number, max: number): number =>
  count > 0 && max > 0 ? 0.4 + Math.pow(count / max, 0.85) * 7.2 : 0.2;

/** Share of the morph each bar spends waiting — the wave sweeps oldest week → newest. */
export const WAVE = 0.42;

/** 0 → 1 as a bar rises during the morph. Every bar is flat at t=0 and fully up at t=1. */
export const riseAt = (t: number, week: number, weeks: number, day: number): number => {
  const d = (weeks > 1 ? week / (weeks - 1) : 0) * 0.36 + (day / 6) * 0.06;
  return easeOutCubic((t - d) / (1 - WAVE));
};

export const YAW_3D = Math.PI / 4;
export const ELEV_3D = (34 * Math.PI) / 180;
export const YAW_RANGE: [number, number] = [(8 * Math.PI) / 180, (82 * Math.PI) / 180];
export const ELEV_RANGE: [number, number] = [(18 * Math.PI) / 180, (62 * Math.PI) / 180];

export type Cam = { cs: number; sn: number; se: number; ce: number };

/**
 * e=0 looks straight down (yaw 0, elevation 90°): x across, y down, height
 * invisible — a plain heat map. e=1 is the isometric corner view. Orbit
 * offsets only apply in proportion to e, so the flat view never tilts.
 */
export const camera = (e: number, dYaw = 0, dElev = 0): Cam => {
  const yaw = Math.min(YAW_RANGE[1], Math.max(0, lerp(0, YAW_3D + dYaw, e)));
  const elev = lerp(
    Math.PI / 2,
    Math.min(ELEV_RANGE[1], Math.max(ELEV_RANGE[0], ELEV_3D + dElev)),
    e,
  );
  return { cs: Math.cos(yaw), sn: Math.sin(yaw), se: Math.sin(elev), ce: Math.cos(elev) };
};

/** World (x = week, y = weekday, z = up) → screen, before scale/offset. */
export const project = (c: Cam, x: number, y: number, z: number): [number, number] => [
  x * c.cs - y * c.sn,
  (x * c.sn + y * c.cs) * c.se - z * c.ce,
];

/** Painter's depth for yaw in [0°, 90°]: larger is nearer the viewer, so draw ascending. */
export const depthOf = (c: Cam, x: number, y: number): number => x * c.sn + y * c.cs;
