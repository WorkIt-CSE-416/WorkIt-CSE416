"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { SegmentedToggle } from "@/components/ui/segmented-control";
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
import { SectionCard } from "./section-card";

/**
 * Activity — the seeker's year of applications as a streak heat map that folds
 * up into a 3D skyline and back, two columns wide at the foot of the
 * Dashboard, beside Waiting.
 * It replaced a weekly pace chart there and kept its heading (page.tsx says
 * why).
 *
 * In a white card under its heading, like every Dashboard section
 * (./section-card.tsx). The view switch sits where a section's one way
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

const VIEW_OPTIONS = [
  { value: "2d" as const, label: "2D" },
  { value: "3d" as const, label: "3D" },
];

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

export function Streak({ days, className }: { days: AppliedDay[]; className?: string }) {
  const today = useSyncExternalStore(noSubscription, localToday, utcToday);
  const model = useMemo(() => {
    const grid = buildGrid(days, dayMs(today));
    return {
      ...grid,
      stats: computeStats(grid.cells),
      months: monthLabels(grid.cells, grid.weeks),
    };
  }, [days, today]);

  // The flat heat map first: it reads at a glance, and the skyline is the
  // flourish a seeker opts into.
  const [view, setView] = useState<View>("2d");
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
  // The numbers belong to the heat map; the skyline stands alone.
  const showRow = !is3d;
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
    <SectionCard
      ref={rootRef}
      aria-labelledby="streak"
      className={cn("@container/streak", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="streak" className="text-subtitle text-ink font-medium">
          Activity
        </h2>
        <SegmentedToggle
          label="Chart View"
          options={VIEW_OPTIONS}
          value={view}
          onValueChange={(v) => setView(v as View)}
        />
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
        </div>

        <div
          ref={tipRef}
          role="tooltip"
          aria-hidden={active < 0}
          className="bg-foreground text-background text-note pointer-events-none absolute top-0 left-0 z-20 rounded-md px-3 py-1.5 whitespace-nowrap shadow-lg transition-opacity duration-150"
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
        className="grid transition-[grid-template-rows,opacity]"
        style={{
          gridTemplateRows: showRow ? "1fr" : "0fr",
          opacity: showRow ? 1 : 0,
          transitionDuration: `${MORPH_MS}ms`,
          transitionTimingFunction: "var(--ease-glide)",
        }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 pt-5 @2xl/streak:grid-cols-4">
            {blocks.map((block) => (
              <Stat key={block.label} {...block} />
            ))}
          </div>
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </SectionCard>
  );
}

type StatBlock = { label: string; value: string; unit: string; sub: string };

/** One number in the row under the heat map: its label over it, its unit
 *  beside it, and its dates under it. */
function Stat({ label, value, unit, sub }: StatBlock) {
  return (
    <div className="min-w-0">
      <p className="text-note text-ink-meta">{label}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-display text-ink">{value}</span>
        <span className="text-body text-ink-muted">{unit}</span>
      </p>
      {/* Its dates in --color-ink-muted, not meta grey, which read too faint
          under a 28px figure in Plus Jakarta Sans; two lines on a phone
          rather than "Oct 5, 2025 – Oct 10, 20…". */}
      <p className="text-note text-ink-muted mt-0.5 line-clamp-2">{sub}</p>
    </div>
  );
}
