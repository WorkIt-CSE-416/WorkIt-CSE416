"use client";

import * as React from "react";
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "motion/react";
import { Check } from "lucide-react";

import { cn } from "@/lib/cn";

import { journey, journeySection as copy, type JourneyStep } from "./data";
import { FaviconLogo } from "./favicon-logo";
import { autoApplyFeature, followedJob, updatesFeature } from "./feature-data";
import { FocusIn } from "./focus-in";
import { useMediaQuery } from "./hooks";
import { CONTAINER, SectionHeading } from "./layout-parts";
import { scoreTone } from "./score-tone";
import { Flight, FollowedCard, ScaledToWidth } from "./thread";

/**
 * The search from end to end as four tall cards (Find, Apply, Track, Hear
 * back), after Twain's deck of results. From lg up the section pins and the
 * scroll drives it: the cards start as a stacked deck with Track on top,
 * where the application that crossed the board lands (`Flight`, thread.tsx),
 * then the deck fans into a row, each card's front showing that same Stripe
 * application at its step, and each card flips in turn to show its detail.
 * Below lg, and with reduced motion, the cards are a still grid with both
 * sides' copy.
 */

// Tailwind's lg breakpoint: pinned from here up.
const DESKTOP_QUERY = "(min-width: 64rem)";
/** The gap between the cards in the row, in px. */
const GAP = 12;
/** The deck's order from the top: Track, where the board's card lands. */
const STACK: JourneyStep["id"][] = ["track", "apply", "hear", "find"];
/** Each card's place in the deck by its depth: a turn, a nudge, a drop. */
const DECK = [
  { rotate: 0, x: 0, y: 0 },
  { rotate: -5, x: -16, y: 10 },
  { rotate: 4.5, x: 18, y: 16 },
  { rotate: -8.5, x: -28, y: 24 },
];

// The pinned stretch's beats, as progress from 0 to 1.
const FAN: [number, number] = [0.04, 0.3];
const FLIP_AT = 0.38;
const FLIP_STEP = 0.12;
const FLIP_LEN = 0.16;

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const between = (v: number, [a, b]: [number, number]) => clamp((v - a) / (b - a));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function Journey() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const reduceMotion = useReducedMotion();
  if (isDesktop === true && !reduceMotion) return <PinnedJourney />;
  return <StillJourney />;
}

function Heading() {
  return (
    <FocusIn>
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />
    </FocusIn>
  );
}

