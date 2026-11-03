import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

import { scoreTone } from "../../score-tone";

/**
 * The deep dives' still scenes (KAN-579): each draws one piece of the real
 * app, with the home tour's student (Alex Morgan) and employers
 * (feature-data.ts), at one fixed size that `DeepDiveStage` scales to its
 * 4:3 panel. They hold still on purpose: the hero above already moves, and
 * a still scene needs no pause control. Every scene is decoration beside
 * text that says the same thing, so it is hidden from assistive technology
 * and draws no heading, button or link (design audit, marketing rule 5).
 * Mock UI here may use any size: `Fit` scales it, and nothing in it is
 * reading text. Whole pixels only.
 */
export const VIGNETTE_W = 400;
export const VIGNETTE_H = 300;

export function Vignette({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("relative flex shrink-0 flex-col justify-center", className)}
      style={{ width: VIGNETTE_W, height: VIGNETTE_H }}
    >
      {children}
    </div>
  );
}

/** A match score's chip, as the tour's cards draw it, held at its value. */
export function Score({ score, className }: { score: number; className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold tabular-nums ring-1 ring-inset",
        scoreTone(score),
        className,
      )}
    >
      {score}%
    </span>
  );
}

/** A small caption over a group in a scene, as the app's section labels. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-ink-muted text-[11px] font-semibold", className)}>{children}</p>;
}
