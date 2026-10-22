"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";

import { cn } from "@/lib/cn";

import { stages } from "./board-data";
import { FaviconLogo } from "./favicon-logo";
import { followedJob, matchingFeature } from "./feature-data";
import { useMediaQuery } from "./hooks";
import { scoreTone } from "./score-tone";
import { TOUR_TABS, type TourTab } from "./tour-tabs";

/**
 * The story between the hero and the product tour, after Twain's habit of
 * carrying things from one section into the next. From lg up the scroll
 * drives it, from the moment it starts to come up under the hero (so the
 * postings seem to rise out of the city) through a pinned stretch: a flood
 * of job postings rises
 * ("Thousands of internships open every season"), the few that fit are
 * kept and sorted ("WorkIt finds the ones that fit you"), they stack into
 * one with the four steps under it ("Then it helps with every step after
 * that"), and as the tour comes up those four steps fly into its tab bar
 * (`TabFlight`). Below lg, and with reduced motion, it is a still version
 * with no pin. Postings name real employers from the board and Matching,
 * with their scores there; the fit six are the ones the tour and board
 * already show scoring highest.
 */

// --- The postings ---

type Posting = { company: string; domain: string; title: string; score: number };

const ALL: Posting[] = [
  ...stages.flatMap((stage) => stage.jobs),
  ...matchingFeature.jobs.filter(
    (job) => !stages.some((stage) => stage.jobs.some((j) => j.company === job.company)),
  ),
].map(({ company, domain, title, score }) => ({ company, domain, title, score }));

/** The postings that fit, in the order they stack: the followed job on top. */
const FIT = [followedJob.company, "Cloudflare", "Coinbase", "Ramp", "Notion", "Datadog"];

/** Each posting's place in the flood: a jittered grid of columns and rows,
 * in % of the stage, and a depth (1 near, 0.7 far). */
const COLS = 7;
const POSTINGS = ALL.map((posting, i) => {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const jitter = (n: number) => (((i * n) % 9) - 4) * 0.9;
  return {
    ...posting,
    x: ((col + 0.5) / COLS) * 100 + jitter(7),
    y: 42 + row * 18 + jitter(5),
    depth: [1, 0.78, 0.9, 0.72, 0.96, 0.84, 0.76][(i * 3) % 7],
    fit: FIT.indexOf(posting.company),
  };
});

// --- The scroll's beats, as progress from 0 to 1: from the section's top
// meeting the screen's foot to its pin's end. The section is 260vh, so the
// first 100/260 (about 0.38) is it coming up and the rest is pinned. ---

const RISE: [number, number] = [0.06, 0.34]; // staggered by depth inside it
const SORT: [number, number] = [0.45, 0.58];
const STACK: [number, number] = [0.64, 0.74];
const PILLS_IN: [number, number] = [0.66, 0.72];
const SWEEP: [number, number] = [0.72, 0.86];
const OUT: [number, number] = [0.88, 0.98];

const LINES: { text: string; at: [number, number, number, number] }[] = [
  { text: "Thousands of internships open every season.", at: [0.1, 0.16, 0.43, 0.47] },
  { text: "WorkIt finds the ones that fit you.", at: [0.45, 0.49, 0.61, 0.65] },
  // Every range stays inside 0 to 1: motion hands scroll-linked opacity to
  // the browser's own animations, which refuse a keyframe offset past 1
  // ("Offsets must be null or in the range [0,1]"), and the page crashed.
  { text: "Then it helps with every step after that.", at: [0.63, 0.67, 0.995, 1] },
];

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const between = (v: number, [a, b]: [number, number]) => clamp((v - a) / (b - a));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const out = (t: number) => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Tailwind's lg breakpoint: pinned from here up.
const DESKTOP_QUERY = "(min-width: 64rem)";

export function Bridge() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const reduceMotion = useReducedMotion();
  if (isDesktop === true && !reduceMotion) return <PinnedBridge />;
  return <StillBridge />;
}

