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
import { Check } from "lucide-react";

import { cn } from "@/lib/cn";

import { useMediaQuery } from "./hooks";
import { CONTAINER, PANEL, PANEL_INSET } from "./layout-parts";

/**
 * The statement between the product tour and the applications section,
 * after Twain's: from lg up it pins while the visitor scrolls, and the
 * scroll drives everything, nothing runs on a timer. The headline steps
 * into a staircase, the paragraph beside it darkens word by word as it is
 * read, then a generic cover letter appears and its words fall one by one
 * into a bin, and the closing line lands. Below lg it does not pin; the
 * same moves follow the section through the screen. With reduced motion it
 * shows the finished frame (progress held at 1).
 *
 * The paragraph is product copy, so each claim in it must stay true:
 * tailoring, matching, auto apply filling the form, the tracker, and the
 * student clicking Submit (auto-apply/architecture.md).
 */

// The team's line, read as a staircase: "Stop sending slop applications".
// Not the hero's tagline, which an earlier headline here repeated.
const HEADLINE = ["Stop sending", "slop", "applications"];
/** Each headline line's step to the right once the staircase forms, in em,
 * so it shrinks with the type: at a phone's size a step in px pushed
 * "applications" past the panel. */
const STAIR = [0, 0.8, 1.6];

const PARAGRAPHS = [
  "Most students send the same resume to every job posting. Recruiters read for the job they posted, so a page written for no job in particular gets passed over.",
  "Doing it right takes hours each time: a resume tailored to the posting, a form filled in field by field, and a list of where every application stands.",
  "WorkIt does that part. It tailors the resume, finds the jobs that fit, fills in the application and keeps each one on track. You choose where to apply, and you click Submit.",
];

/** The cover letter nobody reads, which falls into the bin word by word. */
const TEMPLATE =
  "Dear Hiring Manager, I am writing to apply for the [Position] role at [Company]. I am a hard-working team player who is passionate about [Industry].";

// The scroll's beats, as progress from 0 to 1 across the pinned stretch.
const STAIR_AT: [number, number] = [0.02, 0.2];
const READ_AT: [number, number] = [0.08, 0.6];
const LETTER_IN: [number, number] = [0.58, 0.66];
const FALL_AT: [number, number] = [0.68, 0.9];
const CLOSE_AT: [number, number] = [0.9, 0.97];

// Tailwind's lg breakpoint: pinned from here up.
const DESKTOP_QUERY = "(min-width: 64rem)";

export function Statement() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  // Keyed, since useScroll reads its offsets once.
  return <StatementBody key={String(isDesktop)} pinned={isDesktop === true} />;
}

