"use client";

import * as React from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";

import { cn } from "@/lib/cn";

import { stages, type Stage } from "./board-data";
import { applicationsSection as copy, streams } from "./data";
import { FaviconLogo } from "./favicon-logo";
import { followedJob, matchingFeature } from "./feature-data";
import { FocusIn } from "./focus-in";
import { useMediaQuery } from "./hooks";
import { CONTAINER, SectionHeading } from "./layout-parts";
import { Burst, arrivalAt, stageAt, stepAt } from "./stage-timeline";
import { GLIDE } from "./story";
import { CARD_WIDTH, Flight, FollowedCard } from "./thread";

/**
 * The applications section ("Every application, from saved to signed."),
 * drawn as one search's route. Four stops run across the section (Saved,
 * Applied, Interview, Job Offers), and under each a pile of company logos
 * counts the search down: 24 roles saved, 12 sent, 4 in play, 1 signed.
 * From lg up it pins and the scroll alone drives it: the application the
 * statement ended on flies in and lands on the first stop (`Flight`,
 * thread.tsx), then rides the route stop by stop, its stage and next step
 * changing as it lands, while the logos that go on fly from one pile to the
 * next. At the last stop it is the one offer, and the journey picks it up.
 * Below lg, and with reduced motion, it is the still version: the four
 * stops as a list with every pile full.
 */

// Tailwind's lg breakpoint: pinned from here up.
const DESKTOP_QUERY = "(min-width: 64rem)";
/** Laptop screens 800px tall or less draw the card smaller, so the
 * heading, the route and the piles fit under the header. */
const SHORT_QUERY = "(max-height: 50rem)";
/** The pinned stretch's beats, as progress from 0 to 1: the card rides
 * from Saved to Job Offers between these, and holds the offer after. */
const RUN: [number, number] = [0.06, 0.86];
/** A logo tile's size and the gap between tiles in a pile, in px. Change
 * TILE with the tile's `size-[22px]` class. */
const TILE = 22;
const TILE_GAP = 5;
/** Tiles in a pile's row. */
const PER_ROW = 8;
/** The card's tallest look at full size, in px: its track's height. */
const CARD_HEIGHT = 228;

type Logo = { company: string; domain: string };

/**
 * The search's roles, furthest first: the followed application, then the
 * board's interviews, applications and saved roles, then Matching's and the
 * hiring-systems stream's postings. Pile `i` holds the first
 * `stages[i].tally.count`, so every logo that reaches a stop came from the
 * pile before it, and the last one standing is the followed application.
 */
const LOGOS: Logo[] = (() => {
  const seen = new Set<string>();
  const list: Logo[] = [];
  const add = ({ company, domain }: Logo) => {
    if (seen.has(domain)) return;
    seen.add(domain);
    list.push({ company, domain });
  };
  add(followedJob);
  for (const id of ["interview", "applied", "saved", "offer"] as const) {
    stages.find((stage) => stage.id === id)?.jobs.forEach(add);
  }
  matchingFeature.jobs.forEach(add);
  Object.values(streams).flat().forEach(add);
  return list.slice(0, stages[0].tally.count);
})();

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Slot `j` of a pile of `count` tiles, from the pile's top centre. */
function slot(j: number, count: number) {
  const perRow = Math.min(count, PER_ROW);
  const width = perRow * TILE + (perRow - 1) * TILE_GAP;
  return {
    x: -width / 2 + (j % perRow) * (TILE + TILE_GAP),
    y: Math.floor(j / perRow) * (TILE + TILE_GAP),
  };
}

const PILE_HEIGHT = Math.ceil(stages[0].tally.count / PER_ROW) * (TILE + TILE_GAP);

export function Applications() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const reduceMotion = useReducedMotion();
  if (isDesktop === true && !reduceMotion) return <PinnedApplications />;
  return <StillApplications />;
}

function Heading() {
  return (
    <FocusIn>
      <SectionHeading
        align="left"
        eyebrow={copy.eyebrow}
        title={copy.title}
        subtitle={copy.subtitle}
      />
    </FocusIn>
  );
}

