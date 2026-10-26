"use client";

import * as React from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "motion/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { CheckIcon, RobotIcon, ShieldWarningIcon, XIcon } from "@phosphor-icons/react/ssr";
import { ScanMagnifyingGlassIcon } from "@/components/custom-icons";

import { Logo } from "@/components/logo";
import { cn } from "@/lib/cn";

import { FaviconLogo } from "./favicon-logo";
import { followedJob } from "./feature-data";
import { Fit } from "./fit";
import { useMediaQuery, usePageHidden } from "./hooks";
import { CONTAINER, PANEL, PANEL_INSET } from "./layout-parts";
import { SlopWord } from "./slop-word";
import { CARD_WIDTH, FollowedCard } from "./thread";

/**
 * The statement between the hiring-systems section and the applications
 * section: "Slop applications get skipped." From lg up it tells a story,
 * one thing at a time, that plays on its own like a carousel and loops
 * (`useStoryLoop`): once the section is on screen, the beats follow one
 * another in time, the finale holds, and the story fades and starts again.
 * The scroll plays no part: it is not pinned, and nothing it does moves
 * the story. Cued beat by beat by the scroll, it stopped whenever the
 * reader did; pinned, with a bar per beat and the scroll taking it to its
 * finale near the pin's end, it still read as driven by the scroll, and
 * the team had it loop on its own. On the right, one
 * screening panel for one posting (`followedJob`, Stripe): three things a
 * student sends blind come in one after another (a generic resume to the
 * ATS filter, a copy-paste application to spam detection, a template cover
 * letter to slop detection). Each is scanned, the panel marks the lines
 * that sink it and gives its verdict, then the page crumples into a ball
 * and is thrown into a wastebasket, where the balls pile up at the rim.
 * Then WorkIt's application for the same posting comes in, as the
 * followed card, and the panel finds it ready to submit. On the left, only
 * the current beat's caption shows, read word by word. Below lg and with
 * reduced motion it shows the finished frame, still.
 *
 * The captions and notes are product copy. The gates' are hedged ("often",
 * "look like"): they describe the market, not WorkIt. The finale's claims
 * follow the landing rules: auto apply fills the form, the student clicks
 * Submit, and nothing promises to pass an ATS.
 */

type Beat = {
  gate: string;
  /** The gate's icon in the screening panel's header. */
  icon: PhosphorIcon;
  /** Its moving mark in the caption's chip (`GateIcon`). */
  mark: "scan" | "shield" | "bot";
  verdict: string;
  text: string;
  /** What the check marks on the page: each note's line, in px down it. */
  notes: { y: number; text: string }[];
  page: React.ComponentType;
};

const BEATS: Beat[] = [
  {
    gate: "ATS filter",
    icon: ScanMagnifyingGlassIcon,
    mark: "scan",
    verdict: "Filtered out",
    text: "One resume sent to every posting often gets filtered out before a person reads it.",
    notes: [
      { y: 62, text: "Generic objective" },
      { y: 176, text: "No posting keywords" },
    ],
    page: ResumePage,
  },
  {
    gate: "Spam detection",
    icon: ShieldWarningIcon,
    mark: "shield",
    verdict: "Flagged as spam",
    text: "Two hundred copy-paste applications look like spam, and get treated like it.",
    notes: [
      { y: 24, text: "Application #187 today" },
      { y: 104, text: "Pasted 186 times" },
    ],
    page: ApplicationPage,
  },
  {
    gate: "Slop detection",
    icon: RobotIcon,
    mark: "bot",
    verdict: "Flagged as slop",
    text: "A template cover letter reads like AI slop, so it gets skipped.",
    notes: [
      { y: 62, text: "Placeholders left in" },
      { y: 120, text: "Template phrasing" },
    ],
    page: LetterPage,
  },
];

const CLOSE =
  "WorkIt makes each one count: a resume tailored to the posting, a job that fits you, every field filled in. You click Submit.";
const CHECKS = ["Tailored to this posting", "Fits your skills", "Every field filled in"];

// --- The story's beats, on its timeline from 0 to 1, which plays on its
// own (`useStoryLoop`). Every range stays inside 0 to 1 (the still
// version's frame is 1). ---

const BEAT_AT: [number, number][] = [
  [0.04, 0.27],
  [0.27, 0.5],
  [0.5, 0.73],
];
const FINAL_AT: [number, number] = [0.75, 0.95];
/** The story's pace on its timeline (about four seconds a beat), how long
 * the finale holds before it starts again, and the fade of each restart,
 * in seconds. At three seconds a beat the page, its marks and its verdict
 * were on screen together for a quarter of a second. */
const RATE = 0.06;
const HOLD = 3.2;
const RESET = 0.35;
/** Each beat's stretch for its labels (caption, panel title): the first
 * from the story's start, each until the next beat begins. */
const CAPTION_AT: [number, number][] = [
  [0, BEAT_AT[1][0]],
  [BEAT_AT[1][0], BEAT_AT[2][0]],
  [BEAT_AT[2][0], FINAL_AT[0]],
  [FINAL_AT[0], 1],
];
/** How long a label's fade in or out takes, on the timeline. */
const FADE = 0.012;

/**
 * A label's fade across its stretch `[a, b]`: out just after `b`, and in
 * just after the label before it has gone, so the two never overlap. Both
 * come after the boundary, never before it: when the beats rested on their
 * boundaries (cued by the scroll), a swap before it left the resting beat
 * with no caption, title or verdict at all; the finale still rests on 1.
 */
function fadeWindow(a: number, b: number) {
  const fadeIn = [a + FADE, a + 2 * FADE];
  const fadeOut = [b, b + FADE];
  if (a <= 0) return { input: fadeOut, output: [1, 0], first: true, last: false };
  if (b >= 1) return { input: fadeIn, output: [0, 1], first: false, last: true };
  return { input: [...fadeIn, ...fadeOut], output: [0, 1, 1, 0], first: false, last: false };
}
/** The share of a beat its caption takes to read, from the beat's start. */
const READ = 0.4;

