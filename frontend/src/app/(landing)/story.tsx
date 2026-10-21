import * as React from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";

import { cn } from "@/lib/cn";

/**
 * A product tour stop told as a short story that loops a scene at a time,
 * never every step at once (the Resumes and Matching stops). It plays only
 * while in view and starts over each time it comes back. A step bar names
 * the scenes, shows how long the current one has left, and jumps to any of
 * them. With reduced motion it holds one finished scene, `rest`. Rendered
 * by the product tour, whose MotionConfig makes transforms instant for
 * those visitors.
 */

export type StoryScene<Id extends string> = {
  id: Id;
  /** Its label in the step bar. */
  label: string;
  /** The line under the step bar while it plays. */
  caption: string;
  /** How long it holds, in ms. */
  hold: number;
};

/** The tour's travel curve (docs/motion.md, --ease-glide). */
export const GLIDE = [0.16, 1, 0.3, 1] as const;

export function Story<Id extends string>({
  label,
  scenes,
  rest,
  accent,
  stageHeight,
  children,
}: {
  /** The step bar's accessible name, e.g. "Resume steps". */
  label: string;
  scenes: readonly StoryScene<Id>[];
  /** The scene shown, still, with reduced motion. */
  rest: Id;
  /** The step bar's progress line, a background class in the stop's colour. */
  accent: string;
  /** The stage's height in px; every scene draws inside it. */
  stageHeight: number;
  /** Draws the stage for a scene. Wrap scenes in AnimatePresence there. */
  children: (scene: Id) => React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const reduceMotion = useReducedMotion();
  const fillId = React.useId();
  const [step, setStep] = React.useState(0);
  // Bumped on every scene change, so the progress line restarts.
  const [tick, setTick] = React.useState(0);

  const go = React.useCallback((next: number) => {
    setStep(next);
    setTick((t) => t + 1);
  }, []);

  // Start over each time the stop leaves the screen, so it plays from the
  // top when it is back. Set during render, not in an effect.
  const [wasInView, setWasInView] = React.useState(inView);
  if (inView !== wasInView) {
    setWasInView(inView);
    if (!inView) {
      setStep(0);
      setTick((t) => t + 1);
    }
  }

  React.useEffect(() => {
    if (!inView || reduceMotion) return;
    const timer = window.setTimeout(() => go((step + 1) % scenes.length), scenes[step].hold);
    return () => window.clearTimeout(timer);
  }, [inView, reduceMotion, step, tick, go, scenes]);

  const shown = reduceMotion
    ? Math.max(
        0,
        scenes.findIndex((s) => s.id === rest),
      )
    : step;
  const scene = scenes[shown];

  return (
    <div ref={ref} className="flex w-[520px] flex-col items-center gap-3">
      <div
        role="group"
        aria-label={label}
        className="flex w-[380px] gap-1 rounded-full bg-white/60 p-1 ring-1 ring-white/80"
      >
        {scenes.map((s, i) => {
          const active = i === shown;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={active}
              onClick={() => go(i)}
              className={cn(
                "relative flex-1 overflow-hidden rounded-full py-1.5 text-[11px] font-medium transition-colors",
                active ? "text-ink" : "text-ink-meta hover:text-ink",
              )}
            >
              {/* The white fill slides to the current scene. */}
              {active && (
                <motion.span
                  layoutId={fillId}
                  className="absolute inset-0 rounded-full bg-white shadow-sm ring-1 ring-slate-900/5"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              {active && !reduceMotion && (
                <motion.span
                  key={tick}
                  aria-hidden="true"
                  className={cn("absolute bottom-0 left-3 h-0.5 rounded-full", accent)}
                  initial={{ width: 0 }}
                  animate={{ width: "calc(100% - 1.5rem)" }}
                  transition={{ duration: s.hold / 1000, ease: "linear" }}
                />
              )}
              <span className="relative">{s.label}</span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={scene.id}
          className="text-ink-meta h-4 text-center text-xs"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25 }}
        >
          {scene.caption}
        </motion.p>
      </AnimatePresence>

      <div className="relative w-full" style={{ height: stageHeight }}>
        {children(scene.id)}
      </div>
    </div>
  );
}