function PinnedBridge() {
  const ref = React.useRef<HTMLElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start end", "end end"] });
  // The stage's size, read inside the transforms through a ref.
  const size = React.useRef({ w: 1440, h: 900 });
  React.useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      size.current = { w: stage.offsetWidth, h: stage.offsetHeight };
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={ref}
      aria-label="From thousands of postings to the ones that fit"
      className="h-[260vh]"
    >
      <div ref={stageRef} className="sticky top-0 h-dvh overflow-hidden">
        <div className="absolute inset-x-0 top-[17vh] z-30 px-6 text-center">
          {LINES.map((line) => (
            <Line key={line.text} p={p} at={line.at}>
              {line.text}
            </Line>
          ))}
        </div>
        {POSTINGS.map((posting, i) => (
          <PostingCard key={i} p={p} posting={posting} size={size} />
        ))}
        <Steps p={p} />
      </div>
    </section>
  );
}

function Line({
  p,
  at,
  children,
}: {
  p: MotionValue<number>;
  at: [number, number, number, number];
  children: string;
}) {
  const opacity = useTransform(p, at, [0, 1, 1, 0]);
  const y = useTransform(p, at, [18, 0, 0, -18]);
  const filter = useTransform(p, at, ["blur(8px)", "blur(0px)", "blur(0px)", "blur(8px)"]);
  return (
    <motion.p
      className="text-ink absolute inset-x-0 text-3xl font-semibold tracking-[-0.03em] text-balance sm:text-5xl"
      style={{ opacity, y, filter }}
    >
      {children}
    </motion.p>
  );
}

/** Where a posting is, how big, how clear and how solid, at progress v. */
function placeAt(
  posting: (typeof POSTINGS)[number],
  { w, h }: { w: number; h: number },
  v: number,
) {
  const k = posting.fit;
  const fit = k >= 0;
  const homeX = (posting.x / 100) * w;
  const homeY = (posting.y / 100) * h;
  const d = posting.depth;
  // Rises from below, the near ones first.
  const delay = (1 - d) * 0.25;
  const t1 = out(clamp((v - RISE[0] - delay) / (RISE[1] - RISE[0] - 0.07)));
  let x = homeX;
  let y = homeY + (1 - t1) * h * 0.55;
  let opacity = t1;
  let scale = 0.62 + 0.38 * d;
  let blur = (1 - d) * 6;
  // The fit six sort into a grid; the rest fade and blur away.
  const t2 = ease(between(v, SORT));
  if (fit) {
    const gx = w / 2 + ((k % 3) - 1) * 236;
    const gy = h * 0.56 + (Math.floor(k / 3) - 0.5) * 84;
    x = lerp(x, gx, t2);
    y = lerp(y, gy, t2);
    scale = lerp(scale, 1, t2);
    blur = lerp(blur, 0, t2);
  } else {
    opacity *= 1 - 0.85 * t2;
    blur += 5 * t2;
    scale *= 1 - 0.08 * t2;
  }
  // The six stack into one, the followed job on top; the rest go.
  const t3 = ease(between(v, STACK));
  if (fit) {
    x = lerp(x, w / 2, t3);
    y = lerp(y, h * 0.5 + k * 7, t3);
    scale = lerp(scale, 1 - k * 0.035, t3);
  } else {
    opacity *= 1 - t3;
  }
  // Then the stack lifts away as the tour takes over.
  const t4 = ease(between(v, OUT));
  opacity *= 1 - t4;
  y -= t4 * 40;
  return { x, y, scale, opacity, blur };
}

