"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  AnimatePresence,
  MotionConfig,
  animate,
  motion,
  useInView,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";

import { Logo } from "@/components/logo";
import { cn } from "@/lib/cn";

import { hiringSystems, hiringSystemsSection as copy, streams, type StreamPosting } from "./data";
import { FaviconLogo } from "./favicon-logo";
import { FocusIn } from "./focus-in";
import { GrowIn } from "./grow-in";
import { DiagramLabel, HiringSystems, JobCard } from "./hiring-systems";
import { useLoopsHeld, useMediaQuery } from "./hooks";
import { CONTAINER, PANEL, PANEL_INSET, SectionHeading, TOUR_COVER_VH } from "./layout-parts";
import { useLoopClock, useSceneTime, type Cue } from "./scene-time";
import { LineBack, LineFront, Parcel, SIGN_SKEW, lineFor, type Line } from "./sorting-line";
import { GLIDE } from "./story";

/**
 * The hiring-systems section. From lg up it pins in a grey panel, in two
 * phases that the scroll cues and time plays (scene-time.ts): the seven
 * hiring systems WorkIt reads come in as thick 3D coins and keep tumbling in
 * a slowly turning ring beside the heading (after Twain's) for as long as the
 * reader rests there; once the scroll reaches the cue, each coin flies down
 * onto a dock of the sorting line (sorting-line.tsx), drawn in the hero city's
 * isometric style. Then the docks send job postings down the belt as parcels:
 * WorkIt's gate reads each one, a senior role is struck through and pushed
 * off down a chute into a bin, and an internship or new-grad role rides on and
 * comes out as a card at the top of the Jobs page side. Below lg,
 * and with reduced motion, it is the flat stream (hiring-systems.tsx), which
 * stays the still version.
 *
 * It comes in on the tour's own panel (product-tour.tsx): this panel has the
 * tour's size and place, and is pinned behind it, unseen, before the cover's
 * stretch. Over that stretch the tour's card fades out, this panel fades in
 * over the tour's, so one panel seems to change colour, and the heading and
 * coins rise in.
 *
 * Every line here is a claim (data.ts): the hiring systems are the ones
 * the scraper reads, and the steps under WorkIt's mark are pipeline steps.
 */

// Tailwind's lg breakpoint: pinned from here up.
const DESKTOP_QUERY = "(min-width: 64rem)";
/** A window too short for the heading beside the sorting line: the heading
 * goes as the line forms. */
const SHORT_QUERY = "(max-height: 44rem)";

/** A coin's face, in px, and its thickness, drawn as stacked discs. */
const COIN = 76;
const DEPTH = 10;
const LAYERS = 3;
/** How far a coin stands turned on its dock. */
const DOCK_TURN = -24;
/** The flow: px a second along the belt, and the space between two parcels. */
const SPEED = 62;
const SPACING = 168;
/** A posting pill's width. */
const PILL_W = 148;
/** The least time between two cards, and each step's time under the mark,
 * in seconds of the flow's clock. At 1.4 s a card came before the last had
 * settled, and the list never stopped moving. */
const CARD_GAP = 2.8;
const STEP_S = 3.2;
/** Cards on the Jobs page side. */
const CARDS = 3;
/** The pin past the cover's stretch, in vh, while the coins and the line
 * play. */
const PIN_VH = 120;

// The scene's timeline, from 0 to 1: the coins rest in their ring at
// `RING`, fly onto their docks over `MORPH` while the line forms, and the
// postings flow from `FLOWING` on.
const MORPH: [number, number] = [0.4, 0.74];
const LINE_IN: [number, number] = [0.5, 0.76];
const OUTLET_IN: [number, number] = [0.66, 0.8];
/** The flow starts as the line finishes forming; at 0.8 it waited on the
 * outlet's fade too, about 0.13 s more after the scroll's cue. */
const FLOWING = LINE_IN[1];
const RING = MORPH[0];
/** The scroll's cues, as progress through the whole pin, cover included: the
 * ring from the start, then the line a third of the way past the cover. */
