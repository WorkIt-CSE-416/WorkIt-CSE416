"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";

import { cn } from "@/lib/cn";

import { hero } from "./data";
import { GLIDE } from "./story";

/**
 * The hero's tagline, "Stop ___ by hand.", after Twain's swapping word:
 * the blank walks the pipeline once (rewriting resumes, searching for
 * jobs, filling out applications, tracking applications) and settles on
 * `hero.rest`. Each swap rolls the old phrase out letter by letter (tipping
 * back in 3D, blurring, lifting) while the new one rolls up from below, the
 * two crossing; "Stop" glides as the line changes width (a layout
 * animation), and the brush stroke redraws under each new phrase.
 *
 * The first phrase is server-rendered and rises in by CSS (`.hero-char`),
 * so the headline shows before the script loads; later phrases animate
 * with motion. Screen readers get the whole sentence once, in a hidden
 * line, and the moving copy is hidden from them. With reduced motion it
 * shows the resting phrase and never swaps.
 */

/** How long each phrase holds before the next, in ms. */
const HOLD = 2300;
/** When the first swap comes, after the headline has risen in, in ms. */
const FIRST_SWAP = 1900;

/** One pass of the pipeline, then back to the resting phrase. */
const SEQUENCE = [...hero.phrases.map((_, i) => i), hero.rest];

export function HeroTitle() {
  const reduceMotion = useReducedMotion();
  const [step, setStep] = React.useState(0);
  const at = reduceMotion ? hero.rest : SEQUENCE[step];
  const phrase = hero.phrases[at];

  React.useEffect(() => {
    if (reduceMotion || step >= SEQUENCE.length - 1) return;
    const timer = window.setTimeout(() => setStep((s) => s + 1), step === 0 ? FIRST_SWAP : HOLD);
    return () => window.clearTimeout(timer);
  }, [step, reduceMotion]);

  return (
    <>
      <span className="sr-only">
        {hero.lead} {listOf(hero.phrases)} {hero.tail}
      </span>
      {/* The moving copy. data-hero-text: the hero's job cards keep clear
          of these line boxes (hero-city.tsx). */}
      <span aria-hidden="true" data-hero-text className="block">
        <span className="block">
          <motion.span layout="position" className="inline-block">
            <span className="hero-word" style={{ "--wd": "0.08s" } as React.CSSProperties}>
              {hero.lead}
            </span>
          </motion.span>{" "}
          <motion.span layout="position" className="relative inline-block">
            <AnimatePresence mode="popLayout" initial={false}>
              <Phrase key={phrase} text={phrase} first={step === 0} still={!!reduceMotion} />
            </AnimatePresence>
          </motion.span>
        </span>
        <span className="block">
          {hero.tail.split(" ").map((word, i) => (
            <React.Fragment key={word}>
              {i > 0 && " "}
              <span
                className="hero-word"
                style={{ "--wd": `${0.5 + i * 0.07}s` } as React.CSSProperties}
              >
                {word}
              </span>
            </React.Fragment>
          ))}
        </span>
      </span>
    </>
  );
}

/** "a, b, c and d", for the hidden sentence. */
function listOf(items: string[]) {
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** A letter's way in and out. `custom` is its index in the phrase. */
const CHAR: Variants = {
  hidden: { y: "0.55em", opacity: 0, rotateX: -75, filter: "blur(8px)" },
  shown: (i: number) => ({
    y: 0,
    opacity: 1,
    rotateX: 0,
    filter: "blur(0px)",
    transition: { delay: 0.12 + i * 0.022, duration: 0.6, ease: GLIDE },
  }),
  gone: (i: number) => ({
    y: "-0.45em",
    opacity: 0,
    rotateX: 70,
    filter: "blur(8px)",
    transition: { delay: i * 0.012, duration: 0.32, ease: [0.4, 0, 1, 1] },
  }),
};

const SWASH: Variants = {
  hidden: { clipPath: "inset(0 100% 0 0)" },
  shown: { clipPath: "inset(0 0% 0 0)", transition: { delay: 0.55, duration: 0.6, ease: GLIDE } },
  gone: { opacity: 0, transition: { duration: 0.2 } },
};

/**
 * One phrase: words that never break inside, each letter its own span so it
 * can roll on its own, in the brand violet, with the brush stroke under.
 * The first phrase rises in by CSS instead (`.hero-char`), server-rendered.
 */
const Phrase = React.forwardRef<HTMLSpanElement, { text: string; first: boolean; still: boolean }>(
  function Phrase({ text, first, still }, ref) {
    let n = 0;
    return (
      <motion.span
        ref={ref}
        // One line from lg up; below it a long phrase wraps between words.
        className="relative inline-block whitespace-nowrap [perspective:800px] max-lg:whitespace-normal"
        initial={first || still ? false : "hidden"}
        animate="shown"
        exit="gone"
      >
        {text.split(" ").map((word, w) => (
          <React.Fragment key={w}>
            {w > 0 && " "}
            <span className="inline-block whitespace-nowrap">
              {[...word].map((char) => {
                const i = n++;
                return (
                  <motion.span
                    key={i}
                    custom={i}
                    variants={CHAR}
                    className={cn("hero-char-em inline-block", first && "hero-char")}
                    style={
                      first
                        ? ({ "--wd": `${0.16 + i * 0.022}s` } as React.CSSProperties)
                        : undefined
                    }
                  >
                    {char}
                  </motion.span>
                );
              })}
            </span>
          </React.Fragment>
        ))}
        <motion.svg
          aria-hidden="true"
          className={cn("hero-swash", first && "hero-swash-first")}
          viewBox="0 0 300 24"
          preserveAspectRatio="none"
          variants={SWASH}
        >
          <defs>
            <linearGradient id="hero-swash-fill" x1="0" x2="1">
              <stop offset="0" stopColor="var(--color-landing-brand-300)" />
              <stop offset="1" stopColor="var(--color-landing-brand-500)" />
            </linearGradient>
          </defs>
          {/* A tapered brush stroke: thick on the left, thin at its tip. */}
          <path
            fill="url(#hero-swash-fill)"
            d="M3 15.5C70 8.5 170 5.5 297 7.5C298.5 7.6 298.5 9.6 297 9.8C180 10 90 14.5 6 21.5C3 22 1.5 17 3 15.5Z"
          />
        </motion.svg>
      </motion.span>
    );
  },
);
