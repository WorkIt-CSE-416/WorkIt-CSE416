"use client";

import { Box, Grid3x3 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { cn } from "@/lib/cn";

import { MORPH_MS, mountSkyline, type Skyline, type SkylineState } from "./streak-canvas";
import {
  buildGrid,
  computeStats,
  dayMs,
  monthLabels,
  type AppliedDay,
  type Cell,
} from "./streak-model";

/**
 * Activity — the seeker's year of applications as a streak heat map that folds
 * up into a 3D skyline and back, in the Dashboard's 3fr column beside Up Next.
 * It replaced a weekly pace chart there and kept its heading (page.tsx says
 * why).
 *
 * Open on the page under its heading, like every Dashboard section but the
 * hero: no card, no frame. The view switch sits where a section's one way
 * onward does, at the top right, in the applications ViewSwitcher's segmented
 * style. Buttons rather than links, because the morph between the views is
 * the point and a navigation would cut it.
 *
 * Hover or tap a day for its count, arrow keys walk the grid, and in 3D a drag
 * orbits (double-click resets). There is no legend or hint row under the
 * stats: the tooltip gives any day's exact count, and darker reads as more
 * without a key. The canvas is ./streak-canvas.ts; the numbers come from
 * ./streak-model.ts. The numbers are ink, never a level's violet: colour
 * belongs to the marks.
 *
 * TODAY IS THE VIEWER'S. The current streak runs to today, or to yesterday
 * while today is still open, and which day that is depends on where the reader
 * is. The server renders UTC's today, the reader's own for most of the day,
 * and the browser swaps in its own after hydration — useSyncExternalStore
 * keeps that from being a mismatch, as PostedDate does in
 * company/jobs/jobs-table.tsx.
 *
 * Adapted from the Contribution Skyline component on 21st.dev.
 */

type View = "2d" | "3d";

const VIEWS: { view: View; label: string; Icon: typeof Box }[] = [
  { view: "2d", label: "Flat heat map", Icon: Grid3x3 },
  { view: "3d", label: "3D skyline", Icon: Box },
];

/** From this width the skyline's numbers float in its corners instead of
 *  sitting in a row under it: only in the one-column layout, since the 3fr
 *  column tops out near 530px. */
const CORNERS_MIN = 560;
const EASE = "cubic-bezier(0.65, 0, 0.35, 1)";

const NUMBER = new Intl.NumberFormat("en-US");
const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const DAY_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const DAY_LONG = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const applications = (n: number) => (n === 1 ? "application" : "applications");
const daysWord = (n: number) => (n === 1 ? "day" : "days");
const counted = (n: number) => (n ? `${NUMBER.format(n)} ${applications(n)}` : "No applications");

/** "Aug 18 – Aug 26", or the one date when a run is a day long. */
const span = (a: string | null, b: string | null, withYear = false) => {
  if (!a || !b) return "—";
  const f = withYear ? DAY_YEAR : DAY;
  return a === b ? f.format(dayMs(a)) : `${f.format(dayMs(a))} – ${f.format(dayMs(b))}`;
};

const describe = (cell: Cell | undefined) =>
  cell ? `${counted(cell.count)} on ${DAY_LONG.format(dayMs(cell.date))}` : "";

const noSubscription = () => () => {};
const pad = (n: number) => String(n).padStart(2, "0");
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const utcToday = () => new Date().toISOString().slice(0, 10);

const cornerStyle = (shown: boolean, offset: number, delay: number) => ({
  opacity: shown ? 1 : 0,
  transform: shown ? "translateY(0)" : `translateY(${offset}px)`,
  transitionDuration: shown ? "600ms" : "300ms",
  transitionDelay: shown ? `${Math.round(MORPH_MS * delay)}ms` : "0ms",
  transitionTimingFunction: EASE,
});

export function Streak({ days }: { days: AppliedDay[] }) {
  const today = useSyncExternalStore(noSubscription, localToday, utcToday);
  const model = useMemo(() => {
    const grid = buildGrid(days, dayMs(today));
    return {
      ...grid,
      stats: computeStats(grid.cells),
      months: monthLabels(grid.cells, grid.weeks),
    };
  }, [days, today]);

  const [view, setView] = useState<View>("3d");
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(-1);
  const [announcement, setAnnouncement] = useState("");

  const rootRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const skyline = useRef<Skyline | null>(null);

  // What the drawing loop reads, refreshed after every render. Declared ahead
  // of the effects below, so it is current by the time they kick the loop.
  const snapshot: SkylineState = {
    model,
    target: view === "3d" ? 1 : 0,
    setActive,
    setWidth,
    announce: (i) => setAnnouncement(describe(model.cells[i])),
  };
  const live = useRef(snapshot);
  useEffect(() => {
    live.current = snapshot;
  });

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const tip = tipRef.current;
    if (!root || !stage || !canvas || !tip) return;
    const engine = mountSkyline({ root, stage, canvas, tip }, live);
    skyline.current = engine;
    return () => {
      engine?.destroy();
      skyline.current = null;
    };
  }, []);

  useEffect(() => {
    skyline.current?.kick();
  }, [view]);

  useEffect(() => {
    skyline.current?.load();
  }, [model]);

  // The tooltip is kept inside the section by its width; measure it when its text changes.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (tip && active >= 0) skyline.current?.tipWidth(tip.offsetWidth);
  }, [active, model]);

  const { stats } = model;
  const is3d = view === "3d";
  const corners = width >= CORNERS_MIN;
  const showRow = !(is3d && corners);
  const bigSize = Math.round(Math.max(30, Math.min(56, width * 0.058)));
  const cell = active >= 0 ? model.cells[active] : undefined;
  const blocks: StatBlock[] = [
    {
      label: "Past Year",
      value: NUMBER.format(stats.total),
      unit: applications(stats.total),
      sub: span(stats.first, stats.last, true),
    },
    {
      label: "Busiest Day",
      value: NUMBER.format(stats.busiest.count),
      unit: applications(stats.busiest.count),
      sub: stats.busiest.date ? DAY.format(dayMs(stats.busiest.date)) : "—",
    },
    {
      label: "Longest Streak",
      value: NUMBER.format(stats.longest.days),
      unit: daysWord(stats.longest.days),
      sub: span(stats.longest.start, stats.longest.end),
    },
    {
      label: "Current Streak",
      value: NUMBER.format(stats.current.days),
      unit: daysWord(stats.current.days),
      sub: stats.current.days
        ? span(stats.current.start, stats.current.end)
        : "Apply today to start one",
    },
  ];

  return (
    <section ref={rootRef} aria-labelledby="streak" className="@container/streak">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="streak" className="text-title text-ink">
          Activity
        </h2>
        <div
          role="group"
          aria-label="Chart View"
          className="bg-well border-border-subtle rounded-control flex shrink-0 items-center gap-0.5 border p-0.5"
        >
          {VIEWS.map(({ view: option, label, Icon }) => (
            <Tooltip key={option}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={label}
                    aria-pressed={view === option}
                    onClick={() => setView(option)}
                    className={cn(
                      "focus-visible:ring-brand-ring flex size-6.5 items-center justify-center rounded-[0.375rem] focus-visible:ring-2 focus-visible:outline-none",
                      view === option
                        ? "bg-panel text-ink ring-border shadow-panel ring-1"
                        : "text-ink-meta hover:text-ink hover:bg-panel/60",
                    )}
                  />
                }
              >
                <Icon aria-hidden="true" className="size-4" />
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>

      <div className="relative mt-4">
        <div
          ref={stageRef}
          className="outline-brand-ring relative w-full overflow-hidden rounded-md outline-offset-4 has-[:focus-visible]:outline-2"
          style={{ height: 150 }}
        >
          <canvas
            ref={canvasRef}
            tabIndex={0}
            role="img"
            aria-label={`${counted(stats.total)} between ${span(stats.first, stats.last, true)}, shown as a ${is3d ? "3D skyline" : "heat map"}. Use the arrow keys to read individual days.`}
            className="absolute top-0 left-0 block max-w-none outline-none"
            style={{ touchAction: is3d ? "pan-y" : "auto" }}
          />

          {corners && (
            <>
              <div
                aria-hidden={!is3d}
                className="pointer-events-none absolute top-1 right-1 flex flex-col items-end gap-5 transition-[opacity,transform] motion-reduce:transition-none"
                style={cornerStyle(is3d, -10, 0.55)}
              >
                <Stat {...blocks[0]} size={bigSize} align="end" />
                <Stat {...blocks[1]} size={bigSize} align="end" />
              </div>
              <div
                aria-hidden={!is3d}
                className="pointer-events-none absolute bottom-1 left-1 flex flex-col items-start gap-5 transition-[opacity,transform] motion-reduce:transition-none"
                style={cornerStyle(is3d, 10, 0.65)}
              >
                <Stat {...blocks[2]} size={bigSize} align="start" />
                <Stat {...blocks[3]} size={bigSize} align="start" />
              </div>
            </>
          )}
        </div>

        <div
          ref={tipRef}
          role="tooltip"
          aria-hidden={active < 0}
          className="bg-foreground text-background text-note pointer-events-none absolute top-0 left-0 z-20 rounded-md px-3 py-1.5 whitespace-nowrap shadow-lg transition-opacity duration-150 motion-reduce:transition-none"
          style={{ opacity: active >= 0 ? 1 : 0 }}
        >
          {cell ? (
            <>
              <strong className="font-semibold">{counted(cell.count)}</strong>
              <span className="opacity-75"> on {DAY_YEAR.format(dayMs(cell.date))}</span>
            </>
          ) : (
            " "
          )}
          <span
            aria-hidden="true"
            className="border-t-foreground absolute top-full -ml-[5px] size-0 border-x-[5px] border-t-[5px] border-x-transparent"
            style={{ left: "var(--arrow, 50%)" }}
          />
        </div>
      </div>

      <div
        aria-hidden={!showRow}
        className="grid transition-[grid-template-rows,opacity] motion-reduce:transition-none"
        style={{
          gridTemplateRows: showRow ? "1fr" : "0fr",
          opacity: showRow ? 1 : 0,
          transitionDuration: `${MORPH_MS}ms`,
          transitionTimingFunction: EASE,
        }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 pt-5 @2xl/streak:grid-cols-4">
            {blocks.map((block) => (
              <Stat key={block.label} {...block} align="stack" />
            ))}
          </div>
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

type StatBlock = { label: string; value: string; unit: string; sub: string };

/** One number: in the row under the chart (`stack`), or large in a corner of
 *  the skyline, its label over it and its unit and dates beside it. */
function Stat({
  label,
  value,
  unit,
  sub,
  size,
  align,
}: StatBlock & { size?: number; align: "stack" | "start" | "end" }) {
  if (align === "stack") {
    return (
      <div className="min-w-0">
        <p className="text-note text-ink-meta">{label}</p>
        <p className="mt-1 flex items-baseline gap-1.5">
          <span className="text-display text-ink">{value}</span>
          <span className="text-body text-ink-muted">{unit}</span>
        </p>
        <p className="text-note text-ink-meta mt-0.5 truncate">{sub}</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[auto_auto] items-end gap-x-2" style={{ justifyContent: align }}>
      <p
        className={cn(
          "text-note text-ink-meta",
          align === "end" ? "col-start-1 text-right" : "col-span-2",
        )}
      >
        {label}
      </p>
      <p
        className="text-ink col-start-1 text-right font-bold"
        style={{ fontSize: size, lineHeight: 0.95, letterSpacing: "-0.02em" }}
      >
        {value}
      </p>
      <div className="pb-[0.15em]">
        <p className="text-body text-ink-muted">{unit}</p>
        <p className="text-note text-ink-meta whitespace-nowrap">{sub}</p>
      </div>
    </div>
  );
}
