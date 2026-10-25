"use client";

import * as React from "react";
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
import { useMediaQuery, usePageHidden } from "./hooks";
import { CONTAINER, PANEL, PANEL_INSET, SectionHeading } from "./layout-parts";
import { useLoopClock, useSceneTime, type Cue } from "./scene-time";
import { GLIDE } from "./story";

/**
 * The hiring-systems section, after Twain's ring of logo coins. From lg up
 * it pins in a grey panel, in two phases that the scroll cues and time
 * plays (scene-time.ts): the seven hiring systems WorkIt reads come in as
 * thick 3D coins and keep tumbling in a slowly turning ring beside the
 * heading for as long as the reader rests there; once the scroll reaches
 * the cue, each coin swings onto a glass pipe as one of its couplings and
 * the pipe runs into WorkIt's mark. Then job postings keep coming out of
 * each coupling and flowing down the pipe: a senior role is struck through
 * and filtered out, an internship or new-grad role goes into WorkIt and
 * comes out as a card on the Jobs page side, sorted by Best Match. Below
 * lg, and with reduced motion, it is the flat stream (hiring-systems.tsx),
 * which stays the still version.
 *
 * Every line here is a claim (data.ts): the hiring systems are the ones
 * the scraper reads, and the steps under WorkIt's mark are pipeline steps.
 */

// Tailwind's lg breakpoint: pinned from here up.
const DESKTOP_QUERY = "(min-width: 64rem)";

/** A coin's face, in px, and its thickness, drawn as stacked discs. */
const COIN = 76;
const DEPTH = 10;
const LAYERS = 3;
/** The pipe's height in px, and how far its couplings turn to the side. */
const PIPE = 52;
const COUPLING_TURN = 66;
/** The flow: px a second, and the space between two postings. */
const SPEED = 62;
const SPACING = 168;
/** A posting pill's width: fixed, so its right edge is known and it can
 * stop at WorkIt's mark and fold into it, rather than slide under it. */
const PILL_W = 148;
/** WorkIt's mark: its size, and the gap a pill keeps from it. */
const MARK = 76;
const MARK_GAP = 10;
/** The least time between two cards, and each step's time under the mark,
 * in seconds of the flow's clock. At 1.4 s a card came before the last had
 * settled, and the list never stopped moving. */
const CARD_GAP = 2.8;
const STEP_S = 3.2;
/** Cards on the Jobs page side. */
const CARDS = 3;

// The scene's timeline, from 0 to 1: the coins rest in their ring at
// `RING`, fly onto the pipe over `MORPH` while it forms, and the postings
// flow from `FLOWING` on.
const MORPH: [number, number] = [0.4, 0.74];
const PIPE_IN: [number, number] = [0.56, 0.76];
const OUTLET_IN: [number, number] = [0.66, 0.8];
/** The flow starts as the pipe finishes forming; at 0.8 it waited on the
 * outlet's fade too, about 0.13 s more after the scroll's cue. */
const FLOWING = PIPE_IN[1];
const RING = MORPH[0];
/** The scroll's cues: the ring from the start, then the pipe once the
 * pinned stretch is a third through. */
