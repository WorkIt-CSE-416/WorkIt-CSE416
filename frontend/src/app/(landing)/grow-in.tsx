"use client";

import * as React from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";

import { useMediaQuery } from "./hooks";

// Tailwind's lg breakpoint: grown from here up.
const DESKTOP_QUERY = "(min-width: 64rem)";

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const out = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * A rounded panel that grows into place as it scrolls up the screen, like
 * the product tour's: from 92% as its top meets the screen's foot to full
 * size by the time it reaches the upper third. Only a scale, so the glass
 * inside still blurs (a fade or filter on it would make it a backdrop
 * root). From lg up and without reduced motion; otherwise it sits still.
 */
export function GrowIn({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const reduceMotion = useReducedMotion();
  const moving = isDesktop === true && !reduceMotion;
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start 0.3"] });
  const scale = useTransform(scrollYProgress, (v) => (moving ? 0.92 + 0.08 * out(clamp(v)) : 1));
  return (
    <motion.div ref={ref} className={className} style={{ scale }}>
      {children}
    </motion.div>
  );
}
