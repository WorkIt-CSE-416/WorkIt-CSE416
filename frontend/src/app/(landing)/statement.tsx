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
import { CheckIcon, XIcon } from "@phosphor-icons/react/ssr";

import { Logo } from "@/components/logo";
import { cn } from "@/lib/cn";

import { FaviconLogo } from "./favicon-logo";
import { followedJob } from "./feature-data";
import { useLoopsHeld, useMediaQuery } from "./hooks";
import { CONTAINER, PANEL, PANEL_INSET } from "./layout-parts";
import { FollowedCard } from "./thread";

/**
 * The statement between the hiring-systems section and the applications
 * section: "Slop applications get skipped." The real words are the art: one
 * application for one posting (`followedJob`, Stripe) shows three things a
 * student sends blind, one at a time, in large type. A generic line writes
 * itself, the phrases that sink it are marked and say why, and it rewrites
 * itself into a specific line from the student's own experience bank. Then
 * WorkIt's application for the same posting, the followed card, is ready to
 * submit. Beside it, only one caption shows at a time, read word by word: the
 * problem while the generic line is up, then why the fix helps once it is
 * rewritten, since the problem left beside the fixed line read as a complaint
 * about the fix.
 *
 * It plays on its own like a carousel and loops (`useStoryLoop`): once the
 * section is on screen the beats follow one another in time, the finale
 * holds, and the story fades and starts again. The scroll plays no part: it is
 * not pinned, and nothing it does moves the story. Cued by the scroll, it
 * stopped whenever the reader did. With reduced motion it is a still list.
 *
 * It replaced a screening panel that crumpled each page into a paper ball and
 * threw it into a metal wastebasket, the page's only realistic illustration
 * (KAN-540).
 *
 * The lines, notes and captions are product copy. The gates' captions are
 * hedged ("often", "look like"): they describe the market, not WorkIt. The
 * specific lines are the demo student's bank (the resume line is the Tailor
 * scene's own rewrite), and the finale's claims follow the landing rules: auto
 * apply fills the form, the student clicks Submit, and nothing promises to
 * pass an ATS.
 */

type Beat = {
  gate: string;
  /** Its moving mark in the caption's chip (`GateIcon`). */
  mark: "scan" | "shield" | "bot";
  text: string;
  /** The application's field the line sits in. */
  field: string;
  /** The generic line. `**` marks the phrases that sink it. */
  slop: string;
  /** Why they sink it, one short reason each. */
  notes: string[];
  /** The line WorkIt writes. `**` marks the facts that make it specific. */
  specific: string;
  /** Where the specific line comes from. */
  source: string;
  /** Why the specific line helps, beside it once it is written. */
  fix: string;
};

const BEATS: Beat[] = [
  {
    gate: "ATS filter",
    mark: "scan",
    text: "One resume sent to every posting often gets filtered out before a person reads it.",
    field: "Resume",
    slop: "**Hard-working team player** with strong communication skills seeking **a challenging role.**",
    notes: ["Generic objective", "No posting keywords"],
    specific:
      "Built a **TypeScript** budgeting app on a **REST API,** used by **200 students** weekly.",
    source: "Tailored to this posting",
    fix: "Your resume uses the posting's own keywords, so it reads as written for this job.",
  },
  {
    gate: "Spam detection",
    mark: "shield",
    text: "Two hundred copy-paste applications look like spam, and get treated like it.",
    field: `Why do you want to work at ${followedJob.company}?`,
    slop: "I am passionate about **your company's mission** and **excited to contribute.**",
    notes: ["Could be any company", "Pasted 186 times"],
    specific:
      "I want to build the tools businesses **run their money on,** after shipping a budgeting app for **200 students.**",
    source: "Drafted from your experience bank",
    fix: "Each answer is about this company and your real work, so it doesn't read like a copy-paste.",
  },
  {
    gate: "Slop detection",
    mark: "bot",
    text: "A template cover letter reads like AI slop, so it gets skipped.",
    field: "Cover letter",
    slop: "Dear **[Hiring Manager],** I am **writing to express my interest** in the **[Position]** role.",
    notes: ["Placeholders left in", "Template phrasing"],
    specific:
      "Teaching **Data Structures** showed me how much clear code matters, and I want to bring that to your **payments APIs.**",
    source: "Drafted from your experience bank",
    fix: "Your letter comes from what you've really done, so it sounds like you, not a template.",
  },
];

