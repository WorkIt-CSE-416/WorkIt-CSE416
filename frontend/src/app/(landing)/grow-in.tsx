"use client";

import * as React from "react";
import { easeOut, motion, useReducedMotion, useScroll, useTransform } from "motion/react";

import { useMediaQuery } from "./hooks";

// Tailwind's lg breakpoint: grown from here up.
const DESKTOP_QUERY = "(min-width: 64rem)";

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
  // The top's whole way up the screen, grown by 70% of it (the upper
  // third), as a transform string with array ranges: motion then hands it
  // to the browser as a scroll animation. A function `scale` over
  // ["start end", "start 0.3"], an offset the browser cannot express,
  // repainted the whole panel on every frame.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start start"] });
  const grow = useTransform(scrollYProgress, [0, 0.7], ["scale(0.92)", "scale(1)"], {
    ease: easeOut,
  });
  return (
    <motion.div ref={ref} className={className} style={{ transform: moving ? grow : "none" }}>
      {children}
    </motion.div>
  );
}