function StatementBody({ pinned }: { pinned: boolean }) {
  const ref = React.useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: pinned ? ["start start", "end end"] : ["start 0.85", "end 0.65"],
  });
  const finished = useMotionValue(1);
  const p = reduceMotion ? finished : scrollYProgress;

  return (
    <section
      ref={ref}
      aria-labelledby="statement-title"
      className={cn(PANEL_INSET, "mt-16 sm:mt-24", pinned && "h-[260vh]")}
    >
      <div className={cn(pinned && "sticky top-0 flex h-dvh flex-col pt-24 pb-6")}>
        <div
          className={cn(PANEL, "relative flex-1 overflow-hidden py-16 lg:py-0")}
          style={{
            background:
              "radial-gradient(60% 70% at 10% 0%, color-mix(in oklab, var(--color-brand) 10%, transparent), transparent), linear-gradient(180deg, #f7f6fc, #efeff8)",
          }}
        >
          <div
            className={cn(
              CONTAINER,
              "grid h-full items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16",
            )}
          >
            <Stage p={p} />
            <Reading p={p} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** The headline, the letter and the bin, on the left. */
function Stage({ p }: { p: MotionValue<number> }) {
  const stageRef = React.useRef<HTMLDivElement>(null);
  const binRef = React.useRef<HTMLDivElement>(null);
  const words = React.useMemo(() => TEMPLATE.split(" "), []);
  // Each word's way from its place on the letter to the bin's mouth, in
  // px, measured from layout (offsets, not the moving boxes) and read
  // through a ref, since a transform built from props would keep the
  // first measure.
  const targets = React.useRef<{ dx: number; dy: number }[]>([]);

  React.useLayoutEffect(() => {
    const stage = stageRef.current;
    const bin = binRef.current;
    if (!stage || !bin) return;
    const measure = () => {
      const binBox = offsetWithin(bin, stage);
      const mouthX = binBox.left + bin.offsetWidth / 2;
      const mouthY = binBox.top + 26;
      targets.current = [...stage.querySelectorAll<HTMLElement>("[data-word]")].map((el) => {
        const box = offsetWithin(el, stage);
        return {
          dx: mouthX - (box.left + el.offsetWidth / 2),
          dy: mouthY - (box.top + el.offsetHeight / 2),
        };
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const letterOpacity = useTransform(p, [LETTER_IN[0], LETTER_IN[1], 0.88, 0.94], [0, 1, 1, 0]);
  const letterY = useTransform(p, LETTER_IN, [24, 0]);
  const binOpacity = useTransform(p, [LETTER_IN[0], LETTER_IN[1]], [0, 1]);
  // The bin jolts as the words land in it.
  const binRotate = useTransform(p, (v) =>
    v > FALL_AT[0] + 0.02 && v < FALL_AT[1] + 0.02 ? Math.sin(v * 260) * 2.5 : 0,
  );
  const closeOpacity = useTransform(p, CLOSE_AT, [0, 1]);
  const closeY = useTransform(p, CLOSE_AT, [12, 0]);

  return (
    <div ref={stageRef} className="relative">
      <h2
        id="statement-title"
        className="text-ink text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-6xl lg:text-[4.25rem]"
      >
        {HEADLINE.map((line, i) => (
          <StairLine key={line} p={p} step={STAIR[i]}>
            {line}
          </StairLine>
        ))}
      </h2>

      {/* The letter and the bin it ends in. Decorative: the paragraph says it. */}
      <div aria-hidden="true" className="relative mt-10 h-[300px] max-w-[26rem]">
        <motion.div
          className="absolute inset-x-0 top-0 rounded-2xl bg-white/90 p-4 shadow-[0_18px_40px_-24px_rgb(16_48_94/0.55)] ring-1 ring-slate-900/5"
          style={{ opacity: letterOpacity, y: letterY }}
        >
          <p className="text-ink-meta mb-2 text-[11px] font-semibold tracking-wide uppercase">
            The cover letter everyone sends
          </p>
          {/* Sizes the card to the words laid over it. */}
          <p className="invisible font-serif text-[15px] leading-relaxed">{TEMPLATE}</p>
        </motion.div>
        {/* The words sit over the letter, apart from it, so they can leave it. */}
        <motion.p
          className="text-ink absolute inset-x-0 top-0 px-4 pt-[2.6rem] pb-4 font-serif text-[15px] leading-relaxed"
          style={{ y: letterY }}
        >
          {words.map((word, i) => (
            <FallingWord key={i} p={p} index={i} count={words.length} targets={targets}>
              {word}
            </FallingWord>
          ))}
        </motion.p>
        <motion.div
          ref={binRef}
          className="absolute bottom-0 left-1/2 -ml-[52px] w-[104px]"
          style={{ opacity: binOpacity, rotate: binRotate, transformOrigin: "50% 100%" }}
        >
          <Bin />
        </motion.div>
      </div>

      <motion.p
        className="text-ink mt-2 flex items-center gap-2 text-lg font-semibold"
        style={{ opacity: closeOpacity, y: closeY }}
      >
        <span className="bg-positive grid size-6 place-items-center rounded-full text-white">
          <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
        </span>
        A resume written for the job gets read.
      </motion.p>
    </div>
  );
}

function StairLine({
  p,
  step,
  children,
}: {
  p: MotionValue<number>;
  step: number;
  children: React.ReactNode;
}) {
  const x = useTransform(p, STAIR_AT, ["0em", `${step}em`]);
  return (
    <motion.span className="block whitespace-nowrap" style={{ x }}>
      {children}
    </motion.span>
  );
}

/** One word of the letter: it hops, then drops into the bin, turning. */
function FallingWord({
  p,
  index,
  count,
  targets,
  children,
}: {
  p: MotionValue<number>;
  index: number;
  count: number;
  targets: React.RefObject<{ dx: number; dy: number }[]>;
  children: string;
}) {
  const span = FALL_AT[1] - FALL_AT[0];
  const start = FALL_AT[0] + (index / count) * span * 0.8;
  const end = start + span * 0.2;
  const spin = ((index * 47) % 90) - 45;
  const at = (v: number) => Math.min(1, Math.max(0, (v - start) / (end - start)));

  const x = useTransform(p, (v) => (targets.current[index]?.dx ?? 0) * at(v));
  // A small hop, then gravity: down faster as it goes.
  const y = useTransform(p, (v) => {
    const t = at(v);
    const dy = targets.current[index]?.dy ?? 0;
    return t * t * dy - Math.sin(Math.PI * Math.min(1, t * 1.6)) * 18;
  });
  const rotate = useTransform(p, (v) => spin * at(v));
  const scale = useTransform(p, (v) => 1 - 0.35 * at(v));
  const opacity = useTransform(p, (v) => {
    if (v < LETTER_IN[0]) return 0;
    if (v < LETTER_IN[1]) return (v - LETTER_IN[0]) / (LETTER_IN[1] - LETTER_IN[0]);
    return at(v) > 0.92 ? 0 : 1;
  });

  return (
    <>
      <motion.span
        data-word
        className="inline-block will-change-transform"
        style={{ x, y, rotate, scale, opacity }}
      >
        {children}
      </motion.span>{" "}
    </>
  );
}

/** The paragraph on the right: each word darkens as the scroll reaches it. */
function Reading({ p }: { p: MotionValue<number> }) {
  const words = React.useMemo(() => PARAGRAPHS.map((text) => text.split(" ")), []);
  const total = words.reduce((sum, list) => sum + list.length, 0);
  let n = 0;
  return (
    <div className="max-w-xl space-y-5 text-xl leading-[1.5] font-medium tracking-[-0.01em] sm:text-2xl">
      {words.map((list, i) => (
        <p key={i}>
          {list.map((word) => {
            const k = n++;
            return (
              <ReadWord key={k} p={p} index={k} count={total}>
                {word}
              </ReadWord>
            );
          })}
        </p>
      ))}
    </div>
  );
}

function ReadWord({
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
  const start = READ_AT[0] + (index / count) * (READ_AT[1] - READ_AT[0]);
  const opacity = useTransform(p, [start, start + 0.025], [0.18, 1]);
  return (
    <>
      <motion.span className="text-ink" style={{ opacity }}>
        {children}
      </motion.span>{" "}
    </>
  );
}

/** A wastebasket, drawn in the page's glass: a tapered pail with ribs. */
function Bin() {
  return (
    <svg viewBox="0 0 104 112" className="h-auto w-full overflow-visible">
      <defs>
        <linearGradient id="statement-bin" x1="0" x2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#eef0fb" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <ellipse cx="52" cy="108" rx="40" ry="4" fill="rgb(16 48 94 / 0.08)" />
      <path
        d="M6 18 L16 104 Q52 112 88 104 L98 18 Z"
        fill="url(#statement-bin)"
        stroke="rgb(76 39 163 / 0.18)"
        strokeWidth="1.5"
      />
      {[24, 38, 52, 66, 80].map((x) => (
        <line
          key={x}
          x1={x}
          y1="24"
          x2={52 + (x - 52) * 0.82}
          y2="102"
          stroke="rgb(76 39 163 / 0.1)"
          strokeWidth="1.5"
        />
      ))}
      <ellipse
        cx="52"
        cy="18"
        rx="46"
        ry="9"
        fill="#f4f3fb"
        stroke="rgb(76 39 163 / 0.22)"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** An element's layout offset from `root`, through its positioned ancestors. */
function offsetWithin(el: HTMLElement, root: HTMLElement) {
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    left += node.offsetLeft;
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { left, top };
}