// Within a beat (0 to 1): the page comes in, is scanned, gets its verdict,
// holds it with its marks and notes (about a second and a quarter, the
// evidence the caption speaks of), crumples and is thrown.
const IN: [number, number] = [0, 0.1];
const SCAN: [number, number] = [0.12, 0.36];
const VERDICT = 0.38;
const CRUMPLE: [number, number] = [0.7, 0.77];
const THROW: [number, number] = [0.77, 0.92];
const LAND: [number, number] = [0.92, 1];

const clamp = (v: number) => Math.min(1, Math.max(0, v));
/** How far `v` is through the range `[a, b]`, from 0 to 1. */
const through = (v: number, [a, b]: [number, number]) => clamp((v - a) / (b - a));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const out = (t: number) => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Progress `t` of the way through `beat`, from 0 to 1. */
const at = (beat: [number, number], t: number) => beat[0] + (beat[1] - beat[0]) * t;

// --- The scene, drawn at 560 x 520 and scaled to its column by Fit ---

const STAGE_W = 560;
const STAGE_H = 520;
/** The screening panel, its header, and the page it is reading. */
const SCREEN = { x: 0, y: 24, w: 404, h: 396 };
const HEADER_H = 58;
const DOC = { x: 28, y: SCREEN.y + HEADER_H + 18, w: 176, h: 228 };
/** The notes' column, right of the page, and the leader to each note. */
const NOTES_X = DOC.x + DOC.w + 26;
/** The wastebasket: its rim's centre and width, its foot's width, height. */
const BIN = { cx: 482, rim: 328, top: 144, foot: 110, h: 164 };
/** A paper ball's radius, and where each settles at the rim. */
const BALL_R = 21;
const PILE = [
  { x: BIN.cx - 30, y: BIN.rim + 8, spin: 300 },
  { x: BIN.cx + 26, y: BIN.rim + 4, spin: -340 },
  { x: BIN.cx - 2, y: BIN.rim - 8, spin: 400 },
];

// Tailwind's lg breakpoint: pinned from here up.
const DESKTOP_QUERY = "(min-width: 64rem)";

export function Statement() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const reduceMotion = useReducedMotion();
  if (isDesktop === true && !reduceMotion) return <LoopingStatement />;
  if (isDesktop === false && !reduceMotion) return <CompactStatement />;
  return <StillStatement />;
}

/**
 * Below lg: the same loop, in one column. The beat's caption over the
 * screening panel alone, drawn at about 0.85 on a phone: the whole scene,
 * bin and all, drew at 0.58 with 7px labels, which is why phones showed it
 * still until KAN-368. A rejected page crumples and flies off the panel's
 * edge, towards where the bin stands on a wider screen.
 */
function CompactStatement() {
  const stageRef = React.useRef<HTMLDivElement>(null);
  const inView = useInView(stageRef, { amount: 0.4 });
  const hidden = usePageHidden();
  const playing = inView && !hidden;
  const { p, fade } = useStoryLoop(playing);
  return (
    <section
      aria-labelledby="statement-title"
      data-paused={playing ? undefined : ""}
      className={cn(PANEL_INSET, "mt-16 sm:mt-24")}
    >
      <Panel>
        <div ref={stageRef} className={cn(CONTAINER, "py-14")}>
          <Headline />
          <motion.div className="mt-6" style={{ opacity: fade }}>
            <Story p={p} compact />
          </motion.div>
          <motion.div className="mt-2" style={{ opacity: fade }}>
            <Fit>
              <Scene p={p} compact />
            </Fit>
          </motion.div>
        </div>
      </Panel>
    </section>
  );
}

/** From lg up: a screen-high panel, not pinned, whose story loops while it
 * is on screen in a visible tab and rests where it is otherwise. */
function LoopingStatement() {
  const sceneBox = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const inView = useInView(stageRef, { amount: 0.5 });
  const hidden = usePageHidden();
  const playing = inView && !hidden;
  const { p, fade } = useStoryLoop(playing);
  return (
    <section
      aria-labelledby="statement-title"
      // The chips' marks move only while the story plays (landing.css).
      data-paused={playing ? undefined : ""}
      className={cn(PANEL_INSET, "mt-16 sm:mt-24")}
    >
      <div ref={stageRef} className="flex h-[clamp(38rem,calc(100dvh-7.5rem),52rem)] flex-col">
        <Panel>
          {/* The headline on one line across the top, then the story in two
              columns: one caption at a time on the left, the scene on the
              right. */}
          <div className={cn(CONTAINER, "flex h-full flex-col py-10 xl:py-12")}>
            <Headline />
            {/* pt-14: room for the drips off "Slop" above the first
                caption's chip. */}
            <div className="grid min-h-0 flex-1 grid-cols-[1fr_1.1fr] items-center gap-12 pt-14">
              <motion.div style={{ opacity: fade }}>
                <Story p={p} />
              </motion.div>
              <motion.div
                ref={sceneBox}
                className="flex h-full max-h-[600px] min-h-0 items-center"
                style={{ opacity: fade }}
              >
                <Fit box={sceneBox}>
                  <Scene p={p} />
                </Fit>
              </motion.div>
            </div>
          </div>
        </Panel>
      </div>
    </section>
  );
}

/**
 * The story's timeline, playing on its own: from where it is to the end at
 * `RATE`, a hold on the finale, then a fade out, back to the start and a
 * fade in, round and round while `playing`. Paused, it keeps its place.
 * `fade` is the restart's opacity, for both columns, so the reset never
 * jumps in view.
 */
