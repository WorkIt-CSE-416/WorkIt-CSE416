import * as React from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";

import { cn } from "@/lib/cn";

import { FitScale } from "./fit";

/**
 * A product tour stop told as a short story that loops a scene at a time,
 * never every step at once (all four tour stops). It plays only while in
 * view and starts over each time it comes back. A glass pill over the stage
 * titles the current scene and numbers it; it is not a switcher (the team
 * removed the step bar's buttons) and has no progress line (removed too).
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
  /** The stop's colour, a background class: the scene number's disc. */
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
  // Bumped on every scene change, so the scene's timer restarts.
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

  // Where Fit draws the story smaller (a phone draws it at about 0.66),
  // the title grows back by as much, up to the stage's width, so the line
  // that tells the scene stays readable: at the story's own size its 13px
  // caption read at about 8px. Grown from its foot, with the room it takes
  // above it added as margin, so it never covers the stage.
  const fit = React.useContext(FitScale);
  const grow = fit < 1 ? Math.min(1 / fit, 520 / 380) : 1;

  return (
    // shrink-0: as Fit's flex child, the story shrank to its title's 380px,
    // so Fit read that width, scaled it too little, and its 520px scenes
    // spilled past the panel and were cut (KAN-368).
    <div ref={ref} className="flex w-[520px] shrink-0 flex-col items-center gap-4">
      {/* The scene's title: a glass pill with its number, not a switcher.
          The scenes play on their own. */}
      <div
        className="glass-card relative flex h-10 w-[380px] items-center gap-2.5 overflow-hidden rounded-full pr-4 pl-1.5"
        style={
          grow > 1
            ? {
                transform: `scale(${grow})`,
                transformOrigin: "50% 100%",
                marginTop: 40 * (grow - 1),
              }
            : undefined
        }
      >
        {/* The count changes with the number and caption, in the same
            swap: outside it, "2/4" showed beside the last scene's caption. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={scene.id}
            className="flex min-w-0 flex-1 items-center gap-2.5"
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
            {/* Grown, the caption takes the count's room and a size up: at
                13px it still read at about 10.7px on a phone. The disc
                still numbers the scene. */}
            <span
              className={cn(
                "text-ink truncate font-semibold tracking-tight",
                grow > 1 ? "text-[15px]" : "text-[13px]",
              )}
            >
              {scene.caption}
            </span>
            <span
              className={cn(
                "text-ink-muted ml-auto shrink-0 text-[11px] font-medium tabular-nums",
                grow > 1 && "hidden",
              )}
            >
              {shown + 1}/{scenes.length}
            </span>
          </motion.span>
        </AnimatePresence>
      </div>

      <div key={pass} className="relative w-full" style={{ height: stageHeight }}>
        {children(scene.id)}
      </div>
    </div>
  );
}
