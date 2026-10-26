"use client";

import * as React from "react";
import { AnimatePresence, motion, useInView, useReducedMotion, type Variants } from "motion/react";

import { cn } from "@/lib/cn";

import { hero } from "./data";
import { usePageHidden } from "./hooks";
import { GLIDE } from "./story";

/**
 * The hero's tagline, "Stop ___ by hand.", after Twain's swapping word:
 * the blank loops through the pipeline in the tour's order (rewriting
 * resumes, searching for jobs, filling out applications, tracking
 * applications), starting on `hero.rest`, the main promise. It walked the
 * pipeline once and rested there, so that phrase showed twice and the
 * headline then stood still, which the team disliked. It starts on the
 * widest phrase, so the job cards, placed against the text a second after
 * load (hero-city.tsx), clear every later one. Each swap rolls the old
 * phrase out letter by letter (tipping
 * back in 3D and lifting, each word blurring) while the new one rolls up
 * from below, the two crossing; "Stop" glides as the line changes width (a layout
 * animation), and the brush stroke redraws under each new phrase.
 *
 * The first phrase is server-rendered and rises in by CSS (`.hero-char`),
 * so the headline shows before the script loads; later phrases animate
 * with motion. Screen readers get the whole sentence once, in a hidden
 * line, and the moving copy is hidden from them. With reduced motion it
 * shows the resting phrase and never swaps.
 */

/** How long each phrase holds before the next, in ms: the whole line reads
 * for about two seconds once a swap has rolled in. At 2.3 s it read for
 * about one. */
const HOLD = 3200;
/** When the first swap comes, after the headline has risen in, in ms: the
 * first phrase, the main promise, holds a little longer. */
const FIRST_SWAP = 3600;

export function HeroTitle() {
  const reduceMotion = useReducedMotion();
  const ref = React.useRef<HTMLSpanElement>(null);
  const [step, setStep] = React.useState(0);
  const at = reduceMotion ? hero.rest : (hero.rest + step) % hero.phrases.length;
  const phrase = hero.phrases[at];

  // Paused off screen and in a hidden tab: a page opened behind another
  // does not loop the phrases unseen and then play the stalled swaps all
  // at once, and a reader further down costs nothing.
  const hidden = usePageHidden();
  const inView = useInView(ref);
  React.useEffect(() => {
    if (reduceMotion || hidden || !inView) return;
    const timer = window.setTimeout(() => setStep((s) => s + 1), step === 0 ? FIRST_SWAP : HOLD);
    return () => window.clearTimeout(timer);
  }, [step, reduceMotion, hidden, inView]);

  return (
    <>
      {/* Not selectable: a drag over the headline copied this sentence as
          well as the visible one. */}
      <span className="sr-only select-none">
        {hero.lead} {listOf(hero.phrases)} {hero.tail}
      </span>
      {/* The moving copy. data-hero-text: the hero's job cards keep clear
          of these line boxes (hero-city.tsx). */}
      <span ref={ref} aria-hidden="true" data-hero-text className="block">
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
        {/* Glides with the phrase: below lg a phrase that wraps to one more
            line pushed "by hand." down in one frame. */}
        <motion.span layout="position" className="block">
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
        </motion.span>
      </span>
    </>
  );
}

/** "a, b, c and d", for the hidden sentence. */
function listOf(items: string[]) {
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Each letter's start, after the one before, in and out, in s. */
const IN_STEP = 0.022;
const OUT_STEP = 0.012;
const OUT_EASE = [0.4, 0, 1, 1] as const;

/** A letter's way in and out. `custom` is its index in the phrase. */
const CHAR: Variants = {
  hidden: { y: "0.55em", opacity: 0, rotateX: -75 },
  shown: (i: number) => ({
    y: 0,
    opacity: 1,
    rotateX: 0,
    transition: { delay: 0.12 + i * IN_STEP, duration: 0.6, ease: GLIDE },
  }),
  gone: (i: number) => ({
    y: "-0.45em",
    opacity: 0,
    rotateX: 70,
    transition: { delay: i * OUT_STEP, duration: 0.32, ease: OUT_EASE },
  }),
};

/**
 * A word's blur, in and out, over the time its letters take. `custom` is
 * its first letter's index in the phrase and its letter count. One blur a
 * word: a blur per letter animated some 60 filters on every swap.
 */
const WORD: Variants = {
  hidden: { filter: "blur(8px)" },
  shown: ({ at, n }: { at: number; n: number }) => ({
    filter: "blur(0px)",
    transition: { delay: 0.12 + at * IN_STEP, duration: 0.6 + (n - 1) * IN_STEP, ease: GLIDE },
    // A leftover blur(0px) keeps the word on a layer of its own.
    transitionEnd: { filter: "none" },
  }),
  gone: ({ at, n }: { at: number; n: number }) => ({
    filter: "blur(8px)",
    transition: { delay: at * OUT_STEP, duration: 0.32 + (n - 1) * OUT_STEP, ease: OUT_EASE },
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
        {text.split(" ").map((word, w, words) => (
          <React.Fragment key={w}>
            {w > 0 && " "}
            <motion.span
              custom={{ at: n, n: word.length }}
              variants={WORD}
              className="relative inline-block whitespace-nowrap"
            >
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
              {/* Below lg the phrase may wrap, so the stroke goes under its
                  last word, not under a box wider than the text. */}
              {w === words.length - 1 && <Swash first={first} className="lg:hidden" />}
            </motion.span>
          </React.Fragment>
        ))}
        {/* Under the whole phrase from lg up, where it is one line. */}
        <Swash first={first} className="max-lg:hidden" />
      </motion.span>
    );
  },
);

/** The tapered brush stroke under the phrase, drawn in left to right. */
function Swash({ first, className }: { first: boolean; className?: string }) {
  const fill = React.useId();
  return (
    <motion.svg
      aria-hidden="true"
      className={cn("hero-swash", first && "hero-swash-first", className)}
      viewBox="0 0 300 24"
      preserveAspectRatio="none"
      variants={SWASH}
    >
      <defs>
        <linearGradient id={fill} x1="0" x2="1">
          <stop offset="0" stopColor="var(--color-landing-brand-300)" />
          <stop offset="1" stopColor="var(--color-landing-brand-500)" />
        </linearGradient>
      </defs>
      {/* Thick on the left, thin at its tip. */}
      <path
        fill={`url(#${fill})`}
        d="M3 15.5C70 8.5 170 5.5 297 7.5C298.5 7.6 298.5 9.6 297 9.8C180 10 90 14.5 6 21.5C3 22 1.5 17 3 15.5Z"
      />
    </motion.svg>
  );
}
