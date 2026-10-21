"use client";

import * as React from "react";
import {
  AnimatePresence,
  MotionConfig,
  animate,
  cancelFrame,
  frame,
  motion,
  useInView,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
  type FrameData,
  type MotionValue,
} from "motion/react";
import { ArrowDownWideNarrow, RefreshCw } from "lucide-react";

import { Logo } from "@/components/logo";
import { cn } from "@/lib/cn";

import { hiringSystems, hiringSystemsSection as copy, streams, type StreamPosting } from "./data";
import { FaviconLogo } from "./favicon-logo";
import { useMediaQuery, usePageHidden } from "./hooks";
import { scoreTone } from "./score-tone";
import { GLIDE } from "./story";

/** From lg up the pipeline runs left to right; below it, top to bottom. */
const WIDE_QUERY = "(min-width: 1024px)";
/** Each lane's speed in px a second, so the stream keeps its pace at
 * every width; lanes differ, so job postings arrive out of step. */
const WIDE_SPEEDS = [42, 33, 37, 30, 36, 29, 39];
const NARROW_SPEEDS = [30, 26, 28];
/** Chips in a lane below lg, where a lane is a column. */
const NARROW_SLOTS = 5;
/** Room a chip needs along a wide lane, in px. A lane too short for two
 * chips carries one, which shows the lane's next job posting each lap. */
const WIDE_SLOT = 232;
/** From the stream's far edge to WorkIt's centre, in px. Matches the
 * node's classes: wide, right-[26px] plus half of 76px; narrow,
 * bottom-[44px] plus half of 64px. */
const NODE_INSET = { wide: 64, narrow: 76 };
/** Where along a lane its chips start to curve into WorkIt. */
const CONVERGE = 0.45;
/** The least time between two cards, in seconds of the stream's clock. */
const CARD_GAP = 1.4;
/** How long each of WorkIt's steps shows under its mark, in seconds. */
const STEP_S = 3.2;
/** The stream's clock for its first frame, and the one still frame shown
 * with reduced motion. Picked by simulating every layout: no chip is
 * mid-fall, a role or two is struck, and the first card comes out within
 * two seconds. Re-check it when lanes, speeds or postings change. */
const STILL_AT = 94.3;
/** Cards on the Jobs page side. */
const CARDS = { wide: 4, narrow: 3 };

/** One of a lane's evenly spaced places. A lane's chips go into WorkIt
 * one after another, and each takes the lane's next job posting in turn,
 * so a lane never shows one posting twice at once. */
type Chip = {
  postings: StreamPosting[];
  lane: number;
  slot: number;
  slots: number;
  period: number;
  phase: number;
};

type Geometry = {
  wide: boolean;
  width: number;
  height: number;
  /** Distance from the stream's near edge to WorkIt's centre. */
  travel: number;
  /** Each lane's offset from WorkIt's centre, across the flow. */
  lanes: number[];
};

const KEPT = hiringSystems.flatMap((system) => streams[system.name].filter((p) => p.card));

function laneChips(
  postings: StreamPosting[],
  lane: number,
  slots: number,
  period: number,
  stagger: number,
): Chip[] {
  return Array.from({ length: slots }, (_, slot) => ({
    postings,
    lane,
    slot,
    slots,
    period,
    // Left unwrapped: postingOn counts laps from these phases.
    phase: slot / slots + ((lane * stagger) % 1),
  }));
}

/** One lane per hiring system, its chips that system's job postings. */
function wideChips(g: Geometry): Chip[] {
  const slots = g.travel / 2 >= WIDE_SLOT ? 2 : 1;
  return hiringSystems.flatMap((system, lane) =>
    laneChips(streams[system.name], lane, slots, g.travel / WIDE_SPEEDS[lane], 0.37),
  );
}

/** Kept and dropped job postings in turn, for the columns below lg. */
const MIXED = (() => {
  const all = hiringSystems.flatMap((system) => streams[system.name]);
  const kept = all.filter((p) => p.card);
  const dropped = all.filter((p) => !p.card);
  return kept.flatMap((p, i) => (dropped[i] ? [p, dropped[i]] : [p]));
})();

/** Two or three columns of job postings, kept and dropped in turn. */
function narrowChips(g: Geometry): Chip[] {
  return g.lanes.flatMap((_, lane) => {
    const column = MIXED.slice(lane * NARROW_SLOTS, (lane + 1) * NARROW_SLOTS);
    return laneChips(column, lane, column.length, g.travel / NARROW_SPEEDS[lane], 0.29);
  });
}

