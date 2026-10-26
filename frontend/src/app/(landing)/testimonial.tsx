"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { testimonial } from "./data";
import { useArrived, useMediaQuery } from "./hooks";

// Tailwind's lg breakpoint: revealed from here up.
const DESKTOP_QUERY = "(min-width: 64rem)";
/** Each word's start after the one before, in seconds. */
const WORD_STEP = 0.045;

/**
 * The testimonial, read word by word: once it is well on screen each word
 * of the quote comes up from faint in turn, in time, then the name comes
 * in. Scrubbed by the scroll it rested half read whenever the reader
 * stopped (scene-time.ts). Its copy is still the site's placeholder
 * (data.ts); never fill it with an invented quote, name or number. Below lg
 * and with reduced motion it is the finished frame.
 */
export function Testimonial() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const reduceMotion = useReducedMotion();
  const ref = React.useRef<HTMLElement>(null);
  const read = useArrived(ref, isDesktop === true && !reduceMotion, {
    margin: "0px 0px -25% 0px",
  });
  const words = React.useMemo(() => `“${testimonial.quote}”`.split(" "), []);

  return (
    <figure ref={ref} className="mx-auto max-w-3xl text-center">
      <blockquote className="text-ink text-2xl leading-[1.3] font-medium tracking-tight text-balance sm:text-3xl">
        <p>
          {words.map((word, i) => (
            <React.Fragment key={i}>
              <motion.span
                initial={false}
                animate={{ opacity: read ? 1 : 0.18 }}
                transition={{ duration: 0.4, delay: read ? i * WORD_STEP : 0 }}
              >
                {word}
              </motion.span>{" "}
            </React.Fragment>
          ))}
        </p>
      </blockquote>
      <motion.figcaption
        className="mt-8"
        initial={false}
        animate={{ opacity: read ? 1 : 0 }}
        transition={{ duration: 0.5, delay: read ? words.length * WORD_STEP + 0.15 : 0 }}
      >
        <p className="text-ink font-semibold">{testimonial.name}</p>
        <p className="text-ink-meta text-sm">{testimonial.role}</p>
      </motion.figcaption>
    </figure>
  );
}