function useStoryLoop(playing: boolean) {
  const p = useMotionValue(0);
  const fade = useMotionValue(1);
  React.useEffect(() => {
    if (!playing) return;
    let cancelled = false;
    const running: { current: { stop: () => void } | null } = { current: null };
    let timer = 0;
    const run = (value: MotionValue<number>, to: number, duration: number) =>
      new Promise<void>((resolve) => {
        running.current = animate(value, to, {
          duration,
          ease: "linear",
          onComplete: () => resolve(),
        });
      });
    const wait = (seconds: number) =>
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, seconds * 1000);
      });
    (async () => {
      // Back in from a pause in the middle of a restart.
      if (fade.get() < 1) await run(fade, 1, RESET);
      if (cancelled) return;
      while (!cancelled) {
        await run(p, 1, (1 - p.get()) / RATE);
        if (cancelled) return;
        await wait(HOLD);
        if (cancelled) return;
        await run(fade, 0, RESET);
        if (cancelled) return;
        p.set(0);
        await run(fade, 1, RESET);
      }
    })();
    return () => {
      cancelled = true;
      running.current?.stop();
      window.clearTimeout(timer);
    };
  }, [playing, p, fade]);
  return { p, fade };
}

/** The finished frame, below lg and with reduced motion: every caption in a
 * short list, then the scene at its end. On a phone only the finale's card
 * and checks, at their own size: the whole scene scaled into the column
 * was a 58% miniature, its labels 7px. */
function StillStatement() {
  const done = useMotionValue(1);
  return (
    <section aria-labelledby="statement-title" className={cn(PANEL_INSET, "mt-16 sm:mt-24")}>
      <Panel>
        <div className={cn(CONTAINER, "py-16")}>
          <Headline />
          <ol className="mt-8 space-y-4">
            {BEATS.map((beat) => (
              <li key={beat.gate}>
                <GateChip beat={beat} />
                <p className="text-ink-muted mt-1.5 text-lg leading-snug">{beat.text}</p>
              </li>
            ))}
            <li>
              <WorkItChip />
              <p className="text-ink mt-1.5 text-lg leading-snug font-semibold">{CLOSE}</p>
            </li>
          </ol>
          <div aria-hidden="true" className="mt-10 sm:hidden">
            <FollowedCard stage="saved" className="mx-auto max-w-full" />
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {CHECKS.map((check) => (
                <CheckChip key={check} p={done} at={0}>
                  {check}
                </CheckChip>
              ))}
            </div>
          </div>
          <div className="mt-10 hidden sm:block">
            <Fit>
              <Scene p={done} />
            </Fit>
          </div>
        </div>
      </Panel>
    </section>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(PANEL, "relative flex-1 overflow-hidden")}
      style={{
        background:
          "radial-gradient(60% 70% at 8% 0%, color-mix(in oklab, var(--color-brand) 9%, transparent), transparent), linear-gradient(180deg, #f7f6fc, #efeff6)",
      }}
    >
      {children}
    </div>
  );
}

/** "Slop" is drawn as AI slop, dripping (`SlopWord`, KAN-368); a red
 * spell-checker wave under it came first. It was "Stop sending slop
 * applications.", a second "Stop" after the hero's; it now says what the
 * three beats show. */
function Headline() {
  return (
    <h2
      id="statement-title"
      className="text-ink text-[2.5rem] leading-[1.08] font-semibold tracking-[-0.035em] text-balance sm:text-6xl lg:text-[clamp(2.75rem,4.2vw,4rem)]"
    >
      <SlopWord /> applications get skipped.
    </h2>
  );
}

/**
 * A caption's gate, as a chip the size of a label one reads: its mark on a
 * white disc, then its name. From lg up the mark moves (`moving`); the team
 * found the small chips with still icons hard to notice.
 */
function GateChip({ beat, moving = false }: { beat: Beat; moving?: boolean }) {
  return (
    <span className="bg-danger-tint text-danger inline-flex h-10 items-center gap-2 rounded-full pr-4 pl-1.5 text-[15px] font-semibold">
      <span className="grid size-7 place-items-center rounded-full bg-white">
        <GateIcon mark={beat.mark} moving={moving} />
      </span>
      {beat.gate}
    </span>
  );
}

/**
 * A gate's mark, drawn here (after Lucide's icons) so its parts can move:
 * a scan line runs down the page, the shield shakes and its "!" blinks,
 * the bot blinks and its antenna light pulses (`.gate-*` in landing.css).
 * They rest while the section is off screen and with reduced motion.
 */
function GateIcon({ mark, moving }: { mark: Beat["mark"]; moving: boolean }) {
  const svg = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    className: cn("size-[18px] overflow-visible", moving && `gate-${mark}`),
  } as const;
  if (mark === "scan") {
    return (
      <svg {...svg}>
        <rect x="5" y="2.5" width="14" height="19" rx="2" />
        <path d="M8.5 8h7M8.5 12h7M8.5 16h4.5" strokeOpacity="0.5" />
        <path className="gate-scan-line" d="M3 5.5h18" />
      </svg>
    );
  }
  if (mark === "shield") {
    return (
      <svg {...svg}>
        <g className="gate-shield-body">
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
          <path className="gate-shield-mark" d="M12 8v4M12 16h.01" />
        </g>
      </svg>
    );
  }
  return (
    <svg {...svg}>
      <path className="gate-bot-antenna" d="M12 8V4H8" />
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M2 14h2M20 14h2" />
      <path className="gate-bot-eyes" d="M9 13v2M15 13v2" />
    </svg>
  );
}

/**
 * The finale's chip: "With" and WorkIt's own logo, the mark and the word,
 * where it had a check and "With WorkIt" in text. From lg up the figure's
 * head hops now and then, a small cheer (`moving`).
 */
function WorkItChip({ moving = false }: { moving?: boolean }) {
  return (
    <span
      className={cn(
        "text-brand-ink ring-landing-brand-200 inline-flex h-10 items-center gap-2.5 rounded-full bg-white pr-4 pl-4 text-[15px] font-semibold shadow-sm ring-1",
        moving && "workit-hop",
      )}
    >
      With
      <Logo size="bar" className="h-[22px]" />
    </span>
  );
}

// --- The story column: one caption at a time ---

/**
 * The current beat's caption alone: the last one lifts away as the next
 * comes in, and its words come into focus as they are read. A bar per beat
 * above it, filling as the story played, was taken out: it read as the
 * scroll's progress, and sat close over the gate's chip.
 */