function PostingCard({
  p,
  posting,
  size,
}: {
  p: MotionValue<number>;
  posting: (typeof POSTINGS)[number];
  size: React.RefObject<{ w: number; h: number }>;
}) {
  const k = posting.fit;
  const fit = k >= 0;

  // The stage's size is read through a ref inside each transform, so a
  // resize takes effect on the next scroll.
  const at = (v: number) => placeAt(posting, size.current, v);
  const x = useTransform(p, (v) => at(v).x);
  const y = useTransform(p, (v) => at(v).y);
  const scale = useTransform(p, (v) => at(v).scale);
  const opacity = useTransform(p, (v) => at(v).opacity);
  const filter = useTransform(p, (v) => `blur(${at(v).blur.toFixed(2)}px)`);
  const scoreOpacity = useTransform(p, (v) => (fit ? ease(between(v, SORT)) : 0));

  return (
    <motion.div
      aria-hidden="true"
      className="absolute top-0 left-0 flex w-[210px] -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 rounded-xl bg-white p-2.5 shadow-[0_14px_30px_-18px_rgb(16_48_94/0.5)] ring-1 ring-slate-900/5"
      style={{
        x,
        y,
        scale,
        opacity,
        filter,
        zIndex: fit ? 20 - k : Math.round(posting.depth * 10),
      }}
    >
      <FaviconLogo domain={posting.domain} eager className="size-8 rounded-lg" />
      <span className="min-w-0 flex-1">
        <span className="text-ink block truncate text-[12px] font-semibold">{posting.title}</span>
        <span className="text-ink-meta block text-[11px]">{posting.company}</span>
      </span>
      {fit && (
        <motion.span
          className={cn(
            "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ring-1 ring-inset",
            scoreTone(posting.score),
          )}
          style={{ opacity: scoreOpacity }}
        >
          {posting.score}%
        </motion.span>
      )}
    </motion.div>
  );
}

/** The four steps under the stack, lit in turn: the tour's tabs to be. */
function Steps({ p }: { p: MotionValue<number> }) {
  const opacity = useTransform(p, PILLS_IN, [0, 1]);
  const y = useTransform(p, PILLS_IN, [16, 0]);
  return (
    <motion.div
      className="absolute inset-x-0 top-[72%] z-30 flex justify-center gap-2"
      style={{ opacity, y }}
    >
      {TOUR_TABS.map((tab, i) => (
        <StepPill key={tab.id} p={p} tab={tab} index={i} count={TOUR_TABS.length} />
      ))}
    </motion.div>
  );
}

function StepPill({
  p,
  tab,
  index,
  count,
}: {
  p: MotionValue<number>;
  tab: TourTab;
  index: number;
  count: number;
}) {
  const span = (SWEEP[1] - SWEEP[0]) / count;
  const start = SWEEP[0] + index * span;
  const lit = useTransform(p, [start, start + span * 0.6], [0, 1]);
  const y = useTransform(lit, [0, 1], [0, -4]);
  return (
    <motion.span data-bridge-pill={tab.id} style={{ y }} className="relative">
      <Pill tab={tab} />
      {/* The step's colour rings the pill as the sweep reaches it. */}
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{ opacity: lit, boxShadow: `0 0 0 2px ${tab.glow}, 0 10px 24px -10px ${tab.glow}` }}
      />
    </motion.span>
  );
}

/** A step as a pill, drawn like the tour's selected tab so it can become one. */
function Pill({ tab }: { tab: TourTab }) {
  const Icon = tab.icon;
  return (
    <span className="text-ink flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium whitespace-nowrap shadow-md ring-1 ring-slate-900/5">
      <Icon className="size-4" aria-hidden="true" />
      {tab.label}
    </span>
  );
}