const CLOSE =
  "WorkIt makes each one count: a resume tailored to the posting, a job that fits you, every field filled in. You click Submit.";
const CHECKS = ["Tailored to this posting", "Fits your skills", "Every field filled in"];

// --- The story's beats, on its timeline from 0 to 1, which plays on its
// own (`useStoryLoop`). Every range stays inside 0 to 1. ---

const BEAT_AT: [number, number][] = [
  [0.01, 0.28],
  [0.28, 0.55],
  [0.55, 0.82],
];
const FINAL_AT: [number, number] = [0.84, 0.98];
/** The story's pace on its timeline (about eleven seconds a beat, so each
 * phase ends and can be read: at six seconds the marks, the caption and the
 * new line were still arriving as the beat moved on), how long the finale
 * holds before it starts again, and the fade of each restart, in seconds. */
const RATE = 0.0237;
const HOLD = 1.5;
const RESET = 0.35;
/** How long a fade takes, on the timeline: about a quarter of a second. */
const FADE = 0.012;

/**
 * A label's fade across its stretch `[a, b]`: out just after `b`, and in
 * just after the label before it has gone, so the two never overlap.
 */
function fadeWindow(a: number, b: number) {
  const fadeIn = [a + FADE, a + 2 * FADE];
  const fadeOut = [b, b + FADE];
  if (a <= 0) return { input: fadeOut, output: [1, 0], first: true, last: false };
  if (b >= 1) return { input: fadeIn, output: [0, 1], first: false, last: true };
  return { input: [...fadeIn, ...fadeOut], output: [0, 1, 1, 0], first: false, last: false };
}
/** How long a beat's caption, and the finale's, take to read, on the
 * timeline. */
const READ = 0.06;
const READ_FINAL = 0.1;

// Within a beat (0 to 1): the generic line writes itself, its phrases are
// marked and say why, all of it holds until the caption has been read, then it
// rewrites itself word by word, left to right, its facts are marked, and the
// specific line holds to the beat's end. Each phase ends before the next.
const WRITE: [number, number] = [0.02, 0.14];
const FLAG: [number, number] = [0.17, 0.29];
const REWRITE: [number, number] = [0.5, 0.62];
const FACTS: [number, number] = [0.63, 0.7];
/** The share of the rewrite the old words take to go. */
const GONE = 0.55;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Progress `t` of the way through `beat`, from 0 to 1. */
const at = (beat: [number, number], t: number) => beat[0] + (beat[1] - beat[0]) * t;

/** Beat `i`'s two captions' stretches: the problem until the rewrite begins,
 * from the story's start for the first, then the fix until the next beat. */
const problemAt = (i: number): [number, number] => [
  i === 0 ? 0 : BEAT_AT[i][0],
  at(BEAT_AT[i], REWRITE[0]),
];
const fixAt = (i: number): [number, number] => [
  at(BEAT_AT[i], REWRITE[0]),
  BEAT_AT[i + 1]?.[0] ?? FINAL_AT[0],
];
/** Where in a beat its fix starts to be read: as the new line comes in. */
const READ_FIX = 0.56;

type Word = { text: string; marked: boolean };

/** A line's words, each marked if it sits inside `**`. */
const wordsOf = (line: string): Word[] =>
  line.split("**").flatMap((part, i) =>
    part
      .split(" ")
      .filter(Boolean)
      .map((text) => ({ text, marked: i % 2 === 1 })),
  );
/** A line as plain text. */
const plain = (line: string) => line.replaceAll("**", "");

// Tailwind's lg breakpoint.
const DESKTOP_QUERY = "(min-width: 64rem)";

export function Statement() {
  // Null until mounted, so the server's HTML and the first render agree.
  const mounted = useMediaQuery(DESKTOP_QUERY) !== null;
  const reduceMotion = useReducedMotion();
  return mounted && !reduceMotion ? <PlayingStatement /> : <StillStatement />;
}

