"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  type MotionValue,
} from "motion/react";

import { cn } from "@/lib/cn";

import { FaviconLogo } from "./favicon-logo";
import { followedJob, type FeatureId } from "./feature-data";
import { scoreTone } from "./score-tone";
import { GLIDE } from "./story";

/**
 * NOT MOUNTED. The team took this out of the tour for now (2026-10-22): the
 * docked card read as out of place beside the stop's copy. It is kept so
 * it can come back; frontend/CLAUDE.md says how it was wired.
 *
 * The one application the home page follows (followedJob in
 * feature-data.ts), after Twain's habit of carrying one object through the
 * whole page. The hero's Stripe card flies down into the product tour as
 * the visitor scrolls (`JobFlight`) and docks in the tour card as the
 * baton (`TourBaton`): the application, its track through the hero's four
 * words (Tailored, Matched, Applied, Tracked) and what the current stop did
 * to it. So the four stops read as one application moving along, not four
 * separate features.
 */

/** The baton's track: one step per stop, in the tour's order, each named
 * by the hero headline's word for it. */
export const BATON_STEPS: Record<FeatureId, { word: string; status: string }> = {
  resumes: { word: "Tailored", status: "Your resume, tailored to this posting" },
  matching: {
    word: "Matched",
    status: `${followedJob.score}% match, first in Best Match`,
  },
  "auto-apply": { word: "Applied", status: "Every field filled. You clicked Submit." },
  updates: { word: "Tracked", status: "Viewed, an interview, then an offer" },
};

/**
 * The docked card. `steps` is the tour's order with each stop's colour;
 * `at` is the stop on screen. Hidden (but keeping its room) until the
 * flight lands, so the tour's layout never moves.
 */
export function TourBaton({
  steps,
  at,
  shown,
}: {
  steps: { id: FeatureId; color: string }[];
  at: number;
  shown: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const current = steps[at];
  return (
    <div
      className={cn(
        "glass-card text-ink w-full max-w-[22rem] rounded-2xl p-3 transition-opacity duration-200",
        shown ? "opacity-100" : "opacity-0",
      )}
      role="status"
    >
      <JobLine />

      {/* Unfolds from the flying card's height once it lands. */}
      <motion.div
        initial={false}
        animate={shown ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.45, ease: GLIDE }}
        className="overflow-hidden"
      >
        {/* On a short screen the card gives up first its status line, then
            its track, so the stop's copy under it keeps its room. */}
        <div className="relative mt-3 grid grid-cols-4 [@media(max-height:680px)]:hidden">
          <span className="absolute top-[9px] right-[12.5%] left-[12.5%] h-0.5 rounded-full bg-slate-900/8" />
          <motion.span
            className="absolute top-[9px] left-[12.5%] h-0.5 rounded-full"
            style={{
              right: "12.5%",
              background: `linear-gradient(to right, ${steps.map((s) => s.color).join(", ")})`,
            }}
            initial={false}
            animate={{ clipPath: `inset(0 ${(1 - at / (steps.length - 1)) * 100}% 0 0)` }}
            transition={{ duration: reduceMotion ? 0 : 0.5, ease: GLIDE }}
          />
          {steps.map((step, i) => {
            const lit = i <= at;
            return (
              <span key={step.id} className="relative flex flex-col items-center gap-1">
                <span
                  className={cn(
                    "grid size-[18px] place-items-center rounded-full ring-1 ring-slate-900/10 transition-[background-color,scale] duration-300 ring-inset",
                    i === at ? "scale-110" : "scale-100",
                  )}
                  style={{ background: lit ? step.color : "white" }}
                >
                  {lit && <span className="size-1.5 rounded-full bg-white" />}
                </span>
                <span
                  className={cn(
                    "text-[10.5px] font-semibold transition-colors duration-300",
                    lit ? "text-ink" : "text-ink-meta/70",
                  )}
                >
                  {BATON_STEPS[step.id].word}
                </span>
              </span>
            );
          })}
        </div>
        <div className="relative mt-2.5 h-5 overflow-hidden [@media(max-height:820px)]:hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.p
              key={current.id}
              className="text-ink-meta absolute inset-0 truncate text-[12px]"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: GLIDE }}
            >
              {BATON_STEPS[current.id].status}
            </motion.p>
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

/** The job's line: its logo, title, company and match, as on the hero's card. */
function JobLine() {
  return (
    <div className="flex items-center gap-2.5">
      <FaviconLogo domain={followedJob.domain} eager className="size-[30px] rounded-[8px]" />
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-[13px] font-semibold">{followedJob.title}</span>
        <span className="text-ink-meta text-[11px]">{followedJob.company}</span>
      </span>
      <span
        className={cn(
          "rounded-md px-[7px] py-0.5 text-[11px] font-bold shadow-[inset_0_1px_0_rgb(255_255_255/0.8)] ring-1 ring-inset",
          scoreTone(followedJob.score),
        )}
      >
        {followedJob.score}%
      </span>
    </div>
  );
}

const noSubscribe = () => () => {};

/**
 * The hero's card, flying to the tour. `progress` runs 0 to 1 as the tour
 * scrolls up from the bottom of the screen to where it pins; each frame the
 * card sits between the hero's Stripe card (`[data-tag]` in hero-city.tsx)
 * and the dock, both measured live, since both move while the page
 * scrolls. It shows only in flight: at 0 the hero's own card is there, at
 * 1 the docked baton takes over (`onLand`). Fixed in a portal, so no
 * ancestor's transform or overflow clips it on the way.
 */
export function JobFlight({
  progress,
  dock,
  onLand,
}: {
  progress: MotionValue<number>;
  dock: React.RefObject<HTMLElement | null>;
  onLand: (landed: boolean) => void;
}) {
  const reduceMotion = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useMotionValue(0);
  const opacity = useMotionValue(0);
  // True in the browser only: the portal needs document.body.
  const mounted = React.useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

  const landed = React.useRef(false);
  const place = React.useCallback(
    (p: number) => {
      const isLanded = reduceMotion || p >= 0.985;
      if (isLanded !== landed.current) {
        landed.current = isLanded;
        onLand(isLanded);
      }
      if (reduceMotion || p <= 0.02 || isLanded) {
        opacity.set(0);
        return;
      }
      const to = dock.current?.getBoundingClientRect();
      if (!to) return;
      const tag = document.querySelector<HTMLElement>(
        `[data-tag="${followedJob.company}"] [data-card]`,
      );
      const from = tag?.getBoundingClientRect() ?? {
        left: window.innerWidth * 0.2,
        top: window.innerHeight * 0.2,
      };
      // Ease in and out along the way, with a lift in the middle, so it
      // arcs rather than sliding in a straight line.
      const t = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      const lift = Math.sin(Math.PI * t) * -60;
      x.set(from.left + (to.left - from.left) * t);
      y.set(from.top + (to.top - from.top) * t + lift);
      rotate.set(Math.sin(Math.PI * t) * -4);
      opacity.set(Math.min(1, p / 0.08));
    },
    [dock, onLand, opacity, reduceMotion, rotate, x, y],
  );

  useMotionValueEvent(progress, "change", place);
  // Place it once on mount too, for a page opened part way down.
  React.useEffect(() => place(progress.get()), [place, progress]);

  if (!mounted || reduceMotion) return null;
  return createPortal(
    <motion.div
      aria-hidden="true"
      className="glass-card text-ink pointer-events-none fixed top-0 left-0 z-40 w-[22rem] rounded-2xl p-3"
      style={{ x, y, rotate, opacity }}
    >
      <JobLine />
    </motion.div>,
    document.body,
  );
}