function geometryFor(wide: boolean, width: number, height: number): Geometry {
  if (wide) {
    const n = hiringSystems.length;
    return {
      wide,
      width,
      height,
      travel: width - NODE_INSET.wide,
      // The sources column spreads its pills with justify-around, so each
      // lane runs through its pill's centre.
      lanes: Array.from({ length: n }, (_, i) => ((i + 0.5) * height) / n - height / 2),
    };
  }
  const n = width >= 520 ? 3 : 2;
  return {
    wide,
    width,
    height,
    travel: height - NODE_INSET.narrow,
    lanes: Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * (width / n)),
  };
}

/**
 * The cards after a kept posting comes out of WorkIt. If its card is
 * already shown, the next kept posting not shown comes out instead, so
 * every entry brings a new card: with the same few postings going round,
 * the list otherwise sat unchanged for up to 15 seconds.
 */
function nextCards(cards: StreamPosting[], posting: StreamPosting, shown: number) {
  const visible = cards.slice(-shown);
  let next = posting;
  if (visible.includes(posting)) {
    const i = KEPT.indexOf(posting);
    next = [...KEPT.slice(i + 1), ...KEPT.slice(0, i)].find((p) => !visible.includes(p)) ?? posting;
  }
  return [...cards.filter((p) => p !== next), next].slice(-CARDS.wide);
}

/** 0 before `from`, 1 after `to`, eased between. */
function smooth(from: number, to: number, v: number) {
  const x = Math.min(1, Math.max(0, (v - from) / (to - from)));
  return x * x * (3 - 2 * x);
}

/** How many times a chip has run its lane by time `t`. */
function lapAt(chip: Chip, t: number) {
  return Math.floor(t / chip.period + chip.phase);
}

/** The job posting a chip carries on a lap: the lane's chips enter in the
 * order lap × slots − slot, and each entry takes the next posting. */
function postingOn(chip: Chip, lap: number) {
  const n = chip.postings.length;
  return chip.postings[(((lap * chip.slots - chip.slot) % n) + n) % n];
}

/**
 * Where a chip is at time `t`. It runs down its lane, curves into WorkIt's
 * centre, and either shrinks into WorkIt (a kept role) or is struck
 * through and falls away just before it (a senior role).
 */
function poseAt(chip: Chip, g: Geometry, t: number) {
  const lap = lapAt(chip, t);
  const p = t / chip.period + chip.phase - lap;
  const offset = g.lanes[chip.lane] ?? 0;
  const along = p * g.travel;
  const across = offset * (1 - smooth(CONVERGE, 1, p));
  const kept = Boolean(postingOn(chip, lap).card);
  const out = kept ? smooth(0.88, 1, p) : smooth(0.6, 0.76, p);
  // A dropped chip falls off the flow: down on wide, outward below lg.
  const side = g.wide ? 1 : Math.sign(offset) || 1;
  const fall = kept ? 0 : out * 30;
  return {
    lap,
    x: g.wide ? along : g.width / 2 + across + side * fall,
    y: g.wide ? g.height / 2 + across + fall : along,
    scale: kept ? 1 - 0.5 * smooth(0.78, 1, p) : 1 - 0.1 * out,
    rotate: kept ? 0 : side * 9 * out,
    opacity: Math.min(smooth(0, 0.06, p), 1 - out),
    strike: kept ? 0 : smooth(0.46, 0.56, p),
  };
}

/** A lane's faint track, the same curve its chips follow. */
function trackPath(g: Geometry, offset: number) {
  const points = Array.from({ length: 33 }, (_, k) => {
    const p = k / 32;
    const along = p * g.travel;
    const across = offset * (1 - smooth(CONVERGE, 1, p));
    return g.wide ? [along, g.height / 2 + across] : [g.width / 2 + across, along];
  });
  return `M${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}`;
}

/**
 * The home page's hiring-systems section: the job pipeline
 * (docs/job-pipeline.md) as a stream. Job postings from company job boards
 * on each hiring system run down their lanes into WorkIt; senior roles are
 * struck through and dropped, internships and new-grad roles go in, and
 * each comes out as a clean card on the Jobs page side, sorted by Best
 * Match. Left to right from lg up, one lane per hiring system; top to
 * bottom below lg. It plays only in view and in a visible tab, on one
 * clock that stops when it does; with reduced motion it holds one still
 * frame (STILL_AT). The cards and WorkIt's mark are `.glass-card` over
 * violet blobs; nothing above them fades, filters or masks (landing.css).
 */