function Story({ p, compact = false }: { p: MotionValue<number>; compact?: boolean }) {
  return (
    <div>
      {/* One slot, the captions stacked in it; tall enough for the
          longest at its widest wrap (a size down in one column). */}
      <div className={cn("relative", compact ? "h-[11.5rem]" : "h-[15rem]")}>
        {BEATS.map((beat, i) => (
          <Caption
            key={beat.gate}
            p={p}
            index={i}
            beat={BEAT_AT[i]}
            chip={<GateChip beat={beat} moving />}
            text={beat.text}
            compact={compact}
          />
        ))}
        <Caption
          p={p}
          index={BEATS.length}
          beat={FINAL_AT}
          chip={<WorkItChip moving />}
          text={CLOSE}
          strong
          compact={compact}
        />
      </div>
    </div>
  );
}

function Caption({
  p,
  index,
  beat,
  chip,
  text,
  strong = false,
  compact = false,
}: {
  p: MotionValue<number>;
  index: number;
  beat: [number, number];
  chip: React.ReactNode;
  text: string;
  strong?: boolean;
  compact?: boolean;
}) {
  const [start, end] = CAPTION_AT[index];
  // In just after its beat begins (the first is there from the start),
  // out just after the next begins (the last stays).
  const { input, output, first, last } = fadeWindow(start, end);
  const opacity = useTransform(p, input, output);
  const transform = useTransform(
    p,
    input,
    first
      ? ["translateY(0px)", "translateY(-14px)"]
      : last
        ? ["translateY(14px)", "translateY(0px)"]
        : ["translateY(14px)", "translateY(0px)", "translateY(0px)", "translateY(-14px)"],
  );
  const words = text.split(" ");
  const readFrom = Math.max(start, beat[0]) + 0.005;
  const step = ((beat[1] - beat[0]) * READ) / words.length;

  return (
    <motion.div className="absolute inset-x-0 top-0 max-w-[34rem]" style={{ opacity, transform }}>
      {chip}
      <p
        className={cn(
          "text-ink mt-4 leading-[1.3] tracking-[-0.015em] text-pretty",
          compact ? "text-xl" : "text-2xl xl:text-[1.75rem]",
          strong ? "font-semibold" : "font-medium",
        )}
      >
        {words.map((word, i) => (
          <Word key={i} p={p} start={readFrom + step * i} span={step * 2.5}>
            {word}
          </Word>
        ))}
      </p>
    </motion.div>
  );
}

function Word({
  p,
  start,
  span,
  children,
}: {
  p: MotionValue<number>;
  start: number;
  span: number;
  children: string;
}) {
  const opacity = useTransform(p, [start, start + span], [0.16, 1]);
  return (
    <>
      <motion.span style={{ opacity }}>{children}</motion.span>{" "}
    </>
  );
}

// --- The scene ---

function Scene({ p, compact = false }: { p: MotionValue<number>; compact?: boolean }) {
  return (
    // shrink-0: everything in it is absolute, so as Fit's flex child it would
    // shrink to the column, and Fit, reading that width, would never scale it.
    // Compact, it is the screening panel alone, clipped at its edge, with no
    // bin: a thrown page leaves the panel.
    <div
      aria-hidden="true"
      className={cn("relative shrink-0", compact && "overflow-hidden")}
      style={
        compact
          ? { width: SCREEN.w, height: SCREEN.y + SCREEN.h }
          : { width: STAGE_W, height: STAGE_H }
      }
    >
      <Screen p={p} />
      {BEATS.map((beat, i) => (
        <Notes key={beat.gate} p={p} beat={beat} range={BEAT_AT[i]} />
      ))}
      {BEATS.map((beat, i) => (
        <Page key={beat.gate} p={p} index={i}>
          <beat.page />
        </Page>
      ))}
      <Finale p={p} />
      {!compact && <Bin p={p} />}
    </div>
  );
}

/**
 * The screening panel: which check is reading, for which posting, and its
 * status, "Checking" until the verdict. Each beat's title and status are
 * stacked and shown in turn.
 */
function Screen({ p }: { p: MotionValue<number> }) {
  return (
    <div
      className="gloss-card absolute rounded-2xl"
      style={{ left: SCREEN.x, top: SCREEN.y, width: SCREEN.w, height: SCREEN.h }}
    >
      <div className="relative flex items-center gap-3 px-4" style={{ height: HEADER_H }}>
        <div className="relative h-9 min-w-0 flex-1">
          {BEATS.map((beat, i) => (
            <Shown key={beat.gate} p={p} range={showRange(i)} className="absolute inset-0">
              <ScreenTitle icon={beat.icon} title={beat.gate} tone="danger" />
            </Shown>
          ))}
          <Shown p={p} range={showRange(BEATS.length)} className="absolute inset-0">
            {/* WorkIt's own logo, as in the caption's chip. */}
            <ScreenTitle
              icon={CheckIcon}
              title={
                <span className="inline-flex items-center gap-1.5">
                  With <Logo size="bar" className="h-[15px]" />
                </span>
              }
              tone="brand"
            />
          </Shown>
        </div>
        <div className="relative h-7 w-[8.5rem] shrink-0">
          {BEATS.map((beat, i) => {
            const [a, b] = showRange(i);
            const verdict = at(BEAT_AT[i], VERDICT);
            return (
              <React.Fragment key={beat.gate}>
                <Shown p={p} range={[a, verdict]} className="absolute inset-0 flex justify-end">
                  <Status tone="neutral">Checking</Status>
                </Shown>
                <Shown p={p} range={[verdict, b]} className="absolute inset-0 flex justify-end">
                  <Status tone="danger">{beat.verdict}</Status>
                </Shown>
              </React.Fragment>
            );
          })}
          <Shown
            p={p}
            range={[FINAL_AT[0], at(FINAL_AT, 0.4)]}
            className="absolute inset-0 flex justify-end"
          >
            <Status tone="neutral">Checking</Status>
          </Shown>
          <Shown p={p} range={[at(FINAL_AT, 0.4), 1]} className="absolute inset-0 flex justify-end">
            <Status tone="positive">Ready to submit</Status>
          </Shown>
        </div>
      </div>
      <div
        className="absolute rounded-xl bg-slate-50 ring-1 ring-slate-900/[0.04] ring-inset"
        style={{ left: 12, right: 12, top: HEADER_H, bottom: 12 }}
      />
    </div>
  );
}

