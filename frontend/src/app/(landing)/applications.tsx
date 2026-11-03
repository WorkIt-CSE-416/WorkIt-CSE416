"use client";

import * as React from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useInView,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";

import { cn } from "@/lib/cn";

import { stages, type Stage } from "./board-data";
import { applicationsSection as copy } from "./data";
import { FaviconLogo } from "./favicon-logo";
import { followedJob } from "./feature-data";
import { FocusIn } from "./focus-in";
import { useLoopsHeld, useMediaQuery } from "./hooks";
import { CONTAINER, SectionHeading, SoonChip } from "./layout-parts";
import { scoreTone } from "./score-tone";
import { useSceneTime, type Cue } from "./scene-time";
import { Burst, stageAt, stepAt } from "./stage-timeline";
import { GLIDE } from "./story";

/**
 * The applications section ("Every application, from saved to signed."): one
 * card, four states. One large application, the one the statement ended on,
 * changes as it moves through Saved, Applied, Interview and Job Offers, and a
 * slim rail beside it shows which it has reached. One thing at a time: it
 * replaced a route with a small card riding a line over piles of logos, where
 * the card, its caption, the line, the piles and their empty slots all pulled
 * at the eye at once.
 *
 * From lg up it pins, and the scroll cues each move, which plays in time
 * (scene-time.ts). Below lg it moves on by itself while it is on screen. With
 * reduced motion it is the card at its last state over the full rail.
 *
 * The card shows only what the tracker keeps: the status, the match score, the
 * resume that went out and the dates. A next step and a deadline per card are
 * not built, so it shows neither. The tracker stores no employer replies, so
 * Interview and Job Offers carry "Coming soon" (`soon` on the stage).
 */

// Tailwind's lg breakpoint: pinned from here up.
const DESKTOP_QUERY = "(min-width: 64rem)";
/** The scroll's cues, as progress through the pinned stretch: the card moves
 * on to each state as the scroll reaches its cue (`to` is the stage), and
 * holds the offer after. */
const CUES: Cue[] = [
  { at: 0.2, to: 1 },
  { at: 0.45, to: 2 },
  { at: 0.7, to: 3 },
];
/** Below lg: how long each state holds, in seconds. */
const HOLD = 3.4;

const LAST = stages.length - 1;

/** The card's facts, each filled in once the application reaches its stage
 * (`from`). `value` takes the stage, for the one fact that changes. */
const FACTS: { label: string; from: number; value: (step: number) => string }[] = [
  {
    label: "Resume",
    from: 0,
    value: (step) =>
      step === 0 ? "Tailored to this posting" : `Alex_Morgan_${followedJob.company}.pdf`,
  },
  { label: "Applied", from: 1, value: () => "Oct 1" },
  { label: "Interview", from: 2, value: () => "Thu, Oct 8" },
  { label: "Offer", from: 3, value: () => "Summer 2027" },
];

export function Applications() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const reduceMotion = useReducedMotion();
  if (reduceMotion || isDesktop === null) return <StillApplications />;
  return isDesktop ? <PinnedApplications /> : <LoopingApplications />;
}

function Heading() {
  return (
    <FocusIn>
      {/* Centred over the card: the sections before it open with a heading
          on the left (KAN-368). */}
      <div className="[@media(max-height:40rem)]:lg:[&_h2+p]:hidden">
        <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />
      </div>
    </FocusIn>
  );
}

/** The card and the rail, side by side from md up. On a phone the card comes
 * first, since it is what the rail reads. */
function Board({
  s,
  step,
  still = false,
}: {
  s: MotionValue<number>;
  step: number;
  still?: boolean;
}) {
  return (
    <div className="mx-auto grid w-full max-w-[60rem] gap-8 md:grid-cols-[16rem_minmax(0,1fr)] md:items-center md:gap-14">
      <Rail s={s} step={step} still={still} />
      <Card s={s} step={step} className="max-md:order-first" />
    </div>
  );
}

