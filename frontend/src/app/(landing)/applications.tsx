"use client";

import * as React from "react";
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";

import { cn } from "@/lib/cn";

import ApplicationBoard from "./application-board";
import { stages } from "./board-data";
import { applicationsSection as copy } from "./data";
import { FocusIn } from "./focus-in";
import { useMediaQuery } from "./hooks";
import { CONTAINER, SectionHeading } from "./layout-parts";
import { ROW, StageTimeline, stageAt, stepAt } from "./stage-timeline";
import { Flight, FollowedCard } from "./thread";

/**
 * The applications section ("Every application, from saved to signed.").
 * From lg up it pins and the scroll drives it, no timers: the application
 * the statement ended on flies in and lands on the board's Saved column
 * (`Flight`, thread.tsx), then as the page scrolls the timeline fills
 * stage by stage, the card crosses the board to the matching column, and
 * that column glows in its stage's colour. Below lg, and with reduced
 * motion, it is the still version: every stage lit, no card.
 */

// Tailwind's lg breakpoint: pinned from here up.
const DESKTOP_QUERY = "(min-width: 64rem)";
/** Laptop screens 760px tall or less get shorter rows, so the heading and
 * the four stages fit under the header. */
const SHORT_QUERY = "(max-height: 47.5rem)";
/** The card's size over the board, against its 288px. */
const CARD_SCALE = 0.74;
/** The pinned stretch's beats, as progress from 0 to 1: the timeline runs
 * from Saved to Job Offers between these, and holds the offer after. */
const RUN: [number, number] = [0.06, 0.86];

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function Applications() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const reduceMotion = useReducedMotion();
  if (isDesktop === true && !reduceMotion) return <PinnedApplications />;
  return <StillApplications />;
}

function Heading() {
  return (
    <FocusIn>
      <SectionHeading
        align="left"
        eyebrow={copy.eyebrow}
        title={copy.title}
        subtitle={copy.subtitle}
      />
    </FocusIn>
  );
}

function PinnedApplications() {
  const ref = React.useRef<HTMLElement>(null);
  const short = useMediaQuery(SHORT_QUERY) === true;
  // 0 when the section's top meets the screen's top, 1 when its bottom
  // meets the screen's bottom: the stretch where it is pinned.
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });
  // The section coming up from the screen's foot to its pin: the flight.
  const { scrollYProgress: entry } = useScroll({
    target: ref,
    offset: ["start end", "start start"],
  });
  const s = useTransform(p, (v) => clamp((v - RUN[0]) / (RUN[1] - RUN[0])) * (stages.length - 1));
  const [step, setStep] = React.useState(() => stepAt(s.get()));
  useMotionValueEvent(s, "change", (v) => setStep(stepAt(v)));

  return (
    <section ref={ref} id="applications" className="h-[280vh]">
      <Flight name="board" progress={entry}>
        <FollowedCard stage="saved" />
      </Flight>
      <div className="sticky top-0 flex h-dvh flex-col justify-center pt-20 pb-6">
        <div className={cn(CONTAINER, "grid grid-cols-5 items-center gap-12")}>
          <div className="col-span-2">
            <Heading />
            <StageTimeline s={s} step={step} row={short ? 70 : ROW} />
          </div>
          <div className="col-span-3">
            <ApplicationBoard active={step}>
              <BoardCard s={s} step={step} />
            </ApplicationBoard>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The followed application over the board, flat: it holds on its stage's
 * column and glides to the next as the timeline does, its chip and next
 * step changing as it lands. Each column's centre is measured from the
 * board's markers and read through a ref, since the board is tilted in 3D.
 */
function BoardCard({ s, step }: { s: MotionValue<number>; step: number }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const cols = React.useRef<{ x: number; y: number }[]>([]);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const place = React.useCallback(
    (v: number) => {
      const { from, to, u } = stageAt(v);
      const a = cols.current[from];
      const b = cols.current[to];
      if (!a || !b) return;
      x.set(lerp(a.x, b.x, u));
      // A small hop between columns.
      y.set(lerp(a.y, b.y, u) - Math.sin(Math.PI * u) * 18);
    },
    [x, y],
  );
  useMotionValueEvent(s, "change", place);

  React.useLayoutEffect(() => {
    const el = ref.current;
    const board = el?.closest<HTMLElement>("[data-board]");
    if (!el || !board) return;
    const measure = () => {
      const box = board.getBoundingClientRect();
      // Kept inside the board with a margin: the outer columns' centres
      // sit near its edges, where the board's corners would cut the card.
      const halfW = (el.offsetWidth * CARD_SCALE) / 2 + 16;
      const halfH = (el.offsetHeight * CARD_SCALE) / 2 + 16;
      const fit = (v: number, half: number, size: number) =>
        Math.min(size - half, Math.max(half, v));
      cols.current = [...board.querySelectorAll<HTMLElement>("[data-board-col]")].map((marker) => {
        const r = marker.getBoundingClientRect();
        return {
          x: fit(r.left - box.left, halfW, box.width),
          y: fit(r.top - box.top, halfH, box.height),
        };
      });
      place(s.get());
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    observer.observe(el);
    return () => observer.disconnect();
  }, [place, s]);

  return (
    <motion.div ref={ref} className="absolute top-0 left-0 z-10" style={{ x, y }}>
      <div
        className="-translate-x-1/2 -translate-y-1/2"
        style={{ transform: `scale(${CARD_SCALE})` }}
      >
        <FollowedCard
          stage={stages[step].id}
          data-thread-to="board"
          data-thread-from="deck"
          className="transition-shadow duration-300"
          style={{
            boxShadow: `0 0 0 2px ${stages[step].color}, 0 24px 48px -20px rgb(40 20 90 / 0.5)`,
          }}
        />
      </div>
    </motion.div>
  );
}

/** Below lg, and with reduced motion: the board and every stage, still. */
function StillApplications() {
  return (
    <section id="applications" className="pt-20 pb-10 sm:pt-28 sm:pb-16">
      <div
        className={cn(
          CONTAINER,
          "grid grid-cols-1 items-center gap-4 sm:gap-6 lg:grid-cols-5 lg:gap-12",
        )}
      >
        <div className="lg:col-span-2">
          <Heading />
          <StageTimeline s={null} />
        </div>
        <div className="lg:col-span-3">
          <ApplicationBoard />
        </div>
      </div>
    </section>
  );
}