/** Beat `i`'s stretch on the panel: from its start to the next beat's. */
function showRange(i: number): [number, number] {
  const starts = [...BEAT_AT.map((b) => b[0]), FINAL_AT[0]];
  return [i === 0 ? 0 : starts[i], i === starts.length - 1 ? 1 : starts[i + 1]];
}

/** Shown across `range`, with a quick fade after each end that is not the
 * timeline's own (`fadeWindow`). */
function Shown({
  p,
  range: [a, b],
  className,
  children,
}: {
  p: MotionValue<number>;
  range: [number, number];
  className?: string;
  children: React.ReactNode;
}) {
  const { input, output } = fadeWindow(a, b);
  const opacity = useTransform(p, input, output);
  return (
    <motion.div className={className} style={{ opacity }}>
      {children}
    </motion.div>
  );
}

function ScreenTitle({
  icon: Icon,
  title,
  tone,
}: {
  icon: PhosphorIcon;
  title: React.ReactNode;
  tone: "danger" | "brand";
}) {
  return (
    <div className="flex h-full items-center gap-2.5">
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-xl",
          tone === "danger" ? "bg-slate-100 text-slate-600" : "bg-brand-tint text-brand-ink",
        )}
      >
        <Icon aria-hidden className="size-[18px]" weight={tone === "brand" ? "bold" : "regular"} />
      </span>
      <span className="min-w-0">
        <span className="text-ink block text-[13px] leading-tight font-semibold">{title}</span>
        <span className="text-ink-meta flex items-center gap-1 text-[11px] leading-tight whitespace-nowrap">
          <FaviconLogo domain={followedJob.domain} eager className="size-3.5 rounded-[4px]" />
          <span className="truncate">{followedJob.title}</span>
        </span>
      </span>
    </div>
  );
}

function Status({ tone, children }: { tone: "neutral" | "danger" | "positive"; children: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold whitespace-nowrap",
        tone === "neutral" && "bg-slate-100 text-slate-600",
        tone === "danger" && "bg-danger-tint text-danger",
        tone === "positive" && "bg-positive-tint text-positive-ink",
      )}
    >
      {tone === "neutral" && (
        <span className="flex gap-0.5">
          {[0, 1, 2].map((k) => (
            <span key={k} className="size-1 rounded-full bg-current opacity-60" />
          ))}
        </span>
      )}
      {tone === "danger" && <XIcon aria-hidden className="size-3.5" weight="bold" />}
      {tone === "positive" && <CheckIcon aria-hidden className="size-3.5" weight="bold" />}
      {children}
    </span>
  );
}

/**
 * One page's way through its beat: in from the left onto the panel, still
 * while it is scanned, then crumpled where it lies (it shrinks and turns
 * as its ball grows in its place, `ballAt`).
 */
function pageAt(index: number, v: number) {
  const t = through(v, BEAT_AT[index]);
  const enter = out(through(t, IN));
  const crumple = ease(through(t, CRUMPLE));
  return {
    x: DOC.x - 36 * (1 - enter),
    opacity: t <= 0 ? 0 : enter * (1 - clamp((through(t, CRUMPLE) - 0.35) / 0.45)),
    scale: lerp(1, 0.18, crumple),
    rotate: lerp(0, index % 2 ? 22 : -22, crumple),
    scan: through(t, SCAN),
    marked: through(t, SCAN),
  };
}

function Page({
  p,
  index,
  children,
}: {
  p: MotionValue<number>;
  index: number;
  children: React.ReactNode;
}) {
  // One pose per frame, each part read from it.
  const pose = useTransform(p, (v) => pageAt(index, v));
  const x = useTransform(pose, (s) => s.x);
  const opacity = useTransform(pose, (s) => s.opacity);
  const scale = useTransform(pose, (s) => s.scale);
  const rotate = useTransform(pose, (s) => s.rotate);
  // The scan: a thin line down the page, moved by a transform.
  const scanY = useTransform(pose, (s) => s.scan * DOC.h);
  const scanOpacity = useTransform(pose, (s) => (s.scan > 0 && s.scan < 1 ? 1 : 0));
  const marks = BEATS[index].notes;

  return (
    // On its own layer (will-change), so its moves are composited.
    <motion.div
      className="absolute top-0 left-0 overflow-hidden rounded-[6px] bg-white shadow-[0_10px_24px_-14px_rgb(16_48_94/0.45)] ring-1 ring-slate-900/[0.08] will-change-transform"
      style={{ width: DOC.w, height: DOC.h, x, y: DOC.y, opacity, scale, rotate }}
    >
      {children}
      {/* The lines the check marks: a red wash over each, as the scan
          passes it. */}
      {marks.map((mark) => (
        <Mark key={mark.y} pose={pose} y={mark.y} />
      ))}
      <motion.span
        className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--color-brand)_20%,var(--color-brand)_80%,transparent)]"
        style={{ y: scanY, opacity: scanOpacity }}
      />
      <motion.span
        className="from-brand/10 absolute inset-x-0 top-0 h-10 -translate-y-full bg-gradient-to-t to-transparent"
        style={{ y: scanY, opacity: scanOpacity }}
      />
    </motion.div>
  );
}

/** A marked line on a page: shown once the scan has passed it. */
function Mark({ pose, y }: { pose: MotionValue<ReturnType<typeof pageAt>>; y: number }) {
  const opacity = useTransform(pose, (s) => clamp((s.marked * DOC.h - y) / 18));
  return (
    <motion.span
      className="bg-danger/10 border-danger/50 absolute inset-x-2.5 rounded-[3px] border-l-2"
      style={{ top: y - 12, height: 24, opacity }}
    />
  );
}

