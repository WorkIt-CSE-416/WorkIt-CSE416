"use client";

import * as React from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";

import { testimonial } from "./data";
import { useMediaQuery } from "./hooks";

// Tailwind's lg breakpoint: read by scrolling from here up.
const DESKTOP_QUERY = "(min-width: 64rem)";

/**
 * The testimonial, read the way the statement's paragraph is: each word of
 * the quote darkens as the scroll reaches it, then the name comes in. Its
 * copy is still the site's placeholder (data.ts); never fill it with an
 * invented quote, name or number. Below lg and with reduced motion it is
 * the finished frame.
 */
export function Testimonial() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const reduceMotion = useReducedMotion();
  const reading = isDesktop === true && !reduceMotion;
  // Keyed, so each word's transform is built once for its source.
  return <TestimonialBody key={String(reading)} reading={reading} />;
}

function TestimonialBody({ reading }: { reading: boolean }) {
  const ref = React.useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.8", "end 0.55"] });
  const finished = useMotionValue(1);
  const p = reading ? scrollYProgress : finished;
  const words = React.useMemo(() => `“${testimonial.quote}”`.split(" "), []);
  const nameOpacity = useTransform(p, [0.85, 1], [0, 1]);

  return (
    <figure ref={ref} className="mx-auto max-w-3xl text-center">
      <blockquote className="text-ink text-2xl font-medium tracking-tight text-balance sm:text-3xl">
        <p>
          {words.map((word, i) => (
            <Word key={i} p={p} index={i} count={words.length}>
              {word}
            </Word>
          ))}
        </p>
      </blockquote>
      <motion.figcaption className="mt-8" style={{ opacity: nameOpacity }}>
        <p className="text-ink font-semibold">{testimonial.name}</p>
        <p className="text-ink-meta text-sm">{testimonial.role}</p>
      </motion.figcaption>
    </figure>
  );
}

function Word({
  p,
  index,
  count,
  children,
}: {
  p: MotionValue<number>;
  index: number;
  count: number;
  children: string;
}) {
  // Read across 0 to 0.8; every range stays inside 0 to 1.
  const start = (index / count) * 0.78;
  const opacity = useTransform(p, [start, start + 0.04], [0.18, 1]);
  return (
    <>
      <motion.span style={{ opacity }}>{children}</motion.span>{" "}
    </>
  );
}
