"use client";

import { motion } from "motion/react";

import { stages } from "./board-data";

/**
 * The applications section's stage math, and the offer's burst. The
 * section (applications.tsx) reads the scroll as `s`, from 0 at Saved to 3
 * at Job Offers; everything that moves with the stages (the card on the
 * route, the route's fill, the logos flying between piles) reads `stageAt`,
 * so they hold at a stage, glide to the next, and arrive together.
 */

/** The share of each stage's stretch of scroll spent gliding to the next
 * stage; the rest holds, so a stage can be read. */
const SPAN = 0.6;

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Where the stages are at `s`: between stage `from` and stage `to`, `u`
 * of the way, eased. */
export function stageAt(s: number) {
  const to = Math.min(stages.length - 1, Math.floor(s) + 1);
  const from = to - 1;
  return { from, to, u: ease(clamp((s - from - (1 - SPAN)) / SPAN)) };
}

/** How far the glide into stage `i` has gone at `s`: 0 before it starts,
 * 1 once `s` reaches `i`. */
export function arrivalAt(i: number, s: number) {
  if (s >= i) return 1;
  const { from, u } = stageAt(s);
  return from === i - 1 ? u : 0;
}

/** The stage `s` has reached. */
export function stepAt(s: number) {
  return Math.min(stages.length - 1, Math.floor(s + 1e-6));
}

/** A few sparks flying out of an offer: the route's last stop, and the
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