export function HiringSystems() {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const streamRef = React.useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { amount: 0.3 });
  const hidden = usePageHidden();
  const reduceMotion = useReducedMotion();
  const wide = useMediaQuery(WIDE_QUERY);
  const isWide = wide ?? true;

  const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);
  React.useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const geometry = React.useMemo(
    () => (wide === null || !size ? null : geometryFor(wide, size.width, size.height)),
    [wide, size],
  );
  const chips = React.useMemo(
    () => (geometry ? (geometry.wide ? wideChips : narrowChips)(geometry) : []),
    [geometry],
  );

  // The stream's clock, in seconds. It only moves while the section plays.
  const clock = useMotionValue(STILL_AT);
  const playing = inView && !hidden && !reduceMotion && geometry !== null;
  React.useEffect(() => {
    if (!playing) return;
    const tick = ({ delta }: FrameData) => clock.set(clock.get() + Math.min(delta, 50) / 1000);
    frame.update(tick, true);
    return () => cancelFrame(tick);
  }, [playing, clock]);

  // Kept postings wait here between entering WorkIt and coming out as a
  // card, so cards never come faster than CARD_GAP.
  const queue = React.useRef<StreamPosting[]>([]);
  const lastCard = React.useRef(-Infinity);
  const [feed, setFeed] = React.useState({ cards: KEPT.slice(-CARDS.wide), arrivals: 0 });
  const onEnter = React.useCallback((posting: StreamPosting) => {
    if (queue.current.length < 2) queue.current.push(posting);
  }, []);

  const [step, setStep] = React.useState(0);
  const shownStep = React.useRef(0);
  useMotionValueEvent(clock, "change", (t) => {
    const next = Math.floor((t - STILL_AT) / STEP_S) % copy.steps.length;
    if (next !== shownStep.current) {
      shownStep.current = next;
      setStep(next);
    }
    if (queue.current.length && t - lastCard.current >= CARD_GAP) {
      const posting = queue.current.shift()!;
      lastCard.current = t;
      const shown = isWide ? CARDS.wide : CARDS.narrow;
      setFeed((prev) => ({
        cards: nextCards(prev.cards, posting, shown),
        arrivals: prev.arrivals + 1,
      }));
    }
  });

  // WorkIt's mark pulses as each card comes out.
  const nodeScale = useMotionValue(1);
  React.useEffect(() => {
    if (feed.arrivals === 0) return;
    const controls = animate(nodeScale, [1, 1.08, 1], { duration: 0.5, ease: GLIDE });
    return () => controls.stop();
  }, [feed.arrivals, nodeScale]);

  const cards = feed.cards
    .slice(-(isWide ? CARDS.wide : CARDS.narrow))
    .sort((a, b) => (b.card?.score ?? 0) - (a.card?.score ?? 0));

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={rootRef}
        className="bg-landing-brand-100 relative isolate mt-12 overflow-hidden rounded-[2rem] p-4 ring-1 ring-slate-900/5 sm:p-6 lg:mt-16 lg:p-8"
      >
        <div className="grid grid-cols-1 gap-y-4 lg:grid-cols-[132px_minmax(0,1fr)_minmax(0,360px)] lg:gap-y-5">
          <div className="flex items-center justify-between gap-3 lg:col-span-2">
            <Label>{copy.intake}</Label>
            <span className="text-landing-brand-700 flex items-center gap-1.5 text-xs font-semibold lg:mr-1">
              <RefreshCw className="size-3.5" aria-hidden="true" />
              {copy.cadence}
            </span>
          </div>
          <OutputLabel className="hidden lg:flex lg:pl-10" />

          {/* The hiring systems, as the stream's sources: a column from lg
              up, one pill per lane; a wrapped row below it. */}
          <ul
            aria-label="Hiring systems WorkIt reads"
            className="flex flex-wrap justify-center gap-1.5 lg:flex-col lg:flex-nowrap lg:justify-around lg:gap-0 lg:pr-3"
          >
            {hiringSystems.map((system) => (
              <li
                key={system.name}
                className="text-ink flex h-8 items-center gap-2 rounded-xl bg-white pr-2.5 pl-1 text-xs font-medium shadow-[0_6px_16px_-12px_rgba(40,20,90,0.4)] ring-1 ring-slate-900/[0.07] lg:h-10 lg:pr-3 lg:pl-1.5 lg:text-[13px]"
              >
                <FaviconLogo domain={system.domain} className="size-6 rounded-lg lg:size-7" />
                {system.name}
              </li>
            ))}
          </ul>

          <div ref={streamRef} aria-hidden="true" className="relative h-[320px] lg:h-[392px]">
            {/* A violet glow behind WorkIt, so its glass has colour to blur. */}
            <div className="absolute bottom-[-40px] left-1/2 size-[300px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-brand)_30%,transparent),transparent)] lg:top-1/2 lg:right-[-86px] lg:bottom-auto lg:left-auto lg:translate-x-0 lg:-translate-y-1/2" />

            {geometry && (
              <>
                <svg
                  className="text-landing-brand-300 absolute inset-0 size-full overflow-visible"
                  viewBox={`0 0 ${geometry.width} ${geometry.height}`}
                  fill="none"
                >
                  {geometry.lanes.map((offset, i) => (
                    <path
                      key={i}
                      d={trackPath(geometry, offset)}
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeDasharray="2 6"
                      strokeLinecap="round"
                    />
                  ))}
                </svg>
                <div className="absolute inset-0 overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_32px)] lg:[mask-image:linear-gradient(to_right,transparent,black_48px)]">
                  {chips.map((chip) => (
                    <StreamChip
                      key={`${chip.lane}-${chip.slot}-${chip.slots}`}
                      chip={chip}
                      geometry={geometry}
                      clock={clock}
                      onEnter={onEnter}
                    />
                  ))}
                </div>
              </>
            )}

            {/* WorkIt: its mark in glass, and under it the step it is on. */}
            <div className="absolute bottom-[44px] left-1/2 z-10 -translate-x-1/2 lg:top-1/2 lg:right-[26px] lg:bottom-auto lg:left-auto lg:translate-x-0 lg:-translate-y-1/2">
              {feed.arrivals > 0 && (
                <motion.span
                  key={feed.arrivals}
                  className="ring-brand/40 absolute inset-0 rounded-[20px] ring-2 lg:rounded-[22px]"
                  initial={{ scale: 1, opacity: 0.7 }}
                  animate={{ scale: 1.5, opacity: 0 }}
                  transition={{ duration: 0.9, ease: "easeOut" }}
                />
              )}
              <motion.div
                className="glass-card grid size-16 place-items-center rounded-[20px] lg:size-[76px] lg:rounded-[22px]"
                style={{ scale: nodeScale }}
              >
                <Logo size="mark" decorative className="h-6 lg:h-7" />
              </motion.div>
              {/* The run to the cards, as a dot leaving WorkIt. */}
              {feed.arrivals > 0 && (
                <motion.span
                  key={`dot-${feed.arrivals}`}
                  className="bg-brand absolute top-1/2 left-full -mt-[3px] hidden size-1.5 rounded-full shadow-[0_0_8px_2px_rgba(109,63,216,0.45)] lg:block"
                  initial={{ x: 0, opacity: 0 }}
                  animate={{ x: 62, opacity: [0, 1, 1, 0] }}
                  transition={{ duration: 0.45, ease: "easeInOut" }}
                />
              )}
              <div className="absolute top-full left-1/2 mt-2.5 w-40 -translate-x-1/2 text-center">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p
                    key={step}
                    className="text-ink-meta text-[11px] leading-4 font-medium text-balance"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4, transition: { duration: 0.15 } }}
                    transition={{ duration: 0.3, ease: GLIDE }}
                  >
                    {copy.steps[step]}
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>
          </div>

          <OutputLabel className="flex lg:hidden" />

          {/* The Jobs page side: the newest kept postings as clean cards,
              best match first. */}
          <ul aria-hidden="true" className="relative flex flex-col justify-center gap-2.5 lg:pl-10">
            <li className="absolute inset-x-0 -inset-y-10 -z-10 bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-match-good)_16%,transparent),transparent)] lg:left-10" />
            <AnimatePresence mode="popLayout" initial={false}>
              {cards.map((posting) => (
                <JobCard key={posting.company} posting={posting} wide={isWide} />
              ))}
            </AnimatePresence>
          </ul>
        </div>
      </div>
    </MotionConfig>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-ink text-sm font-semibold">{children}</p>;
}