/** Below lg, and with reduced motion: the same story, still. */
function StillBridge() {
  const fit = POSTINGS.filter((posting) => posting.fit >= 0).sort((a, b) => a.fit - b.fit);
  return (
    <section
      aria-label="From thousands of postings to the ones that fit"
      className="px-6 py-16 sm:py-24"
    >
      <div className="mx-auto max-w-xl space-y-3 text-center">
        {LINES.map((line) => (
          <p
            key={line.text}
            className="text-ink text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-3xl"
          >
            {line.text}
          </p>
        ))}
      </div>
      <div aria-hidden="true" className="mx-auto mt-10 grid max-w-sm gap-2">
        {fit.slice(0, 3).map((posting) => (
          <div
            key={posting.company}
            className="flex items-center gap-2.5 rounded-xl bg-white p-2.5 shadow-[0_14px_30px_-18px_rgb(16_48_94/0.5)] ring-1 ring-slate-900/5"
          >
            <FaviconLogo domain={posting.domain} className="size-8 rounded-lg" />
            <span className="min-w-0 flex-1">
              <span className="text-ink block truncate text-[12px] font-semibold">
                {posting.title}
              </span>
              <span className="text-ink-meta block text-[11px]">{posting.company}</span>
            </span>
            <span
              className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ring-1 ring-inset",
                scoreTone(posting.score),
              )}
            >
              {posting.score}%
            </span>
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="mt-6 flex flex-wrap justify-center gap-2">
        {TOUR_TABS.map((tab) => (
          <Pill key={tab.id} tab={tab} />
        ))}
      </div>
    </section>
  );
}

// --- The handoff: the four steps fly into the tour's tab bar ---

const noSubscribe = () => () => {};

/**
 * Mounted by the pinned tour. `progress` runs 0 to 1 as the tour scrolls
 * up from the screen's foot to its pin; each frame every pill sits between
 * its place under the bridge's stack (`[data-bridge-pill]`) and its tab
 * (`#tour-tab-<id>`), both measured live since both move. It marks the
 * page while it runs (`data-tab-flight` on <html>: idle, flying, landed),
 * and landing.css hides the bridge's own pills while they fly and the
 * tour's tab bar until they land, so each pill is drawn once. With no
 * flight (below lg, reduced motion, no bridge on the page) the attribute
 * is absent and the tabs simply show.
 */
export function TabFlight({ progress }: { progress: MotionValue<number> }) {
  const reduceMotion = useReducedMotion();
  const mounted = React.useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

  const mark = React.useCallback(
    (p: number) => {
      const root = document.documentElement;
      if (reduceMotion || !document.querySelector("[data-bridge-pill]")) {
        delete root.dataset.tabFlight;
        return;
      }
      root.dataset.tabFlight = p <= 0.01 ? "idle" : p >= 0.985 ? "landed" : "flying";
    },
    [reduceMotion],
  );
  useMotionValueEvent(progress, "change", mark);
  React.useEffect(() => {
    mark(progress.get());
    return () => {
      delete document.documentElement.dataset.tabFlight;
    };
  }, [mark, progress]);

  if (!mounted || reduceMotion) return null;
  return createPortal(
    <>
      {TOUR_TABS.map((tab, i) => (
        <FlyingPill key={tab.id} progress={progress} tab={tab} index={i} />
      ))}
    </>,
    document.body,
  );
}

function FlyingPill({
  progress,
  tab,
  index,
}: {
  progress: MotionValue<number>;
  tab: TourTab;
  index: number;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const opacity = useMotionValue(0);

  const place = React.useCallback(
    (p: number) => {
      const flying = p > 0.01 && p < 0.985 && !!document.querySelector("[data-bridge-pill]");
      opacity.set(flying ? 1 : 0);
      if (!flying) return;
      const from = document
        .querySelector(`[data-bridge-pill="${tab.id}"]`)
        ?.getBoundingClientRect();
      const to = document.getElementById(`tour-tab-${tab.id}`)?.getBoundingClientRect();
      if (!from || !to) return;
      // A small stagger, so they arrive one after another, and a lift in
      // the middle, so they arc rather than slide.
      const t = ease(clamp((p - index * 0.05) / 0.85));
      x.set(lerp(from.left, to.left, t));
      y.set(lerp(from.top, to.top, t) - Math.sin(Math.PI * t) * 40);
    },
    [index, opacity, tab.id, x, y],
  );
  useMotionValueEvent(progress, "change", place);
  React.useEffect(() => place(progress.get()), [place, progress]);

  return (
    <motion.span
      aria-hidden="true"
      className="pointer-events-none fixed top-0 left-0 z-40"
      style={{ x, y, opacity }}
    >
      <Pill tab={tab} />
    </motion.span>
  );
}