function PinnedApplications() {
  const ref = React.useRef<HTMLElement>(null);
  const routeRef = React.useRef<HTMLDivElement>(null);
  const short = useMediaQuery(SHORT_QUERY) === true;
  const scale = short ? 0.78 : 1;

  // 0 when the section's top meets the screen's top, 1 when its bottom
  // meets the screen's bottom: the stretch where it is pinned.
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });
  // The section coming up from the screen's foot to its pin: the flight in.
  const { scrollYProgress: entry } = useScroll({
    target: ref,
    offset: ["start end", "start start"],
  });
  const s = useTransform(p, (v) => clamp((v - RUN[0]) / (RUN[1] - RUN[0])) * (stages.length - 1));
  const [step, setStep] = React.useState(() => stepAt(s.get()));
  useMotionValueEvent(s, "change", (v) => setStep(stepAt(v)));

  // The route's width; the stops are laid out from it.
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const route = routeRef.current;
    if (!route) return;
    const measure = () => setWidth(route.offsetWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(route);
    return () => observer.disconnect();
  }, []);
  // Each stop's centre: the card sits flush with the route's ends at the
  // first and last stops.
  const half = (CARD_WIDTH * scale) / 2;
  const stops = stages.map((_, i) => half + (i * (width - 2 * half)) / (stages.length - 1));

  return (
    <section ref={ref} id="applications" className="h-[280vh]">
      <Flight name="board" progress={entry}>
        <FollowedCard stage="saved" />
      </Flight>
      <div className="sticky top-0 flex h-dvh flex-col pt-24 pb-8">
        <div className={cn(CONTAINER, "flex min-h-0 flex-1 flex-col justify-center")}>
          <div className="flex items-end justify-between gap-12">
            <Heading />
            <Caption step={step} />
          </div>

          <div ref={routeRef} className="relative isolate mt-8 shrink-0">
            {/* A faint dot grid under the route, like a map's. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-x-8 -inset-y-6 -z-10 bg-[radial-gradient(circle,rgb(15_23_42/0.09)_1px,transparent_1.2px)] [mask-image:radial-gradient(70%_80%_at_50%_55%,black,transparent)] [background-size:22px_22px]"
            />
            {width > 0 && (
              <>
                <div className="relative" style={{ height: CARD_HEIGHT * scale + 14 }}>
                  <RouteCard s={s} step={step} stops={stops} scale={scale} />
                </div>
                <Track s={s} step={step} stops={stops} />
                <Piles s={s} stops={stops} />
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** The current stop's line, beside the heading. */
function Caption({ step }: { step: number }) {
  const stage = stages[step];
  return (
    <div className="relative mb-1 h-[5.5rem] w-[20rem] shrink-0">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={stage.id}
          className="absolute inset-x-0 bottom-0"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10, transition: { duration: 0.15 } }}
          transition={{ duration: 0.35, ease: GLIDE }}
        >
          <p className="text-landing-brand-700 text-sm font-semibold tabular-nums">
            {String(step + 1).padStart(2, "0")} · {stage.label}
          </p>
          <p className="text-ink mt-1 text-xl leading-snug font-medium text-pretty">
            {stage.description}
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/**
 * The followed application riding the route. It holds at its stop, then
 * glides to the next with a small lift and lean, and pops as it lands with
 * the new stage on it. It is both the flight's landing (from the
 * statement) and its next take-off (to the journey's Track card).
 */
function RouteCard({
  s,
  step,
  stops,
  scale,
}: {
  s: MotionValue<number>;
  step: number;
  stops: number[];
  scale: number;
}) {
  const half = (CARD_WIDTH * scale) / 2;
  const at = (v: number) => {
    const { from, to, u } = stageAt(v);
    return { x: lerp(stops[from], stops[to], u), lift: Math.sin(Math.PI * u) };
  };
  const x = useTransform(s, (v) => at(v).x - half);
  const y = useTransform(s, (v) => -at(v).lift * 12);
  const rotate = useTransform(s, (v) => at(v).lift * 2.5);

  // A small pop as the card lands on a new stop.
  const pop = useMotionValue(1);
  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const controls = animate(pop, [1, 1.035, 1], { duration: 0.45, ease: GLIDE });
    return () => controls.stop();
  }, [step, pop]);

  const stage = stages[step];
  return (
    <motion.div
      className="absolute bottom-0 left-0 origin-bottom"
      style={{ x, y, rotate, scale: pop }}
    >
      <div className="origin-bottom-left" style={{ transform: `scale(${scale})` }}>
        <FollowedCard
          stage={stage.id}
          data-thread-to="board"
          data-thread-from="deck"
          className="transition-shadow duration-300"
          style={{
            boxShadow: `0 0 0 1.5px color-mix(in oklab, ${stage.color} 55%, transparent), 0 24px 44px -22px rgb(40 20 90 / 0.45)`,
          }}
        />
      </div>
    </motion.div>
  );
}