/** The check's notes beside the page, each with a leader to its line,
 * written as the scan passes it and gone as the page crumples. */
function Notes({
  p,
  beat,
  range,
}: {
  p: MotionValue<number>;
  beat: Beat;
  range: [number, number];
}) {
  return (
    <>
      {beat.notes.map((note) => (
        <Note key={note.y} p={p} range={range} y={note.y}>
          {note.text}
        </Note>
      ))}
    </>
  );
}

function Note({
  p,
  range,
  y,
  children,
}: {
  p: MotionValue<number>;
  range: [number, number];
  y: number;
  children: string;
}) {
  // When the scan reaches the note's line, and when the page crumples.
  const shownAt = at(range, at(SCAN, y / DOC.h));
  const goneAt = at(range, CRUMPLE[0]);
  const opacity = useTransform(p, [shownAt, shownAt + 0.012, goneAt, goneAt + 0.015], [0, 1, 1, 0]);
  const transform = useTransform(
    p,
    [shownAt, shownAt + 0.012],
    ["translateX(-6px)", "translateX(0px)"],
  );
  return (
    <motion.div
      className="absolute flex items-center"
      style={{ left: NOTES_X, top: DOC.y + y - 13, height: 26, opacity, transform }}
    >
      {/* The leader, back to the page's edge. */}
      <span
        className="bg-danger/35 absolute top-1/2 h-px"
        style={{ right: "100%", width: NOTES_X - DOC.x - DOC.w }}
      />
      <span className="bg-danger/35 absolute top-1/2 right-full -mt-[2px] mr-[22px] size-[5px] rounded-full" />
      <span className="border-danger/20 text-danger inline-flex h-[26px] items-center gap-1 rounded-lg border bg-white px-2 text-[11px] font-semibold whitespace-nowrap shadow-[0_4px_12px_-8px_rgb(16_48_94/0.4)]">
        <XIcon aria-hidden className="size-3" weight="bold" />
        {children}
      </span>
    </motion.div>
  );
}

const Line = ({ w, className }: { w: string; className?: string }) => (
  <span className={cn("block h-[4px] rounded-full bg-slate-200", className)} style={{ width: w }} />
);

// The three pages, laid out on fixed lines so the notes' `y` meet them.

function ResumePage() {
  return (
    <div className="absolute inset-0 px-3.5 pt-3 font-serif text-slate-700">
      <p className="text-center text-[13px] font-bold">[Your Name]</p>
      <Line w="64%" className="mx-auto mt-1.5" />
      <p className="absolute inset-x-3.5 top-[50px] text-[9px] leading-[12px]">
        Objective: To obtain a position at a company where I can grow.
      </p>
      <div className="absolute inset-x-3.5 top-[86px] space-y-1.5">
        <Line w="36%" className="bg-slate-400" />
        <Line w="92%" />
        <Line w="84%" />
        <Line w="88%" />
        <Line w="30%" className="mt-3 bg-slate-400" />
        <Line w="90%" />
        <Line w="76%" />
      </div>
      <p className="absolute inset-x-3.5 top-[164px] text-[9px] leading-[12px]">
        Skills: Microsoft Office, teamwork, hard worker.
      </p>
      <div className="absolute inset-x-3.5 top-[200px] space-y-1.5">
        <Line w="80%" />
        <Line w="60%" />
      </div>
    </div>
  );
}

function ApplicationPage() {
  return (
    <div className="absolute inset-0 px-3.5 pt-3">
      <p className="text-ink text-[12px] font-bold">Application #187</p>
      <p className="text-ink-meta absolute inset-x-3.5 top-[38px] text-[9px]">Why this company?</p>
      <p className="absolute inset-x-3.5 top-[52px] rounded-[3px] px-1.5 py-1 text-[9px] whitespace-nowrap text-slate-600 ring-1 ring-slate-200">
        Excited to join your company.
      </p>
      <p className="text-ink-meta absolute inset-x-3.5 top-[78px] text-[9px]">Why this role?</p>
      <p className="absolute inset-x-3.5 top-[92px] rounded-[3px] px-1.5 py-1 text-[9px] whitespace-nowrap text-slate-600 ring-1 ring-slate-200">
        I am a hard-working fast learner.
      </p>
      <p className="text-ink-meta absolute inset-x-3.5 top-[124px] text-[9px]">Anything else?</p>
      <p className="absolute inset-x-3.5 top-[138px] h-[34px] rounded-[3px] ring-1 ring-slate-200" />
      <p className="bg-ink absolute inset-x-3.5 top-[190px] rounded-[4px] py-1.5 text-center text-[9px] font-bold text-white">
        Easy Apply
      </p>
    </div>
  );
}

function LetterPage() {
  return (
    <div className="absolute inset-0 px-3.5 pt-3 font-serif text-[9px] leading-[12px] text-slate-700">
      <p className="mt-1">Dear Hiring Manager,</p>
      <p className="absolute inset-x-3.5 top-[50px]">
        I am writing to apply for the [Position] role at [Company].
      </p>
      <p className="absolute inset-x-3.5 top-[108px]">
        I am a hard-working team player who is passionate about [Industry].
      </p>
      <p className="absolute inset-x-3.5 top-[150px]">I look forward to hearing from you.</p>
      <p className="absolute inset-x-3.5 top-[180px]">Sincerely,</p>
      <p className="absolute inset-x-3.5 top-[194px]">[Your Name]</p>
    </div>
  );
}

// --- The paper balls and the wastebasket ---

/** Where page `index`'s ball is: grown in the page's place as it
 * crumples, thrown on an arc (steady across, falling under gravity), then
 * at rest in the pile at the rim, with a small bounce as it lands. */
