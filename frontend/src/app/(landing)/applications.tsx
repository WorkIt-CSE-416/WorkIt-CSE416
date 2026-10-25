"use client";

import * as React from "react";
import {
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
import { CONTAINER, SectionHeading, SoonChip } from "./layout-parts";
import { useSceneTime, type Cue } from "./scene-time";
import { Burst, arrivalAt, stageAt, stepAt } from "./stage-timeline";
import { GLIDE } from "./story";
import { CARD_WIDTH, FollowedCard } from "./thread";

/**
 * The applications section ("Every application, from saved to signed."),
 * drawn as one search's route. Four stops run across the section (Saved,
 * Applied, Interview, Job Offers), and under each a pile of company logos
 * counts the search down: 24 roles saved, 12 sent, 4 in play, 1 signed.
 * From lg up it pins: the followed application, the one the statement
 * ended on, waits on the first stop, then rides the route stop by stop,
 * its stage and next step changing as it lands, while the logos
 * that go on fly from one pile to the next and the ones left close up. The scroll cues each move and
 * the move plays in time (scene-time.ts), so the card never stops between
 * two stops. At the last stop it is the one offer, where its trip down
 * the page ends.
 * Below lg, and with reduced motion, it is the still version: the four
 * stops as a list with every pile full.
 */

// Tailwind's lg breakpoint: pinned from here up.
const DESKTOP_QUERY = "(min-width: 64rem)";
/** Laptop screens 800px tall or less draw the card smaller, so the
 * heading, the route and the piles fit under the header. */
const SHORT_QUERY = "(max-height: 50rem)";
/** The scroll's cues, as progress through the pinned stretch: the card
 * moves on to each stop as the scroll reaches its cue (`to` is the stop),
 * and holds the offer after. */
const CUES: Cue[] = [
  { at: 0.2, to: 1 },
  { at: 0.45, to: 2 },
  { at: 0.7, to: 3 },
];
/** A logo tile's size and the gap between tiles in a pile, in px. Change
 * TILE with the tile's `size-[22px]` class. */
const TILE = 22;
const TILE_GAP = 5;
/** Tiles in a pile's row. */
const PER_ROW = 8;
/** The card's tallest look at full size, in px: its track's height. */
const CARD_HEIGHT = 222;

type Logo = { company: string; domain: string };

/**
 * The search's roles, furthest first: the followed application, then the
 * board's interviews, applications and saved roles, then Matching's and the
 * hiring-systems stream's postings. The first `stages[i].tally.count`
 * reach stop `i`, so every logo that reaches a stop came from the pile
 * before it, and the last one standing is the followed application.
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

const COUNTS = stages.map((stage) => stage.tally.count);
/** The last stop logo `j` reaches. */
const lastStop = (j: number) => COUNTS.findLastIndex((count) => j < count);
/** The logos left at stop `i` once the route has gone past it, as a range
 * of LOGOS: the ones that went no further. */
const leftAt = (i: number): [number, number] => [COUNTS[i + 1] ?? 0, COUNTS[i]];

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
  // The section coming up from the screen's foot to its pin.
  const { scrollYProgress: entry } = useScroll({
    target: ref,
    offset: ["start end", "start start"],
  });
  // The route's timeline, in stops: the scroll cues each move, time plays
  // it, about a second and a quarter a stop.
  const s = useSceneTime(p, CUES, { rate: 0.8, longest: 2 });
  const [step, setStep] = React.useState(() => stepAt(s.get()));
  useMotionValueEvent(s, "change", (v) => setStep(stepAt(v)));
  // The stop the card rests on, if it rests, once the section has pinned:
  // the stop's caption shows only then.
  const [resting, setResting] = React.useState(() => restingAt(s.get()));
  useMotionValueEvent(s, "change", (v) => setResting(restingAt(v)));
  const [landed, setLanded] = React.useState(() => entry.get() >= 0.985);
  useMotionValueEvent(entry, "change", (v) => setLanded(v >= 0.985));

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
      <div className="sticky top-0 flex h-dvh flex-col pt-24 pb-8">
        <div className={cn(CONTAINER, "flex min-h-0 flex-1 flex-col justify-center")}>
          <Heading />

          <div ref={routeRef} className="relative isolate mt-8 shrink-0">
            {/* A faint dot grid under the route, like a map's. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-x-8 -inset-y-6 -z-10 bg-[radial-gradient(circle,rgb(15_23_42/0.09)_1px,transparent_1.2px)] [mask-image:radial-gradient(70%_80%_at_50%_55%,black,transparent)] [background-size:22px_22px]"
            />
            {width > 0 && (
              <>
                <div className="relative" style={{ height: CARD_HEIGHT * scale + 14 }}>
                  {stages.map((stage, i) => (
                    <RouteCaption
                      key={stage.id}
                      index={i}
                      stop={stops[i]}
                      scale={scale}
                      shown={landed && resting === i}
                    />
                  ))}
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

/** The captions' width, and their gap from the card, in px. */
const CAPTION_W = 240;
const CAPTION_GAP = 36;

/** The stop the route rests on at `v`, or null while the card moves. */
const restingAt = (v: number) => (Math.abs(v - Math.round(v)) < 1e-3 ? Math.round(v) : null);

/**
 * One stop's line, beside the card while it rests there: right of the card
 * at the first two stops, left of it at the last two, where the route ends.
 * Each stop has its own caption, fixed at that stop, which fades in once
 * the card has landed (so it matches the card's new stage) and out as soon
 * as it moves on. So no caption changes its words, or its side, while it
 * can be seen: one caption that swapped both as the card landed glitched,
 * since the card's stage changes at the landing.
 */
function RouteCaption({
  index,
  stop,
  scale,
  shown,
}: {
  index: number;
  stop: number;
  scale: number;
  shown: boolean;
}) {
  const half = (CARD_WIDTH * scale) / 2;
  const right = index < 2;
  const stage = stages[index];

  return (
    <motion.div
      className="absolute bottom-0 flex items-center"
      style={{
        left: right ? stop + half + CAPTION_GAP : stop - half - CAPTION_GAP - CAPTION_W,
        width: CAPTION_W,
        height: CARD_HEIGHT * scale,
      }}
      initial={false}
      // In just after the card's landing pop, out at once as it moves on.
      animate={shown ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
      transition={
        shown ? { duration: 0.35, delay: 0.15, ease: GLIDE } : { duration: 0.15, ease: "easeOut" }
      }
    >
      {/* A short rule back towards the card. */}
      <span
        aria-hidden="true"
        className={cn("absolute top-1/2 h-px w-5 bg-slate-300", right ? "-left-7" : "-right-7")}
      />
      <div className={cn("w-full", right ? "text-left" : "text-right")}>
        <p
          className={cn(
            "text-landing-brand-700 flex items-center gap-2 text-sm font-semibold tabular-nums",
            right ? "justify-start" : "justify-end",
          )}
        >
          {String(index + 1).padStart(2, "0")} · {stage.label}
          {stage.soon && <SoonChip />}
        </p>
        <p className="text-ink mt-1 text-xl leading-snug font-medium text-balance">
          {stage.description}
        </p>
      </div>
    </motion.div>
  );
}

/**
 * The followed application riding the route. It holds at its stop, then
 * glides to the next with a small lift and lean, and pops as it lands with
 * the new stage on it.
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
  // One pose a frame, each part read from it.
  const pose = useTransform(s, (v) => {
    const { from, to, u } = stageAt(v);
    return { x: lerp(stops[from], stops[to], u), lift: Math.sin(Math.PI * u) };
  });
  const x = useTransform(pose, ({ x }) => x - half);
  const y = useTransform(pose, ({ lift }) => -lift * 12);
  const rotate = useTransform(pose, ({ lift }) => lift * 2.5);

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
      className="absolute bottom-0 left-0 origin-bottom will-change-transform"
      style={{ x, y, rotate, scale: pop }}
    >
      <div className="origin-bottom-left" style={{ transform: `scale(${scale})` }}>
        <FollowedCard
          stage={stage.id}
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
  // The fill is the whole line, scaled from its left end: a width set on
  // every frame laid the route out again each time.
  const length = stops[stops.length - 1] - stops[0];
  const fill = useTransform(s, (v) => {
    const { from, to, u } = stageAt(v);
    return (lerp(stops[from], stops[to], u) - stops[0]) / length;
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
        style={{ left: stops[0], width: length }}
      >
        <motion.div
          className="bg-brand h-full origin-left rounded-full will-change-transform"
          style={{ scaleX: fill }}
        />
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
            lit ? "bg-landing-brand-100 text-landing-brand-800" : "bg-surface text-ink-muted",
          )}
        >
          {stage.tally.count} {stage.tally.unit}
        </span>
      </span>
    </li>
  );
}

/**
 * Under each stop, its pile. Each logo is drawn once and moves: the first
 * pile is full from the start (the roles saved); as the card glides to a
 * stop, the logos that go on fly there from the pile before, a little
 * apart, on an arc, and the ones that went no further close up behind
 * them. The stops ahead show dashed slots where the logos will land. A
 * copy of each logo once flew on and left its twin behind, so a role sat
 * in two piles at once (KAN-368).
 */
function Piles({ s, stops }: { s: MotionValue<number>; stops: number[] }) {
  return (
    <div aria-hidden="true" className="relative mt-2" style={{ height: PILE_HEIGHT }}>
      {stages.slice(1).map((stage, k) => (
        <Slots key={stage.id} s={s} stop={k + 1} left={stops[k + 1]} />
      ))}
      {LOGOS.map((logo, j) => (
        <MovingTile key={logo.domain} s={s} index={j} stops={stops} />
      ))}
    </div>
  );
}

/** The dashed slots of a stop ahead, gone once its logos have landed. */
function Slots({ s, stop, left }: { s: MotionValue<number>; stop: number; left: number }) {
  const opacity = useTransform(s, (v) => 1 - arrivalAt(stop, v));
  return (
    <motion.div className="absolute inset-0" style={{ opacity }}>
      {Array.from({ length: COUNTS[stop] }, (_, j) => {
        const at = slot(j, COUNTS[stop]);
        return (
          <span
            key={j}
            className="absolute size-[22px] rounded-[6px] border border-dashed border-slate-300"
            style={{ left: left + at.x, top: at.y }}
          />
        );
      })}
    </motion.div>
  );
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * One logo, where the route has taken it at `s`: for each glide up to its
 * last stop it flies from its slot in the pile before to its slot in the
 * next; on the glide after, it closes up in the pile it stays in, once the
 * ones going on have left it.
 */
function MovingTile({
  s,
  index,
  stops,
}: {
  s: MotionValue<number>;
  index: number;
  stops: number[];
}) {
  const last = lastStop(index);
  // One pose a frame, as one transform.
  const transform = useTransform(s, (v) => {
    const at = slot(index, COUNTS[0]);
    let x = stops[0] + at.x;
    let y = at.y;
    for (let i = 1; i < stages.length; i++) {
      const a = arrivalAt(i, v);
      if (a === 0) break;
      if (i <= last) {
        const count = COUNTS[i];
        const stagger = Math.min(0.04, 0.45 / count);
        const t = clamp((a - index * stagger) / (1 - (count - 1) * stagger));
        const to = slot(index, count);
        x = lerp(x, stops[i] + to.x, t);
        y = lerp(y, to.y, t) - Math.sin(Math.PI * t) * 30;
      } else if (i === last + 1) {
        const [from, until] = leftAt(last);
        const to = slot(index - from, until - from);
        const t = ease(clamp((a - 0.35) / 0.65));
        x = lerp(x, stops[last] + to.x, t);
        y = lerp(y, to.y, t);
      }
    }
    return `translate(${x}px, ${y}px)`;
  });
  return (
    <motion.span className="absolute top-0 left-0 will-change-transform" style={{ transform }}>
      <LogoTile logo={LOGOS[index]} />
    </motion.span>
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

/** Logos a still pile shows before the rest become a count. */
const STILL_PILE = 7;

/** Below lg, and with reduced motion: the four stops as a list, each
 * with the logos left there at the end of the route, and the application
 * at its offer. */
function StillApplications() {
  return (
    <section id="applications" className="py-20 sm:py-28">
      <div className={CONTAINER}>
        <Heading />
        <div className="mt-10 grid gap-10 lg:grid-cols-[auto_1fr] lg:items-start lg:gap-16">
          <FollowedCard stage="offer" className="max-w-full" />
          <ol aria-label="Application stages" className="space-y-7">
            {stages.map((stage, i) => {
              const Icon = stage.icon;
              const count = stage.tally.count;
              // Each logo once, where it ended up, as on the pinned route.
              const left = LOGOS.slice(...leftAt(i));
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
                      {stage.soon && <SoonChip />}
                    </p>
                    <p className="text-ink-meta mt-0.5 text-sm text-pretty">{stage.description}</p>
                    {/* Seven at most, then the rest as a count: the full
                        piles (24, 12) ran to three rows of 16px tiles that
                        read as noise on a phone (KAN-368). */}
                    <div aria-hidden="true" className="mt-3 flex flex-wrap items-center gap-[5px]">
                      {left.slice(0, STILL_PILE).map((logo) => (
                        <LogoTile key={logo.domain} logo={logo} />
                      ))}
                      {left.length > STILL_PILE && (
                        <span className="text-ink-meta ml-1 text-xs font-medium tabular-nums">
                          +{left.length - STILL_PILE}
                        </span>
                      )}
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