function OutputLabel({ className }: { className?: string }) {
  return (
    <div className={cn("items-center justify-between gap-3", className)}>
      <Label>{copy.output}</Label>
      <span className="text-ink-meta flex items-center gap-1.5 text-xs font-medium">
        <ArrowDownWideNarrow className="size-3.5" aria-hidden="true" />
        {copy.sort}
      </span>
    </div>
  );
}

/** A raw job posting on its way to WorkIt: the company's logo and the title. */
function StreamChip({
  chip,
  geometry,
  clock,
  onEnter,
}: {
  chip: Chip;
  geometry: Geometry;
  clock: MotionValue<number>;
  onEnter: (posting: StreamPosting) => void;
}) {
  const pose = useTransform(clock, (t) => poseAt(chip, geometry, t));
  const x = useTransform(pose, (p) => p.x);
  const y = useTransform(pose, (p) => p.y);
  const scale = useTransform(pose, (p) => p.scale);
  const rotate = useTransform(pose, (p) => p.rotate);
  const opacity = useTransform(pose, (p) => p.opacity);
  // The strike is a background on each line of the title, so a title that
  // wraps below lg is struck on both lines.
  const strike = useTransform(pose, (p) => `${p.strike * 100}% 1.5px`);
  const dim = useTransform(pose, (p) => 1 - 0.5 * p.strike);

  // Each lap ends inside WorkIt: a kept posting goes on to be a card, and
  // the chip comes round again with the lane's next posting.
  // The lap is kept in a ref as well as state: useTransform sets `pose`
  // again while the chip renders, and a listener that still saw the old
  // lap in state set it again in that render, which looped.
  const [lap, setLap] = React.useState(() => lapAt(chip, clock.get()));
  const seenLap = React.useRef(lap);
  useMotionValueEvent(pose, "change", (next) => {
    if (next.lap === seenLap.current) return;
    const done = postingOn(chip, seenLap.current);
    seenLap.current = next.lap;
    if (done.card) onEnter(done);
    setLap(next.lap);
  });
  const posting = postingOn(chip, lap);

  // Below lg a chip fits its column, so its title takes up to two lines.
  const laneWidth = geometry.wide ? undefined : geometry.width / geometry.lanes.length - 8;

  return (
    <motion.div className="absolute top-0 left-0" style={{ x, y, scale, rotate, opacity }}>
      <div
        className={cn(
          "text-ink flex items-center gap-2 rounded-xl bg-white py-1 pr-3 pl-1 font-medium shadow-[0_6px_16px_-10px_rgba(40,20,90,0.35)] ring-1 ring-slate-900/[0.07]",
          geometry.wide
            ? "-translate-x-full -translate-y-1/2 text-xs whitespace-nowrap"
            : "w-max -translate-x-1/2 -translate-y-full gap-1.5 pr-2 text-[11px] leading-[14px]",
        )}
        style={{ maxWidth: laneWidth }}
      >
        <FaviconLogo
          domain={posting.domain}
          eager
          className={cn("rounded-[7px]", geometry.wide ? "size-6" : "size-5 rounded-md")}
        />
        <motion.span className="line-clamp-2 min-w-0" style={{ opacity: dim }}>
          <motion.span
            className="bg-[linear-gradient(var(--color-danger),var(--color-danger))] box-decoration-clone bg-[position:0_55%] bg-no-repeat"
            style={{ backgroundSize: strike }}
          >
            {posting.title}
          </motion.span>
        </motion.span>
      </div>
    </motion.div>
  );
}