const CUES: Cue[] = [
  { at: 0, to: RING },
  { at: (TOUR_COVER_VH + PIN_VH * 0.32) / (TOUR_COVER_VH + PIN_VH), to: 1 },
];
/** The ring's motion, in degrees a second: the ring turning, and each coin
 * tumbling on its axis (each a little faster or slower than the next). One
 * steady pace whether or not the reader scrolls: the scroll used to add
 * its own turn, so the coins spun fast while the page moved and crawled
 * (at 7 and 38) once it stopped. */
const ORBIT = 20;
const TUMBLE = 110;

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const between = (v: number, [a, b]: [number, number]) => clamp((v - a) / (b - a));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** The turn nearest `from` that looks like `to`, so a coin never spins
 * round more than half a turn to settle. */
const nearestTurn = (from: number, to: number) => to + 360 * Math.round((from - to) / 360);

const KEPT = hiringSystems.flatMap((system) => streams[system.name].filter((p) => p.card));

export function HiringSystemsSection() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const reduceMotion = useReducedMotion();
  if (isDesktop === true && !reduceMotion) return <PinnedPipeline />;
  return (
    <section id="hiring-systems" className={PANEL_INSET}>
      <GrowIn className={cn(PANEL, "bg-surface py-20 sm:py-28")}>
        <div className={CONTAINER}>
          <FocusIn>
            <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />
          </FocusIn>
          <HiringSystems />
        </div>
      </GrowIn>
    </section>
  );
}