const CUES: Cue[] = [
  { at: 0, to: RING },
  { at: 0.32, to: 1 },
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

/** Where things sit on the stage, from its size. */
function layoutFor(w: number, h: number) {
  const pipeY = h * 0.68;
  const outletX = w * 0.655;
  // The couplings sit together at the intake end, like a manifold, so the
  // rest of the pipe is clear and a posting's title can be read before
  // WorkIt filters it: spread along the whole pipe they hid most titles.
  // The first coin's edge sits on the heading's left edge (the stage's
  // own), so the pipeline lines up with the text above it.
  const first = 30;
  const last = first + w * 0.29;
  // The pipe starts just behind the first coupling, so that coin covers
  // its end: started further left, the rounded end showed past the coin
  // as a stray pale circle.
  const pipeLeft = first - 8;
  return {
    w,
    h,
    ring: { x: w * 0.76, y: h * 0.45, r: Math.min(w * 0.2, h * 0.31, 190) },
    pipeY,
    pipeLeft,
    outletX,
    couplings: hiringSystems.map(
      (_, i) => first + (i * (last - first)) / (hiringSystems.length - 1),
    ),
  };
}
type Layout = ReturnType<typeof layoutFor>;

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
  const stageRef = React.useRef<HTMLDivElement>(null);
  const { scrollYProgress: q } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const { scrollYProgress: entry } = useScroll({
    target: ref,
    offset: ["start end", "start start"],
  });

  // The scroll cues the phases; time plays them (scene-time.ts).
  const t = useSceneTime(q, CUES, { rate: 0.3, longest: 2.2 });

  const [layout, setLayout] = React.useState<Layout | null>(null);
  const layoutRef = React.useRef<Layout | null>(null);
  React.useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const next = layoutFor(stage.offsetWidth, stage.offsetHeight);
      layoutRef.current = next;
      setLayout(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Which phase it rests in: the ring (the coins tumble) or the formed pipe
  // (the postings flow). Each loop runs only on screen and in a visible
  // tab; the ring's stops while the coins fly, so their landing turns,
  // reckoned from the ring, hold still.
  const [phase, setPhase] = React.useState(() => phaseOf(t.get()));
  useMotionValueEvent(t, "change", (v) => setPhase(phaseOf(v)));
  const inView = useInView(stageRef, { amount: 0.2 });
  const hidden = usePageHidden();
  const spin = useLoopClock(phase === "ring" && inView && !hidden);

  return (
    <section ref={ref} id="hiring-systems" className="h-[220vh]">
      <div className={cn(PANEL_INSET, "sticky top-0 flex h-dvh flex-col pt-20 pb-4")}>
        <div className={cn(PANEL, "bg-surface relative isolate min-h-0 flex-1 overflow-hidden")}>
          <div className="relative z-10 px-10 pt-10 xl:px-14">
            <div className="max-w-[32rem]">
              <FocusIn>
                <SectionHeading
                  align="left"
                  eyebrow={copy.eyebrow}
                  title={copy.title}
                  subtitle={copy.subtitle}
                />
              </FocusIn>
            </div>
          </div>
          <div
            ref={stageRef}
            className="absolute inset-x-10 inset-y-8 xl:inset-x-14"
            style={{ perspective: 1100 }}
          >
            {layout && (
              <MotionConfig reducedMotion="user">
                <Pipe t={t} layout={layout} />
                <Flow layout={layout} playing={phase === "flowing"} t={t} />
                {hiringSystems.map((system, i) => (
                  <Coin
                    key={system.name}
                    index={i}
                    logo={system.logo}
                    t={t}
                    entry={entry}
                    spin={spin}
                    layout={layoutRef}
                  />
                ))}
              </MotionConfig>
            )}
          </div>
        </div>
      </div>
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
 * flies to its place on the pipe and turns side-on, a coupling around the
 * pipe.
 */
function Coin({
  index,
  logo,
  t,
  entry,
  spin,
  layout,
}: {
  index: number;
  logo: string;
  t: MotionValue<number>;
  entry: MotionValue<number>;
  spin: MotionValue<number>;
  layout: React.RefObject<Layout | null>;
}) {
  const n = hiringSystems.length;
  /** Where the coin is at timeline `v`, `s` seconds into the ring's
   * turning. (The section's arrival only grows it, below.) */
  const pose = (v: number, s: number) => {
    const l = layout.current;
    if (!l) return { x: 0, y: 0, rotate: 0, rotateX: 0, rotateY: 0 };
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
    // Then to its place on the pipe, one coin a little after another, on
    // an arc.
    const t = ease(clamp((v - MORPH[0] - index * 0.02) / (MORPH[1] - MORPH[0] - 0.12)));
    return {
      x: lerp(ring.x, l.couplings[index], t),
      y: lerp(ring.y, l.pipeY, t) - Math.sin(Math.PI * t) * 60,
      rotate: lerp(ring.rotate, nearestTurn(ring.rotate, 0), t),
      rotateX: lerp(ring.rotateX, 0, t),
      rotateY: lerp(ring.rotateY, nearestTurn(ring.rotateY, COUPLING_TURN), t),
    };
  };
  // One pose a frame, as one transform: a call per part ran pose five
  // times a frame for each coin.
  const transform = useTransform([t, entry, spin], ([v, e, s]: number[]) => {
    const { x, y, rotate, rotateX, rotateY } = pose(v, s);
    const scale = lerp(0.5, 1, ease(e));
    return `translate(${x - COIN / 2}px, ${y - COIN / 2}px) scale(${scale}) rotate(${rotate}deg) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  });
  // The fade is on the faces, never the root: below full opacity the root
  // would flatten its 3D, and the coin would be a flat disc until it ended.
  const opacity = useTransform(entry, [1 / 7, 6 / 7], [0, 1]);

  return (
    <motion.div
      aria-hidden="true"
      className="absolute top-0 left-0 z-20 will-change-transform"
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

/** The glass pipe, WorkIt's mark at its outlet, and the labels at each
 * end. They come in once the coins are on their way. */
function Pipe({ t, layout }: { t: MotionValue<number>; layout: Layout }) {
  const grow = useTransform(t, (v) => ease(between(v, PIPE_IN)));
  const outlet = useTransform(t, (v) => ease(between(v, OUTLET_IN)));
  const labelY = useTransform(outlet, (v) => (1 - v) * 10);
  const length = layout.outletX - layout.pipeLeft;
  const top = layout.pipeY - PIPE / 2;

  return (
    <div aria-hidden="true">
      {/* The pipe: a back wall, then (in Flow) the postings, then the
          glass front over them. */}
      <motion.div
        className="absolute rounded-full"
        style={{
          left: layout.pipeLeft,
          top,
          width: length,
          height: PIPE,
          scaleX: grow,
          opacity: grow,
          transformOrigin: "0% 50%",
          background: "linear-gradient(180deg, #e2ddf3 0%, #f6f4fc 34%, #ebe7f8 70%, #d3cdea 100%)",
          boxShadow: "inset 0 2px 6px rgb(40 20 90 / 0.12), 0 18px 30px -18px rgb(40 20 90 / 0.35)",
        }}
      />
      <motion.div
        className="absolute z-[15] rounded-full"
        style={{
          left: layout.pipeLeft,
          top,
          width: length,
          height: PIPE,
          scaleX: grow,
          opacity: grow,
          transformOrigin: "0% 50%",
          background:
            "linear-gradient(180deg, rgb(255 255 255 / 0.85) 0%, rgb(255 255 255 / 0.25) 22%, rgb(255 255 255 / 0) 55%, rgb(109 63 216 / 0.07) 100%)",
          boxShadow: "inset 0 0 0 1px rgb(76 39 163 / 0.14)",
        }}
      />
      {/* No cap drawn on the intake end: the pipe's own rounded end reads
          as it is, and an open-end ellipse there looked like a stray
          circle. */}

      <motion.div
        className="absolute"
        style={{ left: 0, top: top - 34, opacity: outlet, y: labelY }}
      >
        <DiagramLabel>{copy.intake}</DiagramLabel>
      </motion.div>
    </div>
  );
}

/**
 * The postings in the pipe, WorkIt's mark and the cards it lets out. One
 * clock (seconds) drives the flow; it moves only while the pipe has formed,
 * the panel is in view and the tab is visible. The postings ride a
 * conveyor of evenly spaced places, so they never overlap; each place is
 * given to the hiring systems in turn and shows its posting from that
 * system's coupling on.
 */
function Flow({
  layout,
  playing,
  t,
}: {
  layout: Layout;
  playing: boolean;
  t: MotionValue<number>;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { amount: 0.2 });
  const hidden = usePageHidden();
  const clock = useLoopClock(playing && inView && !hidden);

  const outlet = useTransform(t, (v) => ease(between(v, OUTLET_IN)));
  // Faded in with WorkIt's mark, for a return to a flow already running;
  // the first time, the pipe starts empty (Posting's `fresh`).
  const shown = useTransform(t, [OUTLET_IN[0], FLOWING], [0, 1]);
  const run = layout.outletX - layout.pipeLeft;
  const places = Math.ceil(run / SPACING) + 1;
  const loop = places * SPACING;

  // Kept postings wait here between entering WorkIt and coming out as a
  // card, so cards never come faster than CARD_GAP.
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

  const cards = [...feed.cards].sort((a, b) => (b.card?.score ?? 0) - (a.card?.score ?? 0));
  const cardsLeft = layout.outletX + 70;

  return (
    <div ref={rootRef} className="absolute inset-0">
      {/* The postings, inside the pipe: between its back wall and its
          glass front. */}
      <motion.div className="absolute inset-0 z-[12]" style={{ opacity: shown }}>
        {Array.from({ length: places }, (_, k) => (
          <Posting
            key={k}
            place={k}
            places={places}
            loop={loop}
            clock={clock}
            layout={layout}
            onEnter={onEnter}
          />
        ))}
      </motion.div>

      {/* WorkIt's mark, and under it the step it is on. Plain glass on the
          grey panel: a violet glow behind it read as decoration. */}
      <motion.div
        className="absolute z-20"
        style={{
          left: layout.outletX - MARK / 2,
          top: layout.pipeY - MARK / 2,
          opacity: outlet,
        }}
      >
        {feed.arrivals > 0 && (
          <motion.span
            key={feed.arrivals}
            className="ring-brand/40 absolute inset-0 rounded-[22px] ring-2"
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: 1.5, opacity: 0 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        )}
        <motion.div
          className="glass-card grid size-[76px] place-items-center rounded-[22px]"
          style={{ scale: pulse }}
        >
          <Logo size="mark" decorative className="h-7" />
        </motion.div>
        <div className="absolute top-full left-1/2 mt-3 w-44 -translate-x-1/2 text-center">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={step}
              className="text-ink-muted text-xs leading-snug font-medium text-balance"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.15 } }}
              transition={{ duration: 0.3, ease: GLIDE }}
            >
              {copy.steps[step]}
            </motion.p>
          </AnimatePresence>
        </div>
      </motion.div>

      {/* The Jobs page side: the newest kept postings as clean cards, best
          match first. */}
      <motion.div
        className="absolute right-0 z-20 flex flex-col justify-center"
        style={{
          left: cardsLeft,
          top: layout.pipeY - 150,
          height: 300,
          opacity: outlet,
        }}
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

/** A pixel of slack where a place is compared with a coupling it starts
 * on (Posting). */
const EPS = 1;

/**
 * One place on the conveyor. Each lap it is given the next hiring system
 * in turn and that system's next posting; it shows from that system's
 * coupling on, then either goes into WorkIt (a role the scraper keeps) or
 * is struck through and filtered out just before it (a senior role).
 */
function Posting({
  place,
  places,
  loop,
  clock,
  layout,
  onEnter,
}: {
  place: number;
  places: number;
  loop: number;
  clock: MotionValue<number>;
  layout: Layout;
  onEnter: (posting: StreamPosting) => void;
}) {
  const n = hiringSystems.length;
  // The conveyor starts with a place at the last coupling, the manifold's
  // outlet, so the first posting clears the coins as the flow begins: the
  // coins cover the pipe up to there, and from a place further back a
  // posting rode hidden behind them for seconds.
  const outletRun = layout.couplings[n - 1] - layout.pipeLeft;
  const start = outletRun - Math.floor(outletRun / SPACING) * SPACING;
  const travel = (t: number) => SPEED * t + place * SPACING + start;
  const lapAt = (t: number) => Math.floor(travel(t) / loop);
  // On the first lap a place takes the coupling just ahead of where it
  // starts, so it comes out of it within a second of the flow beginning.
  // Given the systems in turn from the start, every place but the first
  // began past its coupling, so it stayed hidden (`fresh`) for a whole
  // lap: one posting rode an empty pipe for about seven seconds after the
  // pipe formed, which read as a long delay (KAN-368). A place with no
  // coupling ahead keeps its turn; it shows from its next lap. Both tests
  // allow a pixel (`EPS`): the first place starts exactly at the last
  // coupling, and rounding put it a hair past on some frames and not on
  // others, so that posting flickered all the way down the pipe.
  const firstLap = layout.couplings.findIndex((c) => c >= layout.pipeLeft + travel(0) - EPS);
  const systemOn = (lap: number) =>
    lap === 0 && firstLap >= 0 ? firstLap : (((lap * places + place) % n) + n) % n;
  const postingOn = (lap: number) => {
    const list = streams[hiringSystems[systemOn(lap)].name];
    const turn = Math.floor((lap * places + place) / n);
    return list[((turn % list.length) + list.length) % list.length];
  };

  const pose = (t: number) => {
    const lap = lapAt(t);
    const x = layout.pipeLeft + (travel(t) - lap * loop);
    const from = layout.couplings[systemOn(lap)];
    const kept = Boolean(postingOn(lap).card);
    // Shown only once it has come out of its coupling since the flow began,
    // so the pipe fills from the couplings: shown from the start, three
    // postings appeared at once in the middle of the pipe.
    const fresh = x - from <= SPEED * t + EPS;
    // Where the pill's left edge is when its right edge meets WorkIt's
    // mark: it never goes further, so it never slides under the mark.
    const end = layout.outletX - MARK / 2 - MARK_GAP - PILL_W;
    // Out of the coupling: it grows out of the ring around the pipe.
    const born = clamp((x - from) / 36);
    // A senior role is struck through and drops out well before the mark;
    // a kept one folds into it, shrinking towards its right edge, which
    // holds at the mark (scaled from its left edge, so moved by the width
    // it loses).
    const strike = kept ? 0 : clamp((x - (end - 150)) / 50);
    const gone = kept ? clamp((x - (end - 40)) / 40) : clamp((x - (end - 90)) / 40);
    const fold = kept ? 1 - 0.55 * gone : 1 - 0.3 * gone;
    return {
      lap,
      x: Math.min(x, end) + (kept ? PILL_W * (1 - fold) : 0),
      scale: (0.7 + 0.3 * born) * fold,
      opacity: x < from || !fresh ? 0 : born * (1 - gone),
      strike,
      y: kept ? 0 : gone * 10,
      // A kept posting has folded into WorkIt's mark.
      inside: kept && fresh && x >= end,
    };
  };

  const p = useTransform(clock, pose);
  const x = useTransform(p, (v) => v.x);
  const y = useTransform(p, (v) => layout.pipeY - 14 + v.y);
  const scale = useTransform(p, (v) => v.scale);
  const opacity = useTransform(p, (v) => v.opacity);
  const strike = useTransform(p, (v) => v.strike);
  // Dimmed only a little: the strike already marks it, and "Senior" must
  // stay readable.
  const dim = useTransform(p, (v) => 1 - 0.3 * v.strike);

  // A kept posting goes on to be a card as it folds into WorkIt's mark: sent
  // when its lap ended, out of sight past the mark, each card came some six
  // seconds after its posting went in, and read as unrelated to it. The
  // lap is kept in a ref as well as state, as in the flat stream: a
  // listener that saw the old lap in state set it again in the same render.
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
    <motion.div
      className="absolute top-0 left-0 origin-left will-change-transform"
      style={{ x, y, scale, opacity }}
    >
      <div
        className="gloss-card text-ink flex h-7 items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-[11px] font-medium whitespace-nowrap"
        style={{ width: PILL_W }}
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
      </div>
    </motion.div>
  );
}
