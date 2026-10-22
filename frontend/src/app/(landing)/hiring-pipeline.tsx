"use client";

import * as React from "react";
import Image from "next/image";
import {
  AnimatePresence,
  MotionConfig,
  animate,
  cancelFrame,
  frame,
  motion,
  useInView,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type FrameData,
  type MotionValue,
} from "motion/react";
import { ArrowDownWideNarrow, RefreshCw } from "lucide-react";

import { Logo } from "@/components/logo";
import { cn } from "@/lib/cn";

import { hiringSystems, hiringSystemsSection as copy, streams, type StreamPosting } from "./data";
import { FaviconLogo } from "./favicon-logo";
import { FocusIn } from "./focus-in";
import { GrowIn } from "./grow-in";
import { HiringSystems, JobCard } from "./hiring-systems";
import { useMediaQuery, usePageHidden } from "./hooks";
import { CONTAINER, PANEL, PANEL_INSET, SectionHeading } from "./layout-parts";
import { GLIDE } from "./story";

/**
 * The hiring-systems section, after Twain's ring of logo coins. From lg up
 * it pins in a grey panel: the seven hiring systems WorkIt reads come in as
 * thick 3D coins, tumbling in a ring beside the heading as the page
 * scrolls; then each coin swings onto a glass pipe as one of its couplings
 * and the pipe runs into WorkIt's mark. Once it has formed, job postings
 * come out of each coupling and flow down the pipe: a senior role is
 * struck through and filtered out, an internship or new-grad role goes
 * into WorkIt and comes out as a card on the Jobs page side, sorted by
 * Best Match. Below lg, and with reduced motion, it is the flat stream
 * (hiring-systems.tsx), which stays the still version.
 *
 * Every line here is a claim (data.ts): the hiring systems are the ones
 * the scraper reads, and the steps under WorkIt's mark are pipeline steps.
 */

// Tailwind's lg breakpoint: pinned from here up.
const DESKTOP_QUERY = "(min-width: 64rem)";

/** A coin's face, in px, and its thickness, drawn as stacked discs. */
const COIN = 76;
const DEPTH = 10;
const LAYERS = 7;
/** The pipe's height in px, and how far its couplings turn to the side. */
const PIPE = 52;
const COUPLING_TURN = 66;
/** The flow: px a second, and the space between two postings. */
const SPEED = 62;
const SPACING = 168;
/** The least time between two cards, and each step's time under the mark,
 * in seconds of the flow's clock. */
const CARD_GAP = 1.4;
const STEP_S = 3.2;
/** Cards on the Jobs page side. */
const CARDS = 3;

