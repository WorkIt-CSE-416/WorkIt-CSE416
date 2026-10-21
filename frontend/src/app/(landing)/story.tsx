import * as React from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";

import { cn } from "@/lib/cn";

/**
 * A product tour stop told as a short story that loops a scene at a time,
 * never every step at once (the Resumes and Matching stops). It plays only
 * while in view and starts over each time it comes back. A glass pill over
 * the stage titles the current scene, numbers it and shows how long it has
 * left; it is not a switcher (the team removed the step bar's buttons).
 * With reduced motion it holds one finished scene, `rest`. Rendered
 * by the product tour, whose MotionConfig makes transforms instant for
 * those visitors.
 */

export type StoryScene<Id extends string> = {
  id: Id;
  /** The scene's title in the pill above the stage. */
  caption: string;
  /** How long it holds, in ms. */
  hold: number;
};

/** The tour's travel curve (docs/motion.md, --ease-glide). */
export const GLIDE = [0.16, 1, 0.3, 1] as const;

export function Story<Id extends string>({
  scenes,
  rest,
  accent,
  stageHeight,
  children,
}: {
  scenes: readonly StoryScene<Id>[];
  /** The scene shown, still, with reduced motion. */
  rest: Id;
  /** The stop's colour, a background class: the scene number and progress line. */
  accent: string;
  /** The stage's height in px; every scene draws inside it. */
  stageHeight: number;
  /** Draws the stage for a scene. Wrap scenes in AnimatePresence there. */
  children: (scene: Id) => React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const reduceMotion = useReducedMotion();
  const [step, setStep] = React.useState(0);
  // Bumped on every scene change, so the progress line restarts.
  const [tick, setTick] = React.useState(0);

  const go = React.useCallback((next: number) => {
    setStep(next);
    setTick((t) => t + 1);
  }, []);

  // Start over each time the stop leaves the screen, so it plays from the
  // top when it is back. Set during render, not in an effect.
  // Bumped each time the stop comes into view, to remount the stage: a
  // scene that plays on mount (the Auto Apply form, the Resumes pile) then
  // starts when it is seen, not when it was first drawn off screen.
  const [pass, setPass] = React.useState(0);
  const [wasInView, setWasInView] = React.useState(inView);
  if (inView !== wasInView) {
    setWasInView(inView);
    if (inView) setPass((p) => p + 1);
    else {
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
    <div ref={ref} className="flex w-[520px] flex-col items-center gap-4">
      {/* The scene's title: a glass pill with its number and a progress
          line, not a switcher. The scenes play on their own. */}
      <div className="glass-card relative flex h-10 w-[380px] items-center gap-2.5 overflow-hidden rounded-full pr-4 pl-1.5">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={scene.id}
            className="flex min-w-0 items-center gap-2.5"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: GLIDE }}
          >
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white tabular-nums shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]",
                accent,
              )}
            >
              {shown + 1}
            </span>
            <span className="text-ink truncate text-[13px] font-semibold tracking-tight">
              {scene.caption}
            </span>
          </motion.span>
        </AnimatePresence>
        <span className="text-ink-meta ml-auto shrink-0 text-[11px] font-medium tabular-nums">
          {shown + 1}/{scenes.length}
        </span>
        {!reduceMotion && (
          <motion.span
            key={tick}
            aria-hidden="true"
            className={cn("absolute bottom-0 left-0 h-[2px] opacity-60", accent)}
            initial={{ width: 0 }}
            animate={{ width: "100%" }}
            transition={{ duration: scene.hold / 1000, ease: "linear" }}
          />
        )}
      </div>

      <div key={pass} className="relative w-full" style={{ height: stageHeight }}>
        {children(scene.id)}
      </div>
    </div>
  );
}