/** The route: a line through the four stops, filled up to the card, and
 * each stop's node, name and count. */
function Track({ s, step, stops }: { s: MotionValue<number>; step: number; stops: number[] }) {
  const fill = useTransform(s, (v) => {
    const { from, to, u } = stageAt(v);
    return lerp(stops[from], stops[to], u) - stops[0];
  });

  // The burst plays each time the card reaches the offer.
  const [run, setRun] = React.useState(0);
  const [seen, setSeen] = React.useState(step);
  if (seen !== step) {
    setSeen(step);
    if (step === stages.length - 1) setRun((r) => r + 1);
  }

  return (
    <div className="relative mt-4 h-[4.75rem]">
      <div
        aria-hidden="true"
        className="absolute top-[19px] h-0.5 rounded-full bg-slate-200"
        style={{ left: stops[0], width: stops[stops.length - 1] - stops[0] }}
      >
        <motion.div className="bg-brand h-full rounded-full" style={{ width: fill }} />
      </div>
      <ol aria-label="Application stages">
        {stages.map((stage, i) => (
          <Stop
            key={stage.id}
            stage={stage}
            x={stops[i]}
            lit={i <= step}
            current={i === step}
            burst={stage.id === "offer" && i === step ? run : 0}
          />
        ))}
      </ol>
    </div>
  );
}

function Stop({
  stage,
  x,
  lit,
  current,
  burst,
}: {
  stage: Stage;
  x: number;
  lit: boolean;
  current: boolean;
  burst: number;
}) {
  const Icon = stage.icon;
  return (
    <li className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: x }}>
      <span className="relative grid size-10 place-items-center">
        {current && (
          <motion.span
            key={stage.id}
            aria-hidden="true"
            className="ring-brand/50 absolute inset-0 rounded-full ring-2"
            initial={{ scale: 1, opacity: 0.8 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        )}
        <span
          className={cn(
            "relative grid size-full place-items-center rounded-full transition-[background-color,color,box-shadow] duration-300",
            lit
              ? "bg-brand text-white shadow-[0_8px_18px_-8px_rgb(109_63_216/0.8)]"
              : "text-ink-faint bg-white ring-1 ring-slate-900/10",
          )}
        >
          <Icon className="size-[17px]" aria-hidden="true" />
        </span>
        {burst > 0 && <Burst key={burst} color="var(--color-brand)" delay={0.1} />}
      </span>
      <span className="mt-2.5 flex items-center gap-1.5 whitespace-nowrap">
        <span
          className={cn(
            "text-sm font-semibold transition-colors duration-300",
            lit ? "text-ink" : "text-ink-meta",
          )}
        >
          {stage.label}
        </span>
        <span
          className={cn(
            "rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums transition-colors duration-300",
            lit ? "bg-landing-brand-100 text-landing-brand-800" : "bg-surface text-ink-meta",
          )}
        >
          {stage.tally.count} {stage.tally.unit}
        </span>
      </span>
    </li>
  );
}

/**
 * Under each stop, its pile: the first pile full from the start (the roles
 * saved), the others empty slots that fill as the logos that went on fly
 * in from the pile before, a little apart, on an arc.
 */