// The pinned stretch's beats, as progress from 0 to 1.
const SPIN: [number, number] = [0, 0.42];
const MORPH: [number, number] = [0.4, 0.74];
const PIPE_IN: [number, number] = [0.56, 0.76];
const OUTLET_IN: [number, number] = [0.66, 0.8];
/** From here on the pipe has formed and the postings flow. */
const FLOWING = 0.8;

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
  const pipeLeft = w * 0.03;
  const outletX = w * 0.655;
  // The couplings sit together at the intake end, like a manifold, so the
  // rest of the pipe is clear and a posting's title can be read before
  // WorkIt filters it: spread along the whole pipe they hid most titles.
  const first = w * 0.07;
  const last = w * 0.36;
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

  // Whether the pipe has formed: the postings flow only then.
  const [formed, setFormed] = React.useState(() => q.get() >= FLOWING);
  useMotionValueEvent(q, "change", (v) => setFormed(v >= FLOWING));

  return (
    <section ref={ref} id="hiring-systems" className="h-[280vh]">
      <div className={cn(PANEL_INSET, "sticky top-0 flex h-dvh flex-col pt-20 pb-4")}>
        <div className={cn(PANEL, "bg-surface relative isolate min-h-0 flex-1 overflow-hidden")}>
          <div className="relative z-10 px-10 pt-10 xl:px-14">
            <div className="max-w-[31rem]">
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
                <Pipe q={q} layout={layout} />
                <Flow layout={layout} playing={formed} q={q} />
                {hiringSystems.map((system, i) => (
                  <Coin
                    key={system.name}
                    index={i}
                    logo={system.logo}
                    q={q}
                    entry={entry}
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

/**
 * A hiring system as a coin: its logo on a white face, an edge of stacked
 * discs and a grey back. In the ring it tumbles on its own axis and rides
 * the ring round; then it flies to its place on the pipe and turns side-on,
 * a coupling around the pipe.
 */
function Coin({
  index,
  logo,
  q,
  entry,
  layout,
}: {
  index: number;
  logo: string;
  q: MotionValue<number>;
  entry: MotionValue<number>;
  layout: React.RefObject<Layout | null>;
}) {
  const n = hiringSystems.length;
  /** Where the coin is at progress `v`, `e` of the way in. */
  const pose = (v: number, e: number) => {
    const l = layout.current;
    if (!l) return { x: 0, y: 0, rotate: 0, rotateX: 0, rotateY: 0 };
    const spin = between(v, SPIN);
    // Round the ring, the ring itself turning as the page scrolls, and
    // turning in as the section comes up.
    const angle = (index * 360) / n - 90 + 140 * spin - 70 * (1 - e);
    const rad = (angle * Math.PI) / 180;
    const ring = {
      x: l.ring.x + Math.cos(rad) * l.ring.r,
      y: l.ring.y + Math.sin(rad) * l.ring.r,
      rotate: angle + 90,
      rotateX: 14 * Math.cos(index * 2.1),
      rotateY: 50 + 28 * Math.sin(index * 1.7) + 240 * spin + 120 * (1 - e),
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
  const both = [q, entry];
  const x = useTransform(both, ([v, e]: number[]) => pose(v, e).x - COIN / 2);
  const y = useTransform(both, ([v, e]: number[]) => pose(v, e).y - COIN / 2);
  const rotate = useTransform(both, ([v, e]: number[]) => pose(v, e).rotate);
  const rotateX = useTransform(both, ([v, e]: number[]) => pose(v, e).rotateX);
  const rotateY = useTransform(both, ([v, e]: number[]) => pose(v, e).rotateY);
  const scale = useTransform(entry, (e) => lerp(0.5, 1, ease(e)));
  const opacity = useTransform(entry, (e) => clamp(e * 1.4 - 0.2));

  return (
    <motion.div
      aria-hidden="true"
      className="absolute top-0 left-0 z-20"
      style={{
        x,
        y,
        rotate,
        rotateX,
        rotateY,
        scale,
        opacity,
        width: COIN,
        height: COIN,
        transformStyle: "preserve-3d",
      }}
    >
      {Array.from({ length: LAYERS }, (_, k) => (
        <span
          key={k}
          className="absolute inset-0 rounded-full"
          style={{
            transform: `translateZ(${-DEPTH / 2 + ((k + 1) * DEPTH) / (LAYERS + 1)}px)`,
            background: k % 2 ? "#d6d4de" : "#e3e1ea",
          }}
        />
      ))}
      <span
        className="absolute inset-0 rounded-full bg-[#ebe9f1]"
        style={{ transform: `translateZ(${-DEPTH / 2}px) rotateY(180deg)` }}
      />
      <span
        className="absolute inset-0 grid place-items-center rounded-full bg-white shadow-[inset_0_0_0_3px_#f1f0f5,inset_0_0_0_4px_rgb(76_39_163/0.08)]"
        style={{ transform: `translateZ(${DEPTH / 2}px)` }}
      >
        <Image src={logo} alt="" width={64} height={64} className="size-[54%] rounded-[22%]" />
      </span>
    </motion.div>
  );
}

/** The glass pipe, WorkIt's mark at its outlet, and the labels at each
 * end. They come in once the coins are on their way. */
function Pipe({ q, layout }: { q: MotionValue<number>; layout: Layout }) {
  const grow = useTransform(q, (v) => ease(between(v, PIPE_IN)));
  const outlet = useTransform(q, (v) => ease(between(v, OUTLET_IN)));
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
      {/* The open end, seen a little from the side. */}
      <motion.div
        className="absolute z-[16] rounded-[50%] bg-[#cfc8e6] shadow-[inset_2px_0_4px_rgb(40_20_90/0.25)]"
        style={{
          left: layout.pipeLeft - 7,
          top,
          width: 14,
          height: PIPE,
          opacity: grow,
        }}
      />

      <motion.div
        className="absolute flex items-center gap-1.5 text-xs font-semibold"
        style={{ left: layout.pipeLeft, top: top - 30, opacity: outlet, y: labelY }}
      >
        <span className="text-ink">{copy.intake}</span>
        <span className="text-landing-brand-700 flex items-center gap-1">
          <RefreshCw className="size-3.5" aria-hidden="true" />
          {copy.cadence}
        </span>
      </motion.div>

      {/* WorkIt at the outlet, in glass over a violet glow. */}
      <motion.div
        className="absolute"
        style={{
          left: layout.outletX - 140,
          top: layout.pipeY - 140,
          width: 280,
          height: 280,
          opacity: outlet,
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--color-brand) 26%, transparent), transparent)",
        }}
      />
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
  q,
}: {
  layout: Layout;
  playing: boolean;
  q: MotionValue<number>;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { amount: 0.2 });
  const hidden = usePageHidden();
  const clock = useMotionValue(0);
  const running = playing && inView && !hidden;
  React.useEffect(() => {
    if (!running) return;
    const tick = ({ delta }: FrameData) => clock.set(clock.get() + Math.min(delta, 50) / 1000);
    frame.update(tick, true);
    return () => cancelFrame(tick);
  }, [running, clock]);

  const outlet = useTransform(q, (v) => ease(between(v, OUTLET_IN)));
  const shown = useTransform(q, (v) => (v >= FLOWING - 0.02 ? 1 : 0));
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

      {/* WorkIt's mark, and under it the step it is on. */}
      <motion.div
        className="absolute z-20"
        style={{
          left: layout.outletX - 38,
          top: layout.pipeY - 38,
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
              className="text-ink-meta text-[11px] leading-4 font-medium text-balance"
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
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <p className="text-ink text-sm font-semibold">{copy.output}</p>
          <span className="text-ink-meta flex items-center gap-1.5 text-xs font-medium">
            <ArrowDownWideNarrow className="size-3.5" aria-hidden="true" />
            {copy.sort}
          </span>
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
  const travel = (t: number) => SPEED * t + place * SPACING;
  const lapAt = (t: number) => Math.floor(travel(t) / loop);
  const systemOn = (lap: number) => (((lap * places + place) % n) + n) % n;
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
    const end = layout.outletX - 30;
    // Out of the coupling: it grows out of the ring around the pipe.
    const born = clamp((x - from) / 36);
    const strike = kept ? 0 : clamp((x - (end - 150)) / 50);
    const gone = kept ? clamp((x - (end - 30)) / 30) : clamp((x - (end - 90)) / 40);
    return {
      lap,
      x: Math.min(x, end),
      scale: (0.7 + 0.3 * born) * (1 - 0.5 * gone),
      opacity: x < from ? 0 : born * (1 - gone),
      strike,
      y: kept ? 0 : gone * 10,
    };
  };

  const p = useTransform(clock, pose);
  const x = useTransform(p, (v) => v.x);
  const y = useTransform(p, (v) => layout.pipeY - 14 + v.y);
  const scale = useTransform(p, (v) => v.scale);
  const opacity = useTransform(p, (v) => v.opacity);
  const strike = useTransform(p, (v) => `${v.strike * 100}% 1.5px`);
  const dim = useTransform(p, (v) => 1 - 0.45 * v.strike);

  // Each lap ends at WorkIt: a kept posting goes on to be a card. The lap
  // is kept in a ref as well as state, as in the flat stream: a listener
  // that saw the old lap in state set it again in the same render.
  const [lap, setLap] = React.useState(() => lapAt(clock.get()));
  const seenLap = React.useRef(lap);
  useMotionValueEvent(p, "change", (next) => {
    if (next.lap === seenLap.current) return;
    const done = postingOn(seenLap.current);
    seenLap.current = next.lap;
    if (done.card) onEnter(done);
    setLap(next.lap);
  });
  const posting = postingOn(lap);

  return (
    <motion.div className="absolute top-0 left-0 origin-left" style={{ x, y, scale, opacity }}>
      <div className="text-ink flex h-7 max-w-[150px] items-center gap-1.5 rounded-full bg-white py-1 pr-2.5 pl-1 text-[11px] font-medium whitespace-nowrap shadow-[0_4px_10px_-6px_rgba(40,20,90,0.45)] ring-1 ring-slate-900/[0.07]">
        <FaviconLogo domain={posting.domain} eager className="size-5 rounded-full" />
        <motion.span className="min-w-0 truncate" style={{ opacity: dim }}>
          <motion.span
            className="bg-[linear-gradient(var(--color-danger),var(--color-danger))] bg-[position:0_55%] bg-no-repeat"
            style={{ backgroundSize: strike }}
          >
            {posting.title}
          </motion.span>
        </motion.span>
      </div>
    </motion.div>
  );
}