/** A clean job posting card, as the Jobs page shows one. */
function JobCard({ posting, wide }: { posting: StreamPosting; wide: boolean }) {
  const card = posting.card!;
  return (
    <motion.li
      layout
      className="glass-card text-ink flex items-center gap-3 rounded-2xl p-3"
      initial={{ opacity: 0, x: wide ? -24 : 0, y: wide ? 0 : -12, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.2 } }}
      transition={{
        duration: 0.4,
        delay: 0.2,
        ease: GLIDE,
        layout: { duration: 0.5, ease: GLIDE },
      }}
    >
      <FaviconLogo domain={posting.domain} eager className="size-10 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold">{posting.title}</p>
        <p className="text-ink-meta truncate text-xs">
          {posting.company} · {card.location}
        </p>
        <p className="mt-1.5 flex gap-1.5">
          {card.facts.map((fact) => (
            <span
              key={fact}
              className="text-ink-meta rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-slate-900/5"
            >
              {fact}
            </span>
          ))}
        </p>
      </div>
      <span
        className={cn(
          "self-start rounded-md px-[7px] py-0.5 text-[11px] font-bold shadow-[inset_0_1px_0_rgb(255_255_255/0.8)] ring-1 ring-inset",
          scoreTone(card.score),
        )}
      >
        {card.score}%
      </span>
    </motion.li>
  );
}