/** The story, looping while it is on screen in a visible tab and resting where
 * it is otherwise: a screen-high panel from lg up, the line beside its
 * caption, and one column below it. */
function PlayingStatement() {
  const stageRef = React.useRef<HTMLDivElement>(null);
  const inView = useInView(stageRef, { amount: 0.4 });
  const held = useLoopsHeld();
  const playing = inView && !held;
  const { p, fade } = useStoryLoop(playing);
  return (
    <section
      aria-labelledby="statement-title"
      // The chips' marks move only while the story plays (landing.css).
      data-paused={playing ? undefined : ""}
      className={cn(PANEL_INSET, "mt-16 sm:mt-24")}
    >
      <div ref={stageRef} className="flex flex-col lg:h-[clamp(38rem,calc(100dvh-7.5rem),52rem)]">
        <Panel>
          <div className={cn(CONTAINER, "flex h-full flex-col py-14 lg:py-10 xl:py-12")}>
            <Headline />
            <motion.div
              className="mt-8 grid min-h-0 flex-1 items-center gap-8 lg:mt-0 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)] lg:gap-12 lg:pt-8"
              style={{ opacity: fade }}
            >
              <Application p={p} />
              <Story p={p} />
            </motion.div>
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
 * `fade` is the restart's opacity, so the reset never jumps in view.
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

/** With reduced motion: every beat in a short list, each generic line struck
 * through over the line that replaces it, then the finale. */
function StillStatement() {
  const done = useMotionValue(1);
  return (
    <section aria-labelledby="statement-title" className={cn(PANEL_INSET, "mt-16 sm:mt-24")}>
      <Panel>
        <div className={cn(CONTAINER, "py-16")}>
          <Headline />
          <ol className="mt-8 space-y-8">
            {BEATS.map((beat) => (
              <li key={beat.gate}>
                <GateChip beat={beat} />
                <p className="text-ink-muted mt-1.5 text-lg leading-snug">{beat.text}</p>
                <p className="text-ink-muted mt-3 text-pretty line-through">{plain(beat.slop)}</p>
                <p className="text-ink mt-1 text-lg font-semibold text-pretty">
                  {plain(beat.specific)}
                </p>
                <p className="text-ink-muted mt-1.5 text-lg leading-snug">{beat.fix}</p>
              </li>
            ))}
            <li>
              <WorkItChip />
              <p className="text-ink mt-1.5 text-lg leading-snug font-semibold">{CLOSE}</p>
            </li>
          </ol>
          <div aria-hidden="true" className="mt-10">
            <FollowedCard className="mx-auto max-w-full" />
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {CHECKS.map((check) => (
                <CheckChip key={check} p={done} at={0}>
                  {check}
                </CheckChip>
              ))}
            </div>
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

/** "Slop" is the headline's own text in a gradient (`.slop-word`, KAN-540).
 * It was "Stop sending slop applications.", a second "Stop" after the
 * hero's; it now says what the three beats show. */
function Headline() {
  return (
    <h2
      id="statement-title"
      className="text-ink text-[2.5rem] leading-[1.08] font-semibold tracking-[-0.035em] text-balance sm:text-6xl lg:text-[clamp(2.75rem,4.2vw,4rem)]"
    >
      <span className="slop-word">Slop</span> applications get skipped.
    </h2>
  );
}

/**
 * A caption's gate, as a chip the size of a label one reads: its mark on a
 * white disc, then its name. It moves while the story plays (`moving`); the
 * team found the small chips with still icons hard to notice.
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
 * where it had a check and "With WorkIt" in text. While the story plays the
 * figure's head hops now and then, a small cheer (`moving`).
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

// --- The caption column: one caption at a time ---

/**
 * One caption at a time: the last lifts away as the next comes in, and its
 * words come into focus as they are read. Each beat has two: the problem under
 * its gate's red chip, then, as the line is rewritten, why the fix helps under
 * WorkIt's. The moving application beside it is hidden from screen readers, so
 * its lines are read here.
 */
function Story({ p }: { p: MotionValue<number> }) {
  return (
    <div className="grid">
      {BEATS.map((beat, i) => (
        <React.Fragment key={beat.gate}>
          <Caption
            p={p}
            stretch={problemAt(i)}
            // Read once the line beside it has been marked: what, then why.
            readFrom={at(BEAT_AT[i], FLAG[0])}
            readFor={READ}
            chip={<GateChip beat={beat} moving />}
            text={beat.text}
          />
          <Caption
            p={p}
            stretch={fixAt(i)}
            readFrom={at(BEAT_AT[i], READ_FIX)}
            readFor={READ}
            chip={<WorkItChip moving />}
            text={beat.fix}
          />
        </React.Fragment>
      ))}
      <Caption
        p={p}
        stretch={[FINAL_AT[0], 1]}
        readFrom={FINAL_AT[0] + 0.005}
        readFor={READ_FINAL}
        chip={<WorkItChip moving />}
        text={CLOSE}
        strong
      />
      <ul className="sr-only">
        {BEATS.map((beat) => (
          <li key={beat.gate}>
            Instead of &ldquo;{plain(beat.slop)}&rdquo;: &ldquo;{plain(beat.specific)}&rdquo;
          </li>
        ))}
      </ul>
    </div>
  );
}

function Caption({
  p,
  stretch: [start, end],
  readFrom,
  readFor,
  chip,
  text,
  strong = false,
}: {
  p: MotionValue<number>;
  /** When it shows, on the timeline. */
  stretch: [number, number];
  readFrom: number;
  readFor: number;
  chip: React.ReactNode;
  text: string;
  strong?: boolean;
}) {
  // In just after its stretch begins (the first is there from the start),
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
  const step = readFor / words.length;

  return (
    <motion.div className="col-start-1 row-start-1 self-center" style={{ opacity, transform }}>
      {chip}
      <p
        className={cn(
          "text-ink mt-4 text-xl leading-[1.3] tracking-[-0.015em] text-pretty xl:text-2xl",
          strong ? "font-semibold" : "font-medium",
        )}
      >
        {words.map((word, i) => (
          <ReadWord key={i} p={p} start={readFrom + step * i} span={step * 2.5}>
            {word}
          </ReadWord>
        ))}
      </p>
    </motion.div>
  );
}

function ReadWord({
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

// --- The application: the lines, then the finale in the same place ---

/** The size of the lines: the type is the art, so it stays large on a phone,
 * where the old scene scaled to a miniature. */
const LINE =
  "isolate font-semibold text-pretty text-[1.625rem] leading-[1.22] tracking-[-0.022em] sm:text-[2.125rem] lg:text-[clamp(1.875rem,2.9vw,2.625rem)]";

/** One application for the followed posting, all three lines in one place, so
 * the card stands still and only the words change. Taller lines hold their
 * room in the grid, so nothing moves from beat to beat. The words are for
 * looking at: the same copy is in the caption column for a screen reader. */
function Application({ p }: { p: MotionValue<number> }) {
  const opacity = useTransform(p, [BEAT_AT[2][1], FINAL_AT[0]], [1, 0]);
  return (
    <div aria-hidden="true" className="grid items-center select-none">
      <motion.div
        className="col-start-1 row-start-1 min-w-0 rounded-[1.75rem] bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-8"
        style={{ opacity }}
      >
        <div className="flex items-center gap-2.5">
          <FaviconLogo domain={followedJob.domain} eager className="size-7 rounded-lg" />
          <p className="text-ink min-w-0 truncate text-sm font-semibold">
            {followedJob.title}
            <span className="text-ink-muted font-medium"> · {followedJob.company}</span>
          </p>
        </div>
        <div className="mt-5 grid">
          {BEATS.map((beat, i) => (
            <Lines key={beat.gate} p={p} beat={beat} range={BEAT_AT[i]} />
          ))}
        </div>
      </motion.div>
      <Finale p={p} />
    </div>
  );
}

/** One beat: the field, the generic line and its reasons, then the line that
 * replaces it and where that came from. */
function Lines({
  p,
  beat,
  range,
}: {
  p: MotionValue<number>;
  beat: Beat;
  range: [number, number];
}) {
  const slop = wordsOf(beat.slop);
  const specific = wordsOf(beat.specific);
  const flagged = slop.filter((word) => word.marked).length;
  const facts = specific.filter((word) => word.marked).length;
  let flag = 0;
  let fact = 0;
  return (
    <div className="col-start-1 row-start-1 min-w-0">
      <Fading
        p={p}
        from={range[0]}
        to={range[1]}
        className="text-ink-muted block text-sm font-medium"
      >
        {beat.field}
      </Fading>
      <div className={cn("mt-3 grid", LINE)}>
        <p className="text-ink-muted col-start-1 row-start-1">
          {slop.map((word, i) => {
            const enter = at(range, lerp(WRITE[0], WRITE[1], i / slop.length));
            const leave = at(
              range,
              lerp(REWRITE[0], lerp(REWRITE[0], REWRITE[1], GONE), i / slop.length),
            );
            return (
              <React.Fragment key={i}>
                <SlopWord
                  p={p}
                  enter={enter}
                  leave={leave}
                  index={i}
                  flag={
                    word.marked ? at(range, lerp(FLAG[0], FLAG[1], flag++ / flagged)) : undefined
                  }
                >
                  {word.text}
                </SlopWord>{" "}
              </React.Fragment>
            );
          })}
        </p>
        <p className="text-ink col-start-1 row-start-1">
          {specific.map((word, i) => {
            const enter = at(
              range,
              lerp(lerp(REWRITE[0], REWRITE[1], 1 - GONE), REWRITE[1], i / specific.length),
            );
            return (
              <React.Fragment key={i}>
                <SpecificWord
                  p={p}
                  enter={enter}
                  leave={range[1] - FADE}
                  fact={
                    word.marked ? at(range, lerp(FACTS[0], FACTS[1], fact++ / facts)) : undefined
                  }
                >
                  {word.text}
                </SpecificWord>{" "}
              </React.Fragment>
            );
          })}
        </p>
      </div>
      {/* The reasons, then in the same place where the new line came from. */}
      <div className="mt-5 grid">
        <div className="col-start-1 row-start-1 flex flex-wrap gap-2">
          {beat.notes.map((note, i) => (
            <Fading
              key={note}
              p={p}
              from={at(range, lerp(FLAG[0], FLAG[1], i / beat.notes.length))}
              to={at(range, REWRITE[0]) + FADE}
              className="bg-danger-tint text-danger inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold whitespace-nowrap"
            >
              <XIcon aria-hidden="true" className="size-3.5" weight="bold" />
              {note}
            </Fading>
          ))}
        </div>
        <Fading
          p={p}
          from={at(range, REWRITE[1])}
          to={range[1]}
          className="bg-landing-brand-50 text-landing-brand-800 col-start-1 row-start-1 inline-flex h-8 w-fit items-center gap-2 rounded-full px-3 text-[13px] font-semibold whitespace-nowrap"
        >
          <Logo size="mark" decorative className="h-3" />
          {beat.source}
        </Fading>
      </div>
    </div>
  );
}

/** Anything that fades in at `from`, lifting, and out by `to`. */
function Fading({
  p,
  from,
  to,
  className,
  children,
}: {
  p: MotionValue<number>;
  from: number;
  to: number;
  className?: string;
  children: React.ReactNode;
}) {
  const input = [from, from + FADE, to - FADE, to];
  const opacity = useTransform(p, input, [0, 1, 1, 0]);
  const transform = useTransform(p, input, [
    "translateY(6px)",
    "translateY(0px)",
    "translateY(0px)",
    "translateY(0px)",
  ]);
  return (
    <motion.span className={className} style={{ opacity, transform }}>
      {children}
    </motion.span>
  );
}

/** A word of the generic line: it comes in, takes the headline's flowing
 * gradient if it is one that sinks the line (`flag`, when), and goes as the
 * rewrite reaches it. Each word starts the flow a little later (`index`), so
 * the colour runs along a phrase. */
function SlopWord({
  p,
  enter,
  leave,
  index,
  flag,
  children,
}: {
  p: MotionValue<number>;
  enter: number;
  leave: number;
  index: number;
  flag?: number;
  children: string;
}) {
  const input = [enter, enter + FADE, leave, leave + FADE];
  const opacity = useTransform(p, input, [0, 1, 1, 0]);
  const transform = useTransform(p, input, [
    "translateY(0.14em)",
    "translateY(0em)",
    "translateY(0em)",
    "translateY(-0.14em)",
  ]);
  return (
    <motion.span
      className="relative inline-block will-change-transform"
      style={{ opacity, transform }}
    >
      {flag !== undefined && (
        <Marker p={p} from={flag} className="bg-[color-mix(in_oklab,#e0218a_7%,white)]" />
      )}
      {flag !== undefined ? (
        <Tinted p={p} from={flag} className="slop-word" delay={index * -0.5}>
          {children}
        </Tinted>
      ) : (
        children
      )}
    </motion.span>
  );
}

/** A word of the specific line: it comes in as the rewrite reaches it and is
 * marked in violet if it is one of the facts (`fact`, when). */
function SpecificWord({
  p,
  enter,
  leave,
  fact,
  children,
}: {
  p: MotionValue<number>;
  enter: number;
  leave: number;
  fact?: number;
  children: string;
}) {
  const input = [enter, enter + FADE, leave, leave + FADE];
  const opacity = useTransform(p, input, [0, 1, 1, 0]);
  const transform = useTransform(p, input, [
    "translateY(0.18em)",
    "translateY(0em)",
    "translateY(0em)",
    "translateY(0em)",
  ]);
  return (
    <motion.span
      className="relative inline-block will-change-transform"
      style={{ opacity, transform }}
    >
      {fact !== undefined && <Marker p={p} from={fact} className="bg-landing-brand-100" />}
      {fact !== undefined ? (
        <Tinted p={p} from={fact} className="text-landing-brand-800">
          {children}
        </Tinted>
      ) : (
        children
      )}
    </motion.span>
  );
}

/** A highlighter stroke behind a word, drawn left to right. Each runs a little
 * past its word, so the strokes of a phrase join up. */
function Marker({
  p,
  from,
  className,
}: {
  p: MotionValue<number>;
  from: number;
  className: string;
}) {
  const scaleX = useTransform(p, [from, from + FADE], [0, 1]);
  return (
    <motion.span
      className={cn(
        "absolute -inset-x-[0.14em] inset-y-[0.04em] -z-10 origin-left rounded-[0.08em]",
        className,
      )}
      style={{ scaleX }}
    />
  );
}

/** A word in its line's colour, crossfading to a copy in `className`: motion
 * cannot read a colour token or blend into a gradient, and over a word still
 * in its old colour a gradient's clipped text showed the old colour through. */
function Tinted({
  p,
  from,
  className,
  delay,
  children,
}: {
  p: MotionValue<number>;
  from: number;
  className: string;
  /** Where the copy's own animation starts, in seconds. */
  delay?: number;
  children: string;
}) {
  const reveal = useTransform(p, [from, from + FADE], [0, 1]);
  const base = useTransform(reveal, [0, 1], [1, 0]);
  return (
    <>
      <motion.span style={{ opacity: base }}>{children}</motion.span>
      <motion.span
        className={cn("absolute inset-0", className)}
        style={{ opacity: reveal, animationDelay: delay === undefined ? undefined : `${delay}s` }}
      >
        {children}
      </motion.span>
    </>
  );
}

// --- The finale: WorkIt's application for the same posting ---

/** The followed card, ready, in the place the lines were. */
function Finale({ p }: { p: MotionValue<number> }) {
  const input = [FINAL_AT[0], FINAL_AT[0] + 2 * FADE];
  const opacity = useTransform(p, input, [0, 1]);
  const transform = useTransform(p, input, ["translateY(14px)", "translateY(0px)"]);
  return (
    <motion.div
      className="col-start-1 row-start-1 flex min-w-0 flex-col items-center gap-5"
      style={{ opacity, transform }}
    >
      <FollowedCard className="max-w-full" />
      <div className="flex flex-wrap justify-center gap-1.5">
        {CHECKS.map((check, i) => (
          <CheckChip key={check} p={p} at={at(FINAL_AT, 0.2 + i * 0.1)}>
            {check}
          </CheckChip>
        ))}
      </div>
    </motion.div>
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
  const opacity = useTransform(p, [from, from + FADE], [0, 1]);
  const transform = useTransform(p, [from, from + FADE], ["translateY(4px)", "translateY(0px)"]);
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