function ballAt(index: number, v: number) {
  const t = through(v, BEAT_AT[index]);
  const start = { x: DOC.x + DOC.w / 2, y: DOC.y + DOC.h / 2 };
  const end = PILE[index];
  const grow = out(through(t, CRUMPLE));
  const fly = through(t, THROW);
  const land = through(t, LAND);
  const arc = 170;
  const bounce = land > 0 && land < 0.6 ? Math.sin((land / 0.6) * Math.PI) * 7 : 0;
  return {
    x: lerp(start.x, end.x, fly) - BALL_R,
    y: lerp(start.y, end.y, fly) - arc * 4 * fly * (1 - fly) - bounce - BALL_R,
    rotate: end.spin * out(fly) + (1 - grow) * -40,
    scale: lerp(0.35, 1, grow),
    opacity: clamp((through(t, CRUMPLE) - 0.2) / 0.3),
  };
}

function Ball({ p, index }: { p: MotionValue<number>; index: number }) {
  const pose = useTransform(p, (v) => ballAt(index, v));
  const x = useTransform(pose, (s) => s.x);
  const y = useTransform(pose, (s) => s.y);
  const rotate = useTransform(pose, (s) => s.rotate);
  const scale = useTransform(pose, (s) => s.scale);
  const opacity = useTransform(pose, (s) => s.opacity);
  return (
    <motion.div
      className="absolute top-0 left-0 drop-shadow-[0_3px_3px_rgb(16_24_40/0.22)] will-change-transform"
      style={{ x, y, rotate, scale, opacity, width: BALL_R * 2, height: BALL_R * 2 }}
    >
      <PaperBall variant={index} />
    </motion.div>
  );
}

