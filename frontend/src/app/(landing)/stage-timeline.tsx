"use client";

import * as React from "react";
import {
  AnimatePresence,
  MotionConfig,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "motion/react";

import { cn } from "@/lib/cn";

import { stages } from "./board-data";
import { GLIDE } from "./story";

/** Each row's height in px. The track and its fill are measured in rows. */
export const ROW = 84;
/** The node's size in px; the track runs through the nodes' centres. */
const NODE = 44;
/** The share of each stage's stretch of scroll spent gliding to the next
 * stage; the rest holds, so a stage can be read. */
const SPAN = 0.6;

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Where the timeline is at `s` (0 at Saved to 3 at Job Offers): between
 * stage `from` and stage `to`, `u` of the way. Everything that moves with
 * the stages (the fill, the highlight, the board's card) holds at a stage,
 * then glides to the next, arriving as `s` reaches it.
 */
export function stageAt(s: number) {
  const to = Math.min(stages.length - 1, Math.floor(s) + 1);
  const from = to - 1;
  return { from, to, u: ease(clamp((s - from - (1 - SPAN)) / SPAN)) };
}

/** The stage `s` has reached: lit, and the board's card on its column. */
export function stepAt(s: number) {
  return Math.min(stages.length - 1, Math.floor(s + 1e-6));
}

/**
 * The applications section's stage list, told as one search moving from
 * saved to signed: a track fills from stage to stage, each node lights up
 * in its stage's colour as the fill reaches it, a glass highlight slides
 * to the current stage, and its tally counts up. At the offer, a small
 * burst. The scroll drives it (`s`, from the pinned section in
 * applications.tsx), nothing runs on a timer; with no `s` (below lg,
 * reduced motion) every stage shows lit, still.
 */
export function StageTimeline({
  s,
  step = stages.length - 1,
  row = ROW,
}: {
  s: MotionValue<number> | null;
  step?: number;
  row?: number;
}) {
  const reduceMotion = useReducedMotion();
  const still = !s || !!reduceMotion;
  const shown = still ? stages.length - 1 : step;
  const trackStops = stages.map((stage) => stage.color).join(", ");
  const at = (v: number) => {
    const { from, u } = stageAt(v);
    return from + u;
  };
  const fallback = useMotionValue(stages.length - 1);
  const source = s ?? fallback;
  const fill = useTransform(source, (v) => (still ? stages.length - 1 : at(v)) * row);

  // The burst plays each time the fill reaches the offer.
  const [run, setRun] = React.useState(0);
  const [lastShown, setLastShown] = React.useState(shown);
  if (shown !== lastShown) {
    setLastShown(shown);
    if (shown === stages.length - 1) setRun((r) => r + 1);
  }

  return (
    <MotionConfig reducedMotion="user">
      <ol className="relative isolate mt-10" aria-label="Application stages">
        {/* The track, through the nodes' centres, and its fill. */}
        <div
          aria-hidden="true"
          className="absolute w-[3px] rounded-full bg-slate-200/80"
          style={{
            left: NODE / 2 - 1.5,
            top: NODE / 2,
            height: (stages.length - 1) * row,
          }}
        >
          <motion.div
            className="relative w-full rounded-full"
            style={{
              height: fill,
              background: `linear-gradient(to bottom, ${trackStops})`,
              backgroundSize: `100% ${(stages.length - 1) * row}px`,
            }}
          >
            {/* The comet at the fill's head. */}
            <span
              className="absolute -bottom-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-white transition-shadow duration-300"
              style={{
                boxShadow: `0 0 0 2px ${stages[shown].color}, 0 0 12px 3px ${stages[shown].color}`,
              }}
            />
          </motion.div>
        </div>

        {/* The glass highlight, sliding with the fill to the current stage. */}
        <motion.span
          aria-hidden="true"
          className="glass-card absolute -inset-x-3 -top-2.5 -z-10 rounded-2xl"
          style={{ y: fill, height: row + 2 }}
        />

        {stages.map((stage, index) => {
          const Icon = stage.icon;
          const lit = index <= shown;
          const current = index === shown;
          return (
            <li key={stage.id} className="relative flex gap-4" style={{ height: row }}>
              <span className="relative shrink-0" style={{ width: NODE, height: NODE }}>
                {/* A ring that ripples out from the current node. */}
                {current && !still && (
                  <motion.span
                    key={`ripple-${index}`}
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full"
                    style={{ boxShadow: `0 0 0 2px ${stage.color}` }}
                    initial={{ scale: 1, opacity: 0.6 }}
                    animate={{ scale: 1.7, opacity: 0 }}
                    transition={{ duration: 1.2, ease: "easeOut", repeat: Infinity }}
                  />
                )}
                {/* CSS transitions, not motion: the colours are CSS variables,
                    which motion cannot tween. */}
                <span
                  className={cn(
                    "relative grid size-full place-items-center rounded-full ring-1 ring-slate-900/8 transition-[background-color,color,box-shadow,scale] duration-300 ring-inset motion-reduce:transition-none",
                    current && !still ? "scale-108" : "scale-100",
                  )}
                  style={{
                    background: lit ? stage.color : "white",
                    color: lit ? "white" : "#94a3b8",
                    boxShadow: lit ? `0 8px 20px -8px ${stage.color}` : undefined,
                  }}
                >
                  <Icon className="size-[18px]" aria-hidden="true" />
                </span>
                {stage.id === "offer" && current && !still && run > 0 && (
                  <Burst key={`burst-${run}`} color={stage.color} delay={0.1} />
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
                  <Tally stage={stage} lit={lit} instant={still} />
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
    if (instant) {
      value.set(stage.tally.count);
      return;
    }
    const controls = lit
      ? animate(value, stage.tally.count, { duration: 0.8, ease: GLIDE })
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
          transition={{ duration: 0.3 }}
        >
          <motion.span>{text}</motion.span>
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** A few sparks flying out of an offer: the timeline's node, and the
 * Updates stop's offer. `delay` waits for whatever brought the offer in. */
export function Burst({ color, delay = 0.55 }: { color: string; delay?: number }) {
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
            transition={{ delay, duration: 0.9, ease: "easeOut" }}
          />
        );
      })}
    </span>
  );
}
