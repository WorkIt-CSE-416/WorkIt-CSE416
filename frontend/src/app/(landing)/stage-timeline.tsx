"use client";

import * as React from "react";
import {
  AnimatePresence,
  MotionConfig,
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";

import { cn } from "@/lib/cn";

import { stages } from "./board-data";
import { GLIDE } from "./story";

/** Each row's height in px. The track and its fill are measured in rows. */
const ROW = 84;
/** The node's size in px; the track runs through the nodes' centres. */
const NODE = 44;
/** How long each stage holds before the next lights up, in ms. */
const STEP_MS = 1700;
/** How long the finished search holds before it starts over, in ms. */
const DONE_MS = 3600;

/**
 * The applications section's stage list, told as one search moving from
 * saved to signed: a track fills from stage to stage, each node lights up
 * in its stage's colour as the fill reaches it, a glass highlight slides
 * to the current stage, and its tally counts up. At the offer, a small
 * burst. It plays only in view and starts over each time it comes back;
 * with reduced motion every stage shows lit, still.
 */
export function StageTimeline() {
  const ref = React.useRef<HTMLOListElement>(null);
  const inView = useInView(ref, { amount: 0.5 });
  const reduceMotion = useReducedMotion();
  const [step, setStep] = React.useState(0);
  // Bumped on each new run, so the burst plays again.
  const [run, setRun] = React.useState(0);

  // Start over each time the list leaves the screen. Set during render, not
  // in an effect.
  const [wasInView, setWasInView] = React.useState(inView);
  if (inView !== wasInView) {
    setWasInView(inView);
    if (!inView) setStep(0);
  }

  React.useEffect(() => {
    if (!inView || reduceMotion) return;
    const last = step === stages.length - 1;
    const timer = window.setTimeout(
      () => {
        if (last) setRun((r) => r + 1);
        setStep(last ? 0 : step + 1);
      },
      last ? DONE_MS : STEP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [inView, reduceMotion, step]);

  const shown = reduceMotion ? stages.length - 1 : step;
  const trackStops = stages.map((s) => s.color).join(", ");

  return (
    <MotionConfig reducedMotion="user">
      <ol ref={ref} className="relative isolate mt-10" aria-label="Application stages">
        {/* The track, through the nodes' centres, and its fill. */}
        <div
          aria-hidden="true"
          className="absolute w-[3px] rounded-full bg-slate-200/80"
          style={{
            left: NODE / 2 - 1.5,
            top: NODE / 2,
            height: (stages.length - 1) * ROW,
          }}
        >
          <motion.div
            className="relative w-full rounded-full"
            style={{
              background: `linear-gradient(to bottom, ${trackStops})`,
              backgroundSize: `100% ${(stages.length - 1) * ROW}px`,
            }}
            initial={false}
            animate={{ height: shown * ROW }}
            transition={{ duration: 0.7, ease: GLIDE }}
          >
            {/* The comet at the fill's head. */}
            <span
              className="absolute -bottom-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-white"
              style={{
                boxShadow: `0 0 0 2px ${stages[shown].color}, 0 0 12px 3px ${stages[shown].color}`,
              }}
            />
          </motion.div>
        </div>

        {stages.map((stage, index) => {
          const Icon = stage.icon;
          const lit = index <= shown;
          const current = index === shown;
          return (
            <li key={stage.id} className="relative flex gap-4" style={{ height: ROW }}>
              {/* The glass highlight slides to the current stage. */}
              {current && (
                <motion.span
                  layoutId="stage-highlight"
                  aria-hidden="true"
                  className="glass-card absolute -inset-x-3 -top-2.5 -z-10 rounded-2xl"
                  style={{ height: NODE + 20 + 22 }}
                  transition={{ duration: 0.6, ease: GLIDE }}
                />
              )}

              <span className="relative shrink-0" style={{ width: NODE, height: NODE }}>
                {/* A ring that ripples out from the current node. */}
                {current && !reduceMotion && (
                  <motion.span
                    key={`ripple-${run}-${index}`}
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full"
                    style={{ boxShadow: `0 0 0 2px ${stage.color}` }}
                    initial={{ scale: 1, opacity: 0.6 }}
                    animate={{ scale: 1.7, opacity: 0 }}
                    transition={{ delay: 0.45, duration: 1.2, ease: "easeOut", repeat: Infinity }}
                  />
                )}
                {/* CSS transitions, not motion: the colours are CSS variables,
                    which motion cannot tween. */}
                <span
                  className={cn(
                    "relative grid size-full place-items-center rounded-full ring-1 ring-slate-900/8 transition-[background-color,color,box-shadow,scale] duration-300 ring-inset motion-reduce:transition-none",
                    current ? "scale-108" : "scale-100",
                  )}
                  style={{
                    background: lit ? stage.color : "white",
                    color: lit ? "white" : "#94a3b8",
                    boxShadow: lit ? `0 8px 20px -8px ${stage.color}` : undefined,
                    // Lights as the fill arrives.
                    transitionDelay: lit && current ? "450ms" : "0ms",
                  }}
                >
                  <Icon className="size-[18px]" aria-hidden="true" />
                </span>
                {stage.id === "offer" && current && !reduceMotion && (
                  <Burst key={`burst-${run}`} color={stage.color} />
                )}
              </span>

              <div className="min-w-0 pt-1">
                <p className="flex items-center gap-2">
                  <span
                    className={cn(
                      "font-semibold transition-colors duration-500",
                      lit ? "text-ink" : "text-ink-meta",
                    )}
                  >
                    {stage.label}
                  </span>
                  <Tally stage={stage} lit={lit} instant={!!reduceMotion} />
                </p>
                <p className="text-ink-meta mt-0.5 text-sm text-pretty">{stage.description}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </MotionConfig>
  );
}

/** A stage's count, counting up from nothing when it lights. */
function Tally({
  stage,
  lit,
  instant,
}: {
  stage: (typeof stages)[number];
  lit: boolean;
  instant: boolean;
}) {
  const value = useMotionValue(instant ? stage.tally.count : 0);
  const text = useTransform(value, (v) => `${Math.round(v)} ${stage.tally.unit}`);
  React.useEffect(() => {
    if (instant) return;
    const controls = lit
      ? animate(value, stage.tally.count, { delay: 0.45, duration: 0.8, ease: GLIDE })
      : animate(value, 0, { duration: 0.2 });
    return () => controls.stop();
  }, [lit, instant, value, stage.tally.count]);

  return (
    <AnimatePresence initial={false}>
      {lit && (
        <motion.span
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
          style={{
            color: stage.ink,
            background: `color-mix(in oklab, ${stage.color} 14%, white)`,
          }}
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
          transition={{ delay: instant ? 0 : 0.45, duration: 0.3 }}
        >
          <motion.span>{text}</motion.span>
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** A few sparks flying out of an offer: the timeline's node, and the
 * Updates stop's offer. */
export function Burst({ color }: { color: string }) {
  const sparks = 10;
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      {Array.from({ length: sparks }, (_, i) => {
        const angle = (i / sparks) * Math.PI * 2;
        const distance = 34 + (i % 3) * 8;
        return (
          <motion.span
            key={i}
            className="absolute top-1/2 left-1/2 rounded-full"
            style={{
              width: i % 2 ? 5 : 4,
              height: i % 2 ? 5 : 4,
              marginLeft: -2,
              marginTop: -2,
              background: i % 3 === 0 ? "#f2a516" : color,
            }}
            initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
            animate={{
              x: Math.cos(angle) * distance,
              y: Math.sin(angle) * distance,
              opacity: [0, 1, 0],
              scale: [0.4, 1, 0.6],
            }}
            transition={{ delay: 0.55, duration: 0.9, ease: "easeOut" }}
          />
        );
      })}
    </span>
  );
}