function Piles({ s, stops }: { s: MotionValue<number>; stops: number[] }) {
  return (
    <div aria-hidden="true" className="relative mt-2" style={{ height: PILE_HEIGHT }}>
      {stages.map((stage, i) =>
        Array.from({ length: stage.tally.count }, (_, j) => {
          const at = slot(j, stage.tally.count);
          return i === 0 ? (
            <span
              key={`${i}-${j}`}
              className="absolute"
              style={{ left: stops[0] + at.x, top: at.y }}
            >
              <LogoTile logo={LOGOS[j]} />
            </span>
          ) : (
            <span
              key={`${i}-${j}`}
              className="absolute size-[22px] rounded-[6px] border border-dashed border-slate-300"
              style={{ left: stops[i] + at.x, top: at.y }}
            />
          );
        }),
      )}
      {stages.slice(1).map((stage, k) => {
        const i = k + 1;
        const count = stage.tally.count;
        const before = stages[i - 1].tally.count;
        return Array.from({ length: count }, (_, j) => {
          const from = slot(j, before);
          const to = slot(j, count);
          return (
            <FlyingTile
              key={`fly-${i}-${j}`}
              s={s}
              index={j}
              count={count}
              stop={i}
              from={{ x: stops[i - 1] + from.x, y: from.y }}
              to={{ x: stops[i] + to.x, y: to.y }}
            />
          );
        });
      })}
    </div>
  );
}

function LogoTile({ logo }: { logo: Logo }) {
  return (
    <FaviconLogo
      domain={logo.domain}
      eager
      className="size-[22px] rounded-[6px] shadow-[0_2px_6px_-2px_rgb(40_20_90/0.25),inset_0_0_0_1px_rgba(76,39,163,0.12)]"
    />
  );
}

/** A logo going on to stop `stop`: it waits on the pile before, over its
 * twin so it cannot be seen, until that pile is reached, then flies. */
function FlyingTile({
  s,
  index,
  count,
  stop,
  from,
  to,
}: {
  s: MotionValue<number>;
  index: number;
  count: number;
  stop: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
}) {
  const stagger = Math.min(0.04, 0.45 / count);
  const at = (v: number) =>
    clamp((arrivalAt(stop, v) - index * stagger) / (1 - (count - 1) * stagger));
  const x = useTransform(s, (v) => lerp(from.x, to.x, at(v)));
  const y = useTransform(s, (v) => lerp(from.y, to.y, at(v)) - Math.sin(Math.PI * at(v)) * 30);
  const opacity = useTransform(s, (v) => (v >= stop - 1 - 1e-6 ? 1 : 0));
  return (
    <motion.span className="absolute top-0 left-0" style={{ x, y, opacity }}>
      <LogoTile logo={LOGOS[index]} />
    </motion.span>
  );
}

/** Below lg, and with reduced motion: the four stops as a list, every
 * pile full, and the application at its offer. */
function StillApplications() {
  return (
    <section id="applications" className="py-20 sm:py-28">
      <div className={CONTAINER}>
        <Heading />
        <div className="mt-10 grid gap-10 lg:grid-cols-[auto_1fr] lg:items-start lg:gap-16">
          <FollowedCard stage="offer" className="max-w-full" />
          <ol aria-label="Application stages" className="space-y-7">
            {stages.map((stage) => {
              const Icon = stage.icon;
              const count = stage.tally.count;
              return (
                <li key={stage.id} className="flex gap-4">
                  <span className="bg-brand grid size-10 shrink-0 place-items-center rounded-full text-white">
                    <Icon className="size-[17px]" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2">
                      <span className="text-ink font-semibold">{stage.label}</span>
                      <span className="bg-landing-brand-100 text-landing-brand-800 rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums">
                        {count} {stage.tally.unit}
                      </span>
                    </p>
                    <p className="text-ink-meta mt-0.5 text-sm text-pretty">{stage.description}</p>
                    <div aria-hidden="true" className="mt-3 flex flex-wrap gap-[5px]">
                      {LOGOS.slice(0, count).map((logo) => (
                        <LogoTile key={logo.domain} logo={logo} />
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