/** A crumpled sheet: a lumpy outline, facets in three greys, crease lines. */
function PaperBall({ variant }: { variant: number }) {
  const turn = variant * 47;
  return (
    <svg
      viewBox="0 0 42 42"
      className="size-full overflow-visible"
      style={{ rotate: `${turn}deg` }}
    >
      <path
        d="M21 2.5 L28.5 4.5 L35 9 L39 16 L39.5 24 L36 31.5 L30 37 L22.5 39.5 L14 38 L7.5 33.5 L3 26.5 L2.5 18 L6 10.5 L12.5 5 Z"
        fill="#f7f8fb"
        stroke="#aeb3c2"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* Lit from the upper left: the lower right facets are the darkest. */}
      <path d="M21 2.5 L19 13 L28.5 4.5 Z" fill="#ffffff" />
      <path d="M39 16 L27 18 L39.5 24 Z" fill="#d4d8e2" />
      <path d="M14 38 L17 27 L22.5 39.5 Z" fill="#cfd3de" />
      <path d="M3 26.5 L12 21 L7.5 33.5 Z" fill="#dde0e9" />
      <path d="M6 10.5 L12 21 L2.5 18 Z" fill="#fbfbfd" />
      <path d="M30 37 L27 18 L36 31.5 Z" fill="#c4c9d5" />
      <path d="M27 18 L39.5 24 L36 31.5 Z" fill="#cbd0db" />
      <path d="M19 13 L27 18 L17 27 L12 21 Z" fill="#eef0f5" />
      <path
        d="M19 13 L27 18 L17 27 L12 21 Z M19 13 L12.5 5 M27 18 L35 9 M17 27 L14 38 M12 21 L3 26.5 M27 18 L30 37"
        fill="none"
        stroke="#a9aebd"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The wastebasket: a solid, matte pail (never see-through), its far wall
 * and rim drawn behind the balls and its body in front of them, so a ball
 * drops in below the lip and the pile shows above it. It rocks a little as
 * each ball lands, and a count shows how many will never be read.
 */
function Bin({ p }: { p: MotionValue<number> }) {
  // A damped rock after each landing, about its foot.
  const rock = useTransform(p, (v) => {
    for (let i = 0; i < BEAT_AT.length; i++) {
      const b = through(through(v, BEAT_AT[i]), LAND);
      if (b > 0 && b < 1) return 3.2 * Math.exp(-4 * b) * Math.sin(b * Math.PI * 3);
    }
    return 0;
  });
  const landed = useTransform(
    p,
    (v) => BEAT_AT.filter((range) => through(v, range) >= LAND[0]).length,
  );
  const count = useTransform(landed, (n) => String(n));
  const countOpacity = useTransform(landed, (n) => (n > 0 ? 1 : 0));
  const x = BIN.cx - BIN.top / 2;
  const top = BIN.rim - 14;
  const box = { left: x, top, width: BIN.top, height: BIN.h + 28 };
  const origin = `${BIN.top / 2}px ${BIN.h + 14}px`;

  return (
    <>
      <motion.div className="absolute" style={{ ...box, rotate: rock, transformOrigin: origin }}>
        <BinBack />
      </motion.div>
      {BEATS.map((beat, i) => (
        <Ball key={beat.gate} p={p} index={i} />
      ))}
      <motion.div className="absolute" style={{ ...box, rotate: rock, transformOrigin: origin }}>
        <BinFront />
        <motion.span
          className="bg-danger absolute -top-1 -right-2 grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[12px] font-bold text-white tabular-nums shadow-[0_4px_10px_-4px_rgb(192_42_61/0.6)] ring-2 ring-white"
          style={{ opacity: countOpacity }}
        >
          <motion.span>{count}</motion.span>
        </motion.span>
      </motion.div>
    </>
  );
}

/** The pail's outline: the rim's two ends, tapering to a rounded foot. */
function pailPath(w: number, foot: number, h: number) {
  const inset = (w - foot) / 2;
  return `M2 14 L${inset} ${h + 6} Q${w / 2} ${h + 18} ${w - inset} ${h + 6} L${w - 2} 14`;
}

function BinBack() {
  const w = BIN.top;
  return (
    <svg
      width={w}
      height={BIN.h + 28}
      viewBox={`0 0 ${w} ${BIN.h + 28}`}
      className="overflow-visible"
    >
      <defs>
        <linearGradient id="bin-mouth" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b5873" />
          <stop offset="1" stopColor="#8c88a3" />
        </linearGradient>
      </defs>
      {/* The floor's shadow. */}
      <ellipse cx={w / 2} cy={BIN.h + 20} rx={w / 2 - 6} ry={7} fill="rgb(16 24 40 / 0.16)" />
      {/* The dark inside, seen through the mouth, and the rim's far edge. */}
      <ellipse cx={w / 2} cy={14} rx={w / 2 - 2} ry={12} fill="url(#bin-mouth)" />
      <path
        d={`M2 14 A${w / 2 - 2} 12 0 0 1 ${w - 2} 14`}
        fill="none"
        stroke="#e7e5ef"
        strokeWidth="3.5"
      />
    </svg>
  );
}

function BinFront() {
  const w = BIN.top;
  const h = BIN.h;
  // Ribs moulded into the pail, each a lit edge beside a shadowed one.
  const ribs = [0.16, 0.32, 0.5, 0.68, 0.84];
  const inset = (w - BIN.foot) / 2;
  return (
    <svg width={w} height={h + 28} viewBox={`0 0 ${w} ${h + 28}`} className="overflow-visible">
      <defs>
        {/* Matte plastic: lit from the upper left, rolling off at the sides. */}
        <linearGradient id="bin-body" x1="0" x2="1">
          <stop offset="0" stopColor="#b3aec7" />
          <stop offset="0.16" stopColor="#dedbea" />
          <stop offset="0.34" stopColor="#f7f6fb" />
          <stop offset="0.6" stopColor="#dcd9e8" />
          <stop offset="0.86" stopColor="#bdb8cf" />
          <stop offset="1" stopColor="#a39dba" />
        </linearGradient>
        {/* Darker towards the foot, where less light reaches. */}
        <linearGradient id="bin-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.5" stopColor="#2f2945" stopOpacity="0" />
          <stop offset="1" stopColor="#2f2945" stopOpacity="0.22" />
        </linearGradient>
        <linearGradient id="bin-lip" x1="0" x2="1">
          <stop offset="0" stopColor="#d8d5e4" />
          <stop offset="0.35" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d4d0e1" />
        </linearGradient>
      </defs>
      <path d={`${pailPath(w, BIN.foot, h)} Q${w / 2} 38 2 14 Z`} fill="url(#bin-body)" />
      <path d={`${pailPath(w, BIN.foot, h)} Q${w / 2} 38 2 14 Z`} fill="url(#bin-shade)" />
      {ribs.map((r) => {
        const bow = Math.sin(Math.PI * r);
        const x1 = 2 + (w - 4) * r;
        const x2 = inset + (w - 2 * inset) * r;
        const y1 = 14 + 22 * bow + 6;
        const y2 = h + 4 + 10 * bow;
        return (
          <g key={r}>
            <line
              x1={x1 - 1.2}
              y1={y1}
              x2={x2 - 1}
              y2={y2}
              stroke="#ffffff"
              strokeOpacity="0.8"
              strokeWidth="1.4"
            />
            <line
              x1={x1 + 0.8}
              y1={y1}
              x2={x2 + 0.8}
              y2={y2}
              stroke="#5d5677"
              strokeOpacity="0.12"
              strokeWidth="1.4"
            />
          </g>
        );
      })}
      {/* The rolled lip along the near edge of the rim. */}
      <path
        d={`M2 14 Q${w / 2} 38 ${w - 2} 14`}
        fill="none"
        stroke="url(#bin-lip)"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d={`M2 16.5 Q${w / 2} 40.5 ${w - 2} 16.5`}
        fill="none"
        stroke="#7d7795"
        strokeOpacity="0.18"
        strokeWidth="1"
      />
    </svg>
  );
}

// --- The finale: WorkIt's application for the same posting ---

/** The followed card, in on the panel, scanned, and found ready. */
function Finale({ p }: { p: MotionValue<number> }) {
  const pose = useTransform(p, (v) => {
    const t = through(v, FINAL_AT);
    const enter = out(through(t, IN));
    return { x: -36 * (1 - enter), opacity: enter, scan: through(t, SCAN) };
  });
  const x = useTransform(pose, (s) => s.x);
  const opacity = useTransform(pose, (s) => s.opacity);
  const scanY = useTransform(pose, (s) => s.scan * 196);
  const scanOpacity = useTransform(pose, (s) => (s.scan > 0 && s.scan < 1 ? 1 : 0));
  const left = SCREEN.x + (SCREEN.w - CARD_WIDTH) / 2;
  const top = SCREEN.y + HEADER_H + 14;

  return (
    <>
      <motion.div className="absolute will-change-transform" style={{ left, top, x, opacity }}>
        <div className="relative">
          <FollowedCard stage="saved" />
          <motion.span
            className="pointer-events-none absolute inset-x-3 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--color-brand)_20%,var(--color-brand)_80%,transparent)]"
            style={{ y: scanY, opacity: scanOpacity }}
          />
        </div>
      </motion.div>
      <div
        className="absolute flex flex-wrap justify-center gap-1.5"
        // Under the card, both rows inside the panel: the second row of
        // checks once hung off its foot.
        style={{ left: SCREEN.x + 16, width: SCREEN.w - 32, top: SCREEN.y + SCREEN.h - 86 }}
      >
        {CHECKS.map((check, i) => (
          <CheckChip key={check} p={p} at={at(FINAL_AT, at(SCAN, 0.35 + i * 0.3))}>
            {check}
          </CheckChip>
        ))}
      </div>
    </>
  );
}

function CheckChip({
  p,
  at: from,
  children,
}: {
  p: MotionValue<number>;
  at: number;
  children: string;
}) {
  const opacity = useTransform(p, [from, from + 0.012], [0, 1]);
  const transform = useTransform(p, [from, from + 0.012], ["translateY(4px)", "translateY(0px)"]);
  return (
    <motion.span
      className="bg-positive-tint text-positive-ink inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold whitespace-nowrap"
      style={{ opacity, transform }}
    >
      <CheckIcon aria-hidden className="size-3.5" weight="bold" />
      {children}
    </motion.span>
  );
}