function PinnedPipeline() {
  const ref = React.useRef<HTMLElement>(null);
  const coverRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const { scrollYProgress: q } = useScroll({ target: ref, offset: ["start start", "end end"] });
  // The cover's stretch: from the tour's last stop to this panel in full.
  const { scrollYProgress: cover } = useScroll({
    target: coverRef,
    offset: ["start start", "end start"],
  });
  const panelIn = useTransform(cover, [0.1, 0.65], [0, 1]);
  // Unseen and behind the tour until then, so it takes no click meant for the
  // tour's tabs.
  const pointerEvents = useTransform(cover, (v) => (v > 0 ? "auto" : "none"));
  // The heading and the coins rise in as the panel settles.
  const entry = useTransform(cover, [0.45, 1], [0, 1]);
  const headingY = useTransform(entry, [0, 1], [18, 0]);

  // The scroll cues the phases; time plays them (scene-time.ts).
  const t = useSceneTime(q, CUES, { rate: 0.3, longest: 2.2 });

  const [line, setLine] = React.useState<Line | null>(null);
  const lineRef = React.useRef<Line | null>(null);
  React.useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const next = lineFor(stage.offsetWidth, stage.offsetHeight, hiringSystems.length);
      lineRef.current = next;
      setLine(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Which phase it rests in: the ring (the coins tumble) or the formed line
  // (the postings flow). Each loop runs only on screen and in a visible
  // tab; the ring's stops while the coins fly, so their landing turns,
  // reckoned from the ring, hold still.
  const [phase, setPhase] = React.useState(() => phaseOf(t.get()));
  useMotionValueEvent(t, "change", (v) => setPhase(phaseOf(v)));
  const [shown, setShown] = React.useState(() => cover.get() > 0);
  useMotionValueEvent(cover, "change", (v) => setShown(v > 0));
  const inView = useInView(stageRef, { amount: 0.2 });
  const held = useLoopsHeld();
  const spin = useLoopClock(phase === "ring" && shown && inView && !held);

  // The line needs the room: the paragraph goes as it forms, and on a short
  // window the heading with it.
  const short = useMediaQuery(SHORT_QUERY) === true;
  const clear = useTransform(t, [RING, RING + 0.14], [1, 0]);
  const headingOpacity = useTransform([entry, clear], ([e, c]: number[]) => (short ? e * c : e));

  return (
    <section
      ref={ref}
      // No clicks on the section itself: it lies over the tour's last stop,
      // and took the tabs' clicks. The panel takes them back once it shows.
      className="pointer-events-none relative z-10"
      style={{
        height: `calc(100dvh + ${TOUR_COVER_VH + PIN_VH}vh)`,
        marginTop: `-${TOUR_COVER_VH * 2}vh`,
      }}
    >
      {/* The anchor is where the panel is in full, past the cover. */}
      <span
        id="hiring-systems"
        aria-hidden="true"
        className="absolute"
        style={{ top: `${TOUR_COVER_VH}vh` }}
      />
      <div
        ref={coverRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{ height: `${TOUR_COVER_VH}vh` }}
      />
      {/* The tour's padding, so this panel lands exactly on the tour's. */}
      <motion.div
        className={cn(PANEL_INSET, "sticky top-0 flex h-dvh flex-col pt-24 pb-6")}
        style={{ opacity: panelIn, pointerEvents }}
      >
        <div className={cn(PANEL, "bg-surface relative isolate min-h-0 flex-1 overflow-hidden")}>
          {/* Tighter on a short window. */}
          <div className="relative z-10 px-10 pt-10 xl:px-14 [@media(max-height:40rem)]:pt-4">
            <motion.div
              className="max-w-[32rem] [&_h2+p]:opacity-[var(--sub)]"
              style={
                {
                  opacity: headingOpacity,
                  y: headingY,
                  "--sub": clear,
                } as React.ComponentProps<typeof motion.div>["style"]
              }
            >
              <SectionHeading
                align="left"
                eyebrow={copy.eyebrow}
                title={copy.title}
                subtitle={copy.subtitle}
              />
            </motion.div>
          </div>
          <div
            ref={stageRef}
            className="absolute inset-x-10 inset-y-8 xl:inset-x-14"
            style={{ perspective: 1100 }}
          >
            {line && (
              <MotionConfig reducedMotion="user">
                <Flow line={line} playing={phase === "flowing"} t={t} />
                {hiringSystems.map((system, i) => (
                  <Coin
                    key={system.name}
                    index={i}
                    logo={system.logo}
                    t={t}
                    entry={entry}
                    spin={spin}
                    line={lineRef}
                  />
                ))}
              </MotionConfig>
            )}
          </div>
        </div>
      </motion.div>
    </section>
  );
}

/** The phase the scene rests in at timeline `v`. */
function phaseOf(v: number) {
  return v >= FLOWING ? "flowing" : v <= RING + 0.001 ? "ring" : "moving";
}

/**
 * A hiring system as a coin: its logo on a white face, an edge of stacked
 * discs and a grey back. In the ring it tumbles on its own axis and rides
 * the slowly turning ring, on its own clock (`spin`, seconds); then it
 * flies down and stands on its dock, smaller, turned a little to the belt.
 */
function Coin({
  index,
  logo,
  t,
  entry,
  spin,
  line,
}: {
  index: number;
  logo: string;
  t: MotionValue<number>;
  entry: MotionValue<number>;
  spin: MotionValue<number>;
  line: React.RefObject<Line | null>;
}) {
  const n = hiringSystems.length;
  /** Where the coin is at timeline `v`, `s` seconds into the ring's
   * turning. (The section's arrival only grows it, below.) */
  const pose = (v: number, s: number) => {
    const l = line.current;
    if (!l) return { x: 0, y: 0, rotate: 0, rotateX: 0, rotateY: 0, size: 1 };
    // Round the ring, the ring itself turning on its clock, never on the
    // scroll, so the pace holds when the reader stops.
    const angle = (index * 360) / n - 90 + ORBIT * s;
    const rad = (angle * Math.PI) / 180;
    const ring = {
      x: l.ring.x + Math.cos(rad) * l.ring.r,
      y: l.ring.y + Math.sin(rad) * l.ring.r,
      // Near upright, each a little askew: turned with its place on the
      // ring, a logo stood on its side or upside down at the ring's foot.
      rotate: 10 * Math.sin(index * 1.7),
      rotateX: 14 * Math.cos(index * 2.1),
      rotateY: 50 + 28 * Math.sin(index * 1.7) + TUMBLE * (0.85 + 0.3 * ((index * 0.37) % 1)) * s,
    };
    // Then to its dock, one coin a little after another, on an arc.
    const t = ease(clamp((v - MORPH[0] - index * 0.02) / (MORPH[1] - MORPH[0] - 0.12)));
    return {
      x: lerp(ring.x, l.coins[index].x, t),
      y: lerp(ring.y, l.coins[index].y, t) - Math.sin(Math.PI * t) * 60,
      rotate: lerp(ring.rotate, nearestTurn(ring.rotate, 0), t),
      rotateX: lerp(ring.rotateX, 0, t),
      rotateY: lerp(ring.rotateY, nearestTurn(ring.rotateY, DOCK_TURN), t),
      size: lerp(1, l.coinScale, t),
    };
  };
  // One pose a frame, as one transform: a call per part ran pose five
  // times a frame for each coin.
  const transform = useTransform([t, entry, spin], ([v, e, s]: number[]) => {
    const { x, y, rotate, rotateX, rotateY, size } = pose(v, s);
    const scale = lerp(0.5, 1, ease(e)) * size;
    return `translate(${x - COIN / 2}px, ${y - COIN / 2}px) scale(${scale}) rotate(${rotate}deg) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  });
  // The fade is on the faces, never the root: below full opacity the root
  // would flatten its 3D, and the coin would be a flat disc until it ended.
  const opacity = useTransform(entry, [1 / 7, 6 / 7], [0, 1]);

  return (
    <motion.div
      aria-hidden="true"
      className="absolute top-0 left-0 z-[11] will-change-transform"
      style={{ transform, width: COIN, height: COIN, transformStyle: "preserve-3d" }}
    >
      {Array.from({ length: LAYERS }, (_, k) => (
        <motion.span
          key={k}
          className="absolute inset-0 rounded-full"
          style={{
            transform: `translateZ(${-DEPTH / 2 + ((k + 1) * DEPTH) / (LAYERS + 1)}px)`,
            background: k % 2 ? "#d6d4de" : "#e3e1ea",
            opacity,
          }}
        />
      ))}
      {/* The back carries the logo too, turned to read the right way
          round: blank, each coin hid its hiring system for half its
          tumble. */}
      <motion.span
        className="absolute inset-0 grid place-items-center rounded-full bg-[#ebe9f1]"
        style={{ transform: `translateZ(${-DEPTH / 2}px) rotateY(180deg)`, opacity }}
      >
        <Image src={logo} alt="" width={64} height={64} className="size-[54%] rounded-[22%]" />
      </motion.span>
      <motion.span
        className="absolute inset-0 grid place-items-center rounded-full bg-white shadow-[inset_0_0_0_3px_#f1f0f5,inset_0_0_0_4px_rgb(76_39_163/0.08)]"
        style={{ transform: `translateZ(${DEPTH / 2}px)`, opacity }}
      >
        <Image src={logo} alt="" width={64} height={64} className="size-[54%] rounded-[22%]" />
      </motion.span>
    </motion.div>
  );
}

/**
 * The line, the parcels on it, WorkIt's mark on the gate and the cards it lets
 * out. One clock (seconds) drives the flow; it moves only while the line has
 * formed, the panel is in view and the tab is visible. The parcels ride a
 * conveyor of evenly spaced places, so they never overlap; each place is
 * given to the hiring systems in turn and shows its posting from that
 * system's dock on.
 */
function Flow({ line, playing, t }: { line: Line; playing: boolean; t: MotionValue<number> }) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { amount: 0.2 });
  const held = useLoopsHeld();
  const clock = useLoopClock(playing && inView && !held);

  const built = useTransform(t, (v) => ease(between(v, LINE_IN)));
  const rise = useTransform(built, (v) => (1 - v) * 18);
  const outlet = useTransform(t, (v) => ease(between(v, OUTLET_IN)));
  // Faded in with WorkIt's mark, for a return to a flow already running;
  // the first time, the belt starts empty (Posting's `fresh`).
  const shown = useTransform(t, [OUTLET_IN[0], FLOWING], [0, 1]);
  const places = Math.ceil(line.run / SPACING) + 1;
  const loop = places * SPACING;
  const [pills, setPills] = React.useState<HTMLDivElement | null>(null);

  // Kept postings wait here between reaching the belt's end and coming out
  // as a card, so cards never come faster than CARD_GAP.
  const queue = React.useRef<StreamPosting[]>([]);
  const lastCard = React.useRef(-Infinity);
  const [feed, setFeed] = React.useState({ cards: KEPT.slice(0, CARDS), arrivals: 0 });
  const onEnter = React.useCallback((posting: StreamPosting) => {
    if (queue.current.length < 2) queue.current.push(posting);
  }, []);
  const [step, setStep] = React.useState(0);
  const shownStep = React.useRef(0);
  useMotionValueEvent(clock, "change", (t) => {
    const next = Math.floor(t / STEP_S) % copy.steps.length;
    if (next !== shownStep.current) {
      shownStep.current = next;
      setStep(next);
    }
    if (queue.current.length && t - lastCard.current >= CARD_GAP) {
      const posting = queue.current.shift()!;
      lastCard.current = t;
      setFeed((prev) => ({
        cards: [...prev.cards.filter((p) => p !== posting), posting].slice(-CARDS),
        arrivals: prev.arrivals + 1,
      }));
    }
  });

  // WorkIt's mark pulses as each card comes out.
  const pulse = useMotionValue(1);
  React.useEffect(() => {
    if (feed.arrivals === 0) return;
    const controls = animate(pulse, [1, 1.08, 1], { duration: 0.5, ease: GLIDE });
    return () => controls.stop();
  }, [feed.arrivals, pulse]);

  // The newest on top, so the oldest leaves at the foot: sorted by score, a
  // new card landed anywhere in the list and read as unrelated to the belt.
  const cards = [...feed.cards].reverse();
  const cardsTop = Math.min(line.h - 320, Math.max(0, line.end.y - 160));

  return (
    <div ref={rootRef} className="absolute inset-0">
      <LineBack line={line} clock={clock} speed={SPEED} style={{ opacity: built, y: rise }} />

      {/* The parcels, between the gate's far post and its near one. */}
      <motion.div className="absolute inset-0 z-[12]" style={{ opacity: shown }}>
        {Array.from({ length: places }, (_, k) => (
          <Posting
            key={k}
            place={k}
            places={places}
            loop={loop}
            clock={clock}
            line={line}
            pills={pills}
            onEnter={onEnter}
          />
        ))}
      </motion.div>

      <LineFront line={line} style={{ opacity: built, y: rise }} />

      {/* Their pills, over the gate: under it, the near post crossed each
          title. */}
      <motion.div
        ref={setPills}
        className="pointer-events-none absolute inset-0 z-[15]"
        style={{ opacity: shown }}
      />

      {/* WorkIt's mark on the gate. */}
      <motion.div
        className="absolute z-20"
        style={{ left: line.mark.x - 30, top: line.mark.y - 30, opacity: outlet }}
      >
        {feed.arrivals > 0 && (
          <motion.span
            key={feed.arrivals}
            className="ring-brand/40 absolute inset-0 rounded-[18px] ring-2"
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: 1.5, opacity: 0 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        )}
        <motion.div
          className="glass-card grid size-[60px] place-items-center rounded-[18px]"
          style={{ scale: pulse }}
        >
          <Logo size="mark" decorative className="h-6" />
        </motion.div>
      </motion.div>

      {/* The step WorkIt is on, on an LED sign by the belt. */}
      <motion.div
        className="absolute z-20"
        style={{ left: line.sign.x - SIGN_W / 2, top: line.sign.y, opacity: outlet }}
      >
        <StatusSign step={step} />
      </motion.div>

      {/* The Jobs page side: the newest kept postings as clean cards, the
          newest on top. */}
      <motion.div
        className="absolute right-0 z-20 flex flex-col"
        style={{ left: line.cardsLeft, top: cardsTop, opacity: outlet }}
      >
        <div className="mb-3">
          <DiagramLabel>{copy.output}</DiagramLabel>
        </div>
        <ul aria-hidden="true" className="flex flex-col gap-2.5">
          <AnimatePresence mode="popLayout" initial={false}>
            {cards.map((posting) => (
              <JobCard key={posting.company} posting={posting} wide />
            ))}
          </AnimatePresence>
        </ul>
      </motion.div>
    </div>
  );
}

/** The sign's width, in px. */
const SIGN_W = 224;

/**
 * What WorkIt is doing to the stream, as a roadside LED sign on two posts,
 * standing by the belt and skewed to the belt's own line. The words roll over
 * on a dark board, and a lamp per step shows which it is on. They are pipeline
 * steps, so each is a claim (data.ts). A line of small grey text under the
 * belt was easy to miss, and said nothing about the machine it belonged to.
 */
function StatusSign({ step }: { step: number }) {
  return (
    <div className="relative" style={{ width: SIGN_W, transform: `skewY(${SIGN_SKEW}deg)` }}>
      <span className="absolute top-full left-7 h-7 w-1 bg-[#7653dd]" />
      <span className="absolute top-full right-7 h-7 w-1 bg-[#7653dd]" />
      <div className="relative overflow-hidden rounded-lg bg-[#17132e] px-3 pt-2.5 pb-2 shadow-[0_14px_26px_-12px_rgb(40_20_90/0.6)] ring-2 ring-[#7653dd]">
        {/* The board's dots. */}
        <span className="absolute inset-0 bg-[radial-gradient(rgb(255_255_255/0.07)_1px,transparent_1.2px)] [background-size:4px_4px]" />
        <div className="relative h-9 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={step}
              className="flex h-full items-center font-mono text-[12px] leading-[1.25] font-semibold tracking-wide text-[#e9e2ff] uppercase [text-shadow:0_0_10px_rgb(167_139_250/0.9)]"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "-100%", transition: { duration: 0.2, ease: "easeIn" } }}
              transition={{ duration: 0.35, ease: GLIDE }}
            >
              {copy.steps[step]}
            </motion.p>
          </AnimatePresence>
        </div>
        <div className="relative mt-1.5 flex gap-1.5">
          {copy.steps.map((text, i) => (
            <span
              key={text}
              className={cn(
                "size-1.5 rounded-full transition-colors duration-300",
                i === step ? "bg-[#c4b5fd] shadow-[0_0_8px_rgb(196_181_253/0.95)]" : "bg-white/15",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** A pixel of slack where a place is compared with a dock it starts on
 * (Posting). */
const EPS = 1;

/**
 * One place on the conveyor. Each lap it is given the next hiring system
 * in turn and that system's next posting; it slides off that system's dock
 * onto the belt, and at the gate either rides on to the belt's end (a role
 * the scraper keeps) or is struck through and pushed off down the chute into
 * the bin (a senior role).
 */
function Posting({
  place,
  places,
  loop,
  clock,
  line,
  pills,
  onEnter,
}: {
  place: number;
  places: number;
  loop: number;
  clock: MotionValue<number>;
  line: Line;
  pills: HTMLDivElement | null;
  onEnter: (posting: StreamPosting) => void;
}) {
  const n = hiringSystems.length;
  const docks = line.dockU;
  // The conveyor starts with a place at the last dock, so the first parcel
  // is under way as the flow begins: from a place further back, the belt
  // stood empty for seconds.
  const lastDock = docks[n - 1];
  const start = lastDock - Math.floor(lastDock / SPACING) * SPACING;
  const travel = (t: number) => SPEED * t + place * SPACING + start;
  const lapAt = (t: number) => Math.floor(travel(t) / loop);
  // On the first lap a place takes the dock just ahead of where it starts,
  // so it comes off it within a second of the flow beginning. Given the
  // systems in turn from the start, every place but the first began past its
  // dock, so it stayed hidden (`fresh`) for a whole lap (KAN-368). A place
  // with no dock ahead keeps its turn; it shows from its next lap. Both tests
  // allow a pixel (`EPS`): the first place starts exactly at the last dock,
  // and rounding put it a hair past on some frames and not on others.
  const firstLap = docks.findIndex((c) => c >= travel(0) - EPS);
  const systemOn = (lap: number) =>
    lap === 0 && firstLap >= 0 ? firstLap : (((lap * places + place) % n) + n) % n;
  const postingOn = (lap: number) => {
    const list = streams[hiringSystems[systemOn(lap)].name];
    const turn = Math.floor((lap * places + place) / n);
    return list[((turn % list.length) + list.length) % list.length];
  };

  const pose = (t: number) => {
    const lap = lapAt(t);
    const u = travel(t) - lap * loop;
    const from = docks[systemOn(lap)];
    const kept = Boolean(postingOn(lap).card);
    // Shown only once it has left its dock since the flow began, so the belt
    // fills from the docks: shown from the start, three parcels appeared at
    // once in the middle of the belt.
    const fresh = u - from <= SPEED * t + EPS;
    // Off the dock, across onto the belt.
    const born = clamp((u - from) / 40);
    // The gate's verdict, as it passes under.
    const read = clamp((u - (line.gateU - 26)) / 44);
    // A dropped parcel stops at the chute and slides down it.
    const push = kept ? 0 : clamp((u - line.pushU) / 80);
    const gone = kept ? clamp((u - (line.run - 36)) / 36) : clamp((push - 0.7) / 0.3);
    const at = line.at(
      kept ? Math.min(u, line.run) : Math.min(u, line.pushU),
      lerp(line.dockD, 0, ease(born)) + line.chute * push,
      -34 * push * push,
    );
    const seen = u < from || !fresh ? 0 : born * (1 - gone);
    return {
      lap,
      x: at.x,
      y: at.y,
      scale: (0.8 + 0.2 * born) * (1 - 0.4 * gone),
      opacity: seen,
      pill: seen * (1 - clamp(push * 2.4)),
      strike: kept ? 0 : read,
      keptLid: kept ? 0.55 * read : 0,
      droppedLid: kept ? 0 : 0.6 * read,
      // A kept parcel has reached the belt's end.
      inside: kept && fresh && u >= line.run,
    };
  };

  const p = useTransform(clock, pose);
  const x = useTransform(p, (v) => v.x);
  const y = useTransform(p, (v) => v.y);
  const scale = useTransform(p, (v) => v.scale);
  const opacity = useTransform(p, (v) => v.opacity);
  const pill = useTransform(p, (v) => v.pill);
  const strike = useTransform(p, (v) => v.strike);
  const keptLid = useTransform(p, (v) => v.keptLid);
  const droppedLid = useTransform(p, (v) => v.droppedLid);
  // Dimmed only a little: the strike already marks it, and "Senior" must
  // stay readable.
  const dim = useTransform(p, (v) => 1 - 0.3 * v.strike);

  // A kept posting goes on to be a card as it reaches the belt's end: sent
  // when its lap ended, each card came some six seconds after its parcel, and
  // read as unrelated to it. The lap is kept in a ref as well as state, as in
  // the flat stream: a listener that saw the old lap in state set it again in
  // the same render.
  const [lap, setLap] = React.useState(() => lapAt(clock.get()));
  const seenLap = React.useRef(lap);
  const enteredLap = React.useRef<number | null>(null);
  useMotionValueEvent(p, "change", (next) => {
    if (next.inside && enteredLap.current !== next.lap) {
      enteredLap.current = next.lap;
      onEnter(postingOn(next.lap));
    }
    if (next.lap === seenLap.current) return;
    seenLap.current = next.lap;
    setLap(next.lap);
  });
  const posting = postingOn(lap);
  // The level ("Intern", "New Grad", "Co-op") stays whole while the role
  // before it is cut short: it is why WorkIt keeps the posting, as
  // "Senior" at a title's start is why it drops one.
  const [, role, level] = /^(.*?)(,? (?:Intern|New Grad|Co-op))?$/.exec(posting.title) ?? [];

  return (
    <>
      <motion.div
        className="absolute top-0 left-0 will-change-transform"
        style={{ x, y, scale, opacity }}
      >
        <Parcel kept={keptLid} dropped={droppedLid} />
      </motion.div>
      {pills &&
        createPortal(
          <motion.div
            className="absolute top-0 left-0 will-change-transform"
            style={{ x, y, scale }}
          >
            <motion.div
              className="gloss-card text-ink absolute -top-[72px] flex h-7 items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-[11px] font-medium whitespace-nowrap"
              style={{ width: PILL_W, left: -PILL_W / 2, opacity: pill }}
            >
              <FaviconLogo domain={posting.domain} eager className="size-5 rounded-full" />
              <motion.span className="relative flex min-w-0" style={{ opacity: dim }}>
                <span className="truncate">{role}</span>
                {level && <span className="shrink-0 whitespace-pre">{level}</span>}
                {/* The strike, drawn in left to right as a scale: a growing
                    background size repainted the chip on every frame. */}
                <motion.span
                  aria-hidden="true"
                  className="bg-danger absolute inset-x-0 h-[1.5px] origin-left"
                  style={{ top: "calc(55% - 0.825px)", scaleX: strike }}
                />
              </motion.span>
            </motion.div>
          </motion.div>,
          pills,
        )}
    </>
  );
}