function PinnedJourney() {
  const ref = React.useRef<HTMLElement>(null);
  const rowRef = React.useRef<HTMLDivElement>(null);
  const { scrollYProgress: q } = useScroll({ target: ref, offset: ["start start", "end end"] });
  // The section coming up from the screen's foot to its pin: the flight.
  const { scrollYProgress: entry } = useScroll({
    target: ref,
    offset: ["start end", "start start"],
  });
  // The row's width, read inside the transforms through a ref.
  const width = React.useRef(1088);
  React.useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => {
      width.current = row.offsetWidth;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={ref} className="h-[300vh]">
      <Flight name="deck" progress={entry}>
        <FollowedCard stage="offer" />
      </Flight>
      <div className="sticky top-0 flex h-dvh flex-col pt-24 pb-8">
        <div className={cn(CONTAINER, "flex min-h-0 flex-1 flex-col justify-center")}>
          <Heading />
          <div ref={rowRef} className="relative mt-10 h-full max-h-[34rem] min-h-0 flex-1">
            {journey.map((step, slot) => (
              <DeckCard key={step.id} step={step} slot={slot} q={q} width={width} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** One card: its place between the deck and the row, and its flip. */
function DeckCard({
  step,
  slot,
  q,
  width,
}: {
  step: JourneyStep;
  slot: number;
  q: MotionValue<number>;
  width: React.RefObject<number>;
}) {
  const depth = STACK.indexOf(step.id);
  const deck = DECK[depth];
  const flipAt: [number, number] = [
    FLIP_AT + slot * FLIP_STEP,
    FLIP_AT + slot * FLIP_STEP + FLIP_LEN,
  ];

  const pose = (v: number) => {
    const card = (width.current - 3 * GAP) / 4;
    // From the deck at the row's centre to the card's own place.
    const toCentre = (1.5 - slot) * (card + GAP);
    const t = ease(between(v, FAN));
    const f = ease(between(v, flipAt));
    const lift = Math.sin(Math.PI * f);
    return {
      x: lerp(toCentre + deck.x, 0, t),
      y: lerp(deck.y, 0, t) - Math.sin(Math.PI * t) * 14 * Math.abs(1.5 - slot) - lift * 12,
      rotate: lerp(deck.rotate, 0, t),
      scale: lerp(1 - depth * 0.03, 1, t) * (1 + lift * 0.04),
      flip: f * 180,
    };
  };
  const x = useTransform(q, (v) => pose(v).x);
  const y = useTransform(q, (v) => pose(v).y);
  const rotate = useTransform(q, (v) => pose(v).rotate);
  const scale = useTransform(q, (v) => pose(v).scale);
  const rotateY = useTransform(q, (v) => pose(v).flip);

  return (
    <motion.article
      className="absolute inset-y-0"
      style={{
        left: `calc(${slot} * ((100% - ${3 * GAP}px) / 4 + ${GAP}px))`,
        width: `calc((100% - ${3 * GAP}px) / 4)`,
        x,
        y,
        rotate,
        scale,
        zIndex: 10 - depth,
        perspective: "1400px",
      }}
    >
      <motion.div className="relative size-full" style={{ rotateY, transformStyle: "preserve-3d" }}>
        <Front step={step} />
        <Back step={step} />
      </motion.div>
    </motion.article>
  );
}

const FACE =
  "absolute inset-0 flex flex-col overflow-hidden rounded-[2rem] p-6 ring-1 ring-slate-900/5 [backface-visibility:hidden]";

/** A card's front: the step, its line and a picture of it. */
function Front({ step }: { step: JourneyStep }) {
  return (
    <div className={cn(FACE, "isolate bg-white shadow-[0_24px_48px_-28px_rgb(40_20_90/0.35)]")}>
      <Glow step={step} />
      <h3 className="text-ink text-3xl font-semibold tracking-tight">{step.title}</h3>
      <p className="text-ink-meta mt-2 text-sm">{step.line}</p>
      {/* Under the line, not beside the title, which it pushed onto two
          lines in a narrow card. */}
      {step.soon && (
        <div className="mt-3">
          <Soon />
        </div>
      )}
      <div className="mt-auto pt-6">
        <Demo id={step.id} />
      </div>
    </div>
  );
}

/** A card's back: what the step does, in full. */
function Back({ step }: { step: JourneyStep }) {
  return (
    <div
      className={cn(FACE, "isolate bg-white")}
      style={{
        transform: "rotateY(180deg)",
        background: `linear-gradient(160deg, color-mix(in oklab, ${step.glow} 14%, white), white 70%)`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <p aria-hidden="true" className="text-ink text-xl font-semibold tracking-tight">
          {step.title}
        </p>
        {step.soon && <Soon />}
      </div>
      {/* Larger on a tall screen, where the back has room to spare. */}
      <p className="text-ink mt-3 text-[15px] leading-relaxed text-pretty [@media(min-height:52rem)]:text-lg">
        {step.body}
      </p>
      <ul className="mt-auto space-y-2.5 pt-6">
        {step.points.map((point) => (
          <li key={point} className="text-ink flex items-start gap-2.5 text-sm">
            <span
              className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-white"
              style={{ background: step.glow }}
            >
              <Check className="size-3" strokeWidth={3} aria-hidden="true" />
            </span>
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Glow({ step }: { step: JourneyStep }) {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-x-0 bottom-0 -z-10 h-2/3"
      style={{
        background: `radial-gradient(70% 90% at 30% 100%, color-mix(in oklab, ${step.glow} 30%, transparent), transparent), radial-gradient(60% 80% at 90% 100%, color-mix(in oklab, ${step.glow} 18%, transparent), transparent)`,
      }}
    />
  );
}

function Soon() {
  return (
    <span className="bg-surface text-ink-meta shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-slate-900/5">
      Coming soon
    </span>
  );
}

/** Below lg, and with reduced motion: the four cards, both sides' copy. */
function StillJourney() {
  return (
    <section className="py-20 sm:py-28">
      <div className={CONTAINER}>
        <Heading />
        <div className="mt-12 grid gap-3 sm:mt-16 sm:grid-cols-2 lg:grid-cols-4">
          {journey.map((step) => (
            <article
              key={step.id}
              className="relative isolate flex flex-col overflow-hidden rounded-[2rem] bg-white p-6 ring-1 ring-slate-900/5"
            >
              <Glow step={step} />
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-ink text-2xl font-semibold tracking-tight">{step.title}</h3>
                {step.soon && <Soon />}
              </div>
              <p className="text-ink-meta mt-2 text-sm">{step.body}</p>
              <ul className="mt-5 space-y-2.5">
                {step.points.map((point) => (
                  <li key={point} className="text-ink flex items-start gap-2.5 text-sm">
                    <span
                      className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-white"
                      style={{ background: step.glow }}
                    >
                      <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-6">
                <Demo id={step.id} />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * A small picture of the step, each the application the page has followed
 * (`followedJob`, Stripe): its posting and match, the form Auto Apply
 * fills, its tracker card at the offer (where the board's card lands) and
 * the offer as an update.
 */
function Demo({ id }: { id: JourneyStep["id"] }) {
  const shell = "rounded-2xl bg-white p-4 shadow-lg ring-1 shadow-slate-900/10 ring-slate-900/5";

  if (id === "find") {
    return (
      <div aria-hidden="true" className={shell}>
        <div className="flex items-center gap-3">
          <FaviconLogo domain={followedJob.domain} className="rounded-lg" />
          <div className="min-w-0 flex-1">
            <p className="text-ink truncate text-sm font-semibold">{followedJob.title}</p>
            <p className="text-ink-meta text-xs">{followedJob.company}</p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ring-1 ring-inset",
              scoreTone(followedJob.score),
            )}
          >
            {followedJob.score}%
          </span>
        </div>
      </div>
    );
  }

  if (id === "apply") {
    return (
      <div aria-hidden="true" className={cn(shell, "space-y-2")}>
        {autoApplyFeature.sections
          .flatMap((section) => section.fields)
          .filter((field) => ["email", "phone", "resume"].includes(field.id))
          .map((field) => (
            <div key={field.id} className="flex items-center gap-2 text-xs">
              <span className="text-ink-meta w-12 shrink-0">{field.label}</span>
              <span className="text-ink bg-surface ring-border flex h-7 min-w-0 flex-1 items-center truncate rounded-md px-2 ring-1">
                <span className="truncate">{field.value}</span>
              </span>
              <Check className="text-positive size-3.5 shrink-0" aria-hidden="true" />
            </div>
          ))}
      </div>
    );
  }

  if (id === "track") {
    return (
      <ScaledToWidth>
        <FollowedCard stage="offer" data-thread-to="deck" />
      </ScaledToWidth>
    );
  }

  return (
    <div aria-hidden="true" className={cn(shell, "flex items-center gap-3")}>
      <FaviconLogo domain={followedJob.domain} className="rounded-lg" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-ink truncate">
          <span className="font-semibold">{followedJob.company}</span> sent you an offer
        </p>
        <p className="text-ink-meta truncate text-xs">
          {updatesFeature.offer.term} · reply by {updatesFeature.offer.replyBy}
        </p>
      </div>
    </div>
  );
}
