"use client";

import { MotionConfig } from "motion/react";
import { useRef, type ReactNode } from "react";

import { Fit } from "../fit";

/**
 * Wraps a whole feature page, as `ProductTour` wraps the tour: the
 * animations expect `reducedMotion="user"`, which makes their transforms
 * instant for visitors who prefer reduced motion.
 */
export function FeatureMotion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/**
 * A feature page's animation, shown large: `Fit` scales the 520px-wide
 * story to the stage's height and width, up to 1.5x, as in the pinned tour.
 */
export function FeatureStage({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={box}
      className="flex h-[26rem] items-center justify-center overflow-hidden p-4 sm:h-[36rem] sm:p-6 lg:h-[clamp(36rem,calc(100dvh-9rem),48rem)]"
    >
      <Fit box={box}>{children}</Fit>
    </div>
  );
}