function PinnedApplications() {
  const ref = React.useRef<HTMLElement>(null);
  // 0 when the section's top meets the screen's top, 1 when its bottom
  // meets the screen's bottom: the stretch where it is pinned.
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });
  // The card's timeline, in stages: the scroll cues each move, time plays
  // it, about a second and a quarter a stage.
  const s = useSceneTime(p, CUES, { rate: 0.8, longest: 2 });
  const [step, setStep] = React.useState(() => stepAt(s.get()));
  useMotionValueEvent(s, "change", (v) => setStep(stepAt(v)));

  return (
    <section ref={ref} id="applications" className="h-[280vh]">
      <div className="sticky top-0 flex h-dvh flex-col pt-24 pb-8 [@media(max-height:40rem)]:pt-[84px] [@media(max-height:40rem)]:pb-3">
        <div
          className={cn(
            CONTAINER,
            "flex min-h-0 flex-1 flex-col justify-center gap-10 [@media(max-height:50rem)]:gap-6",
          )}
        >
          <Heading />
          <Board s={s} step={step} />
        </div>
      </div>
    </section>
  );
}

/** Below lg, where a pin takes too much of a phone: the states follow one
 * another in time while the card is on screen, then start again. */
function LoopingApplications() {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const held = useLoopsHeld();
  const s = useMotionValue(0);
  const [step, setStep] = React.useState(0);

  React.useEffect(() => {
    if (!inView || held) return;
    const timer = window.setTimeout(
      () => {
        const next = (step + 1) % stages.length;
        setStep(next);
        if (next === 0) s.set(0);
        else animate(s, next, { duration: 1, ease: "linear" });
      },
      // The offer holds a little longer, as the end of the story.
      (step === LAST ? 1.5 : 1) * HOLD * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [inView, held, step, s]);

  return (
    <section id="applications" className="py-20 sm:py-28">
      <div ref={ref} className={cn(CONTAINER, "flex flex-col gap-10")}>
        <Heading />
        <Board s={s} step={step} />
      </div>
    </section>
  );
}

/** With reduced motion, and until the screen's size is known: the card at its
 * last state over the full rail. */
function StillApplications() {
  const s = useMotionValue(LAST);
  return (
    <section id="applications" className="py-20 sm:py-28">
      <div className={cn(CONTAINER, "flex flex-col gap-10")}>
        <Heading />
        <Board s={s} step={LAST} still />
      </div>
    </section>
  );
}

// --- The rail: the four states, one lit at a time ---

/** A slim line through the four states. Every step keeps its height, so the
 * line's fill meets each node and nothing moves as a line of text comes in. */
function Rail({ s, step, still }: { s: MotionValue<number>; step: number; still: boolean }) {
  const scaleY = useTransform(s, (v) => {
    const { from, to, u } = stageAt(v);
    return (from + (to - from) * u) / LAST;
  });
  return (
    <ol aria-label="Application stages" className="relative">
      <span
        aria-hidden="true"
        className="absolute top-5 bottom-[4.25rem] left-[19px] w-0.5 rounded-full bg-slate-200 [@media(max-height:40rem)]:bottom-[3.5rem]"
      >
        <motion.span
          className="bg-brand block h-full w-full origin-top rounded-full will-change-transform"
          style={{ scaleY }}
        />
      </span>
      {stages.map((stage, i) => (
        <RailStep
          key={stage.id}
          stage={stage}
          lit={i <= step}
          current={i === step}
          read={still || i === step}
        />
      ))}
    </ol>
  );
}

function RailStep({
  stage,
  lit,
  current,
  read,
}: {
  stage: Stage;
  lit: boolean;
  current: boolean;
  /** Its line shows. */
  read: boolean;
}) {
  const Icon = stage.icon;
  return (
    <li
      aria-current={current ? "step" : undefined}
      className="relative flex h-[5.75rem] gap-4 [@media(max-height:40rem)]:h-[4.75rem]"
    >
      <span className="relative grid size-10 shrink-0 place-items-center">
        {current && (
          <motion.span
            key={stage.id}
            aria-hidden="true"
            className="ring-brand/50 absolute inset-0 rounded-full ring-2"
            initial={{ scale: 1, opacity: 0.8 }}
            animate={{ scale: 1.7, opacity: 0 }}
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
      </span>
      <div className="min-w-0 pt-2">
        <p className="flex items-center gap-2">
          <span
            className={cn(
              "text-[15px] font-semibold transition-colors duration-300",
              lit ? "text-ink" : "text-ink-meta",
            )}
          >
            {stage.label}
          </span>
          {stage.soon && <SoonChip />}
        </p>
        <p
          className={cn(
            "text-ink-meta mt-0.5 text-sm leading-snug text-pretty transition-opacity duration-300",
            read ? "opacity-100" : "opacity-0",
          )}
        >
          {stage.description}
        </p>
      </div>
    </li>
  );
}

// --- The card: one application, four states ---

/**
 * The application at `step`. Its facts fill in as it reaches them, so it reads
 * as one record that grows, and it lifts a little and settles with each move.
 * The glow behind it takes the stage's colour, one layer per stage, so the
 * colour crossfades.
 */
function Card({
  s,
  step,
  className,
}: {
  s: MotionValue<number>;
  step: number;
  className?: string;
}) {
  const stage = stages[step];
  const StageIcon = stage.icon;
  const y = useTransform(s, (v) => -Math.sin(Math.PI * stageAt(v).u) * 8);

  // A small pop as the card settles into a new state.
  const pop = useMotionValue(1);
  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (step === 0) return;
    const controls = animate(pop, [1, 1.02, 1], { duration: 0.45, ease: GLIDE });
    return () => controls.stop();
  }, [step, pop]);

  return (
    <motion.div aria-hidden="true" className={cn("relative", className)} style={{ y, scale: pop }}>
      {stages.map((item, i) => (
        <span
          key={item.id}
          className="absolute -inset-6 -z-10 rounded-[3rem] blur-3xl transition-opacity duration-700 motion-reduce:transition-none"
          style={{
            background: `color-mix(in oklab, ${item.color} 26%, transparent)`,
            opacity: i === step ? 1 : 0,
          }}
        />
      ))}
      <div className="rounded-[1.75rem] bg-white p-6 shadow-[0_30px_60px_-32px_rgb(40_20_90/0.4)] ring-1 ring-slate-900/5 sm:p-7">
        <div className="flex h-8 items-center justify-between gap-3">
          <span className="relative">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={stage.id}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold whitespace-nowrap",
                  stage.chipClass,
                )}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6, transition: { duration: 0.14 } }}
                transition={{ duration: 0.3, delay: 0.1, ease: GLIDE }}
              >
                <StageIcon className={cn("size-3.5", stage.iconClass)} />
                {stage.cardLabel}
              </motion.span>
            </AnimatePresence>
            {step === LAST && <Burst color="var(--color-positive)" delay={0.2} />}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-lg px-2.5 py-1 text-sm font-bold ring-1 ring-inset",
              scoreTone(followedJob.score),
            )}
          >
            {followedJob.score}% match
          </span>
        </div>

        <div className="mt-5 flex items-center gap-4">
          <FaviconLogo domain={followedJob.domain} eager className="size-14 rounded-2xl" />
          <div className="min-w-0">
            <p className="text-ink text-xl leading-tight font-semibold tracking-tight sm:text-2xl">
              {followedJob.title}
            </p>
            <p className="text-ink-muted mt-1 text-[15px]">{followedJob.company}</p>
          </div>
        </div>

        <dl className="mt-5 divide-y divide-slate-900/5 border-t border-slate-900/5">
          {FACTS.map((fact) => (
            <Fact
              key={fact.label}
              label={fact.label}
              value={step >= fact.from ? fact.value(step) : null}
            />
          ))}
        </dl>
      </div>
    </motion.div>
  );
}

/** One fact: a dash until the application reaches it. */
function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex h-11 items-center justify-between gap-4 text-[15px]">
      <dt className="text-ink-muted shrink-0">{label}</dt>
      <dd className="min-w-0">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={value ?? "none"}
            className={cn("block truncate font-medium", value ? "text-ink" : "text-ink-faint")}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.14 } }}
            transition={{ duration: 0.3, delay: 0.1, ease: GLIDE }}
          >
            {value ?? "—"}
          </motion.span>
        </AnimatePresence>
      </dd>
    </div>
  );
}
