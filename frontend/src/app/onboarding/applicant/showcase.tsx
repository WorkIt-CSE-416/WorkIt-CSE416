"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";

import { STAGE_COLOR, STAGE_LABEL, type StageKey } from "@/app/(seeker)/stage-colors";
import { BriefcaseIcon, CalendarIcon, CheckIcon, FileIcon, SparkleIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { matchColor } from "@/lib/match";

/**
 * The moving picture behind onboarding's question (./story-panel): a scene of
 * what WorkIt does, drawn as a small mock screen (a matched job, a resume, the
 * applications board) with the notification that screen would send tucked
 * over its corner.
 *
 * ONE CLOCK. The card and its notification are one scene and change
 * together: the scene glides in (--animate-arrive), its notification follows
 * a beat later, and both leave together (--animate-leave) in the same spot
 * while the next scene arrives, so the change is a crossfade with no empty
 * frame. They used to cycle on two clocks and drifted out of step.
 *
 * SCALED TO FIT. The scenes are drawn at one size and scaled as a whole to
 * fill the room the panel leaves, up to MAX_SCALE, so a tall window gets a
 * big picture rather than a small card in a sea of lavender. All three scenes
 * stay mounted, stacked in one grid cell, so the stack's size is the largest
 * scene's and the scale holds still from one scene to the next. When the
 * room itself changes (a step with a longer question), the scale eases to
 * its new value rather than jumping. Under MIN_SCALE the stage hides
 * itself: the question needs the room more.
 *
 * DECORATION, NOT CONTENT. Every company, score and date here is made up
 * (the fixture companies the rest of the app's mocks use), so the whole
 * stage is aria-hidden: a screen reader must not announce an offer nobody
 * made. Under reduced motion it holds the first scene, since the global rule
 * stills the animations but not the timer.
 *
 * The notification takes its look from a "halo" toast: a glowing rim and a
 * frosted face, drawn in the brand violet with CSS alone, since the
 * original's rainbow rim and its `motion` dependency suit neither the
 * palette nor docs/motion.md.
 */

type Glyph = ComponentType<{ className?: string }>;
type Notice = { Icon: Glyph; title: string; body: string };

/** How long each scene stays, and how long after it its notification lands. */
const SCENE_MS = 6000;
const NOTICE_DELAY_MS = 550;
/** The stage never draws the scenes larger than this, nor smaller than
 *  MIN_SCALE (it hides instead). */
const MAX_SCALE = 1.8;
const MIN_SCALE = 0.85;

const SCENES: { Icon: Glyph; label: string; Screen: ComponentType; notice: Notice }[] = [
  {
    Icon: SparkleIcon,
    label: "Matched to Your Jobs",
    Screen: MatchScreen,
    notice: { Icon: SparkleIcon, title: "New Match · 88%", body: "Product Engineer at Lumen Labs" },
  },
  {
    Icon: FileIcon,
    label: "Build Your Resume",
    Screen: ResumeScreen,
    notice: {
      Icon: CheckIcon,
      title: "12 Skills Found",
      body: "Added to your profile from your resume",
    },
  },
  {
    Icon: BriefcaseIcon,
    label: "Manage Your Applications",
    Screen: BoardScreen,
    notice: {
      Icon: CalendarIcon,
      title: "Interview Scheduled",
      body: "Northwind Analytics, Thu at 2:00 PM",
    },
  },
];

/** The scene showing, the one leaving, and a count of changes so far. */
function useScenes() {
  const [state, setState] = useState({ index: 0, prev: -1, round: 0 });
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setTimeout(
      () =>
        setState((s) => ({
          index: (s.index + 1) % SCENES.length,
          prev: s.index,
          round: s.round + 1,
        })),
      SCENE_MS,
    );
    return () => clearTimeout(timer);
  }, [state.round]);
  return state;
}

/** The scale that fits `inner`'s natural size into `outer`, kept up to date
 *  as either changes size. Null until measured. */
function useFitScale() {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  useEffect(() => {
    if (!outer.current || !inner.current) return;
    const box = outer.current;
    const content = inner.current;
    const fit = () => {
      // offsetWidth and offsetHeight ignore the scale already applied.
      const s = Math.min(
        MAX_SCALE,
        box.clientWidth / content.offsetWidth,
        box.clientHeight / content.offsetHeight,
      );
      setScale(Number.isFinite(s) ? s : null);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  return { outer, inner, scale };
}

export function Showcase({ className }: { className?: string }) {
  const { index, prev, round } = useScenes();
  const { outer, inner, scale } = useFitScale();
  const shown = scale != null && scale >= MIN_SCALE;

  return (
    <div aria-hidden ref={outer} className={cn("relative", className)}>
      <div
        ref={inner}
        style={{ scale: scale ?? 1 }}
        className={cn(
          "ease-glide absolute top-1/2 left-1/2 grid -translate-1/2 p-4 transition-[opacity,scale] duration-500",
          !shown && "opacity-0",
        )}
      >
        {SCENES.map((scene, i) => {
          // The arriving scene gets a fresh key each round, so it mounts and
          // its own drawings (the ring, the bar, the cards) play again; the
          // leaving one keeps the key it arrived with, so it only fades.
          const role = i === index ? "arrive" : i === prev ? "leave" : "idle";
          const key =
            role === "arrive" ? `r${round}` : role === "leave" ? `r${round - 1}` : `i${i}`;
          return (
            <Scene
              key={key}
              {...scene}
              className={cn(
                "[grid-area:1/1]",
                role === "arrive" && "animate-arrive",
                role === "leave" && "animate-leave",
                role === "idle" && "invisible",
              )}
            />
          );
        })}
      </div>
    </div>
  );
}

function Scene({
  Icon,
  label,
  Screen,
  notice,
  className,
}: (typeof SCENES)[number] & { className?: string }) {
  return (
    <div className={cn("flex w-[24rem] flex-col", className)}>
      <div className="relative pt-4">
        {/* The label sits on the card's top edge, like a tab, rather than
            over it, so the scene spends its height on the screen. */}
        <span className="bg-panel text-body text-ink shadow-card absolute top-0 left-5 z-10 flex items-center gap-2 rounded-full px-3 py-1.5 font-medium">
          <Icon className="text-brand size-4" />
          {label}
        </span>
        <div className="bg-panel shadow-tile rounded-card -rotate-2 p-4 pt-6">
          <Screen />
        </div>
      </div>
      <div
        className="animate-arrive relative -mt-7 mr-[-1rem] w-[17rem] rotate-1 self-end"
        style={{ animationDelay: `${NOTICE_DELAY_MS}ms` }}
      >
        <Toast {...notice} />
      </div>
    </div>
  );
}

const RIM =
  "linear-gradient(120deg, color-mix(in oklab, var(--color-brand) 70%, transparent), var(--color-brand-pale), color-mix(in oklab, var(--color-brand) 35%, transparent))";

function Toast({ Icon, title, body }: Notice) {
  return (
    <div className="relative">
      <div className="bg-brand/25 absolute -inset-2 rounded-3xl blur-xl" />
      <div className="relative rounded-2xl p-px" style={{ background: RIM }}>
        <div className="bg-panel/90 flex items-start gap-3 rounded-[calc(1rem-1px)] p-3.5 backdrop-blur-xl">
          <span className="bg-brand-tint text-brand flex size-9 shrink-0 items-center justify-center rounded-full">
            <Icon className="size-4.5" />
          </span>
          <div className="min-w-0">
            <p className="text-body text-ink font-semibold">{title}</p>
            <p className="text-note text-ink-meta">{body}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Mock screens ------------------------------------------------------------ */

const RING_R = 18;
const RING_C = 2 * Math.PI * RING_R;

function MatchScreen() {
  const score = 88;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="bg-brand-tint text-brand rounded-control flex size-10 shrink-0 items-center justify-center font-bold">
          L
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body text-ink truncate font-semibold">Product Engineer, Design</p>
          <p className="text-note text-ink-meta">Lumen Labs · Remote</p>
        </div>
        <svg viewBox="0 0 44 44" className="size-11 shrink-0 -rotate-90">
          <circle
            cx="22"
            cy="22"
            r={RING_R}
            fill="none"
            strokeWidth="4"
            className="stroke-border-subtle"
          />
          <circle
            cx="22"
            cy="22"
            r={RING_R}
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            stroke={matchColor(score)}
            strokeDasharray={`${(RING_C * score) / 100} ${RING_C}`}
            className="animate-ring-fill"
          />
          <text
            x="22"
            y="22"
            dy="0.35em"
            textAnchor="middle"
            className="fill-ink [transform-origin:22px_22px] rotate-90 text-[10px] font-semibold"
          >
            {score}%
          </text>
        </svg>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {["Full-Time", "$150k–$185k", "Sponsors H1B"].map((chip) => (
          <span key={chip} className="bg-well text-note text-ink-muted rounded-full px-2 py-0.5">
            {chip}
          </span>
        ))}
      </div>
      <ul className="flex flex-col gap-1">
        {["React and TypeScript depth", "Pays above your floor"].map((line) => (
          <li key={line} className="text-note text-ink-muted flex items-center gap-1.5">
            <CheckIcon className="text-brand size-3.5" />
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResumeScreen() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="bg-brand-pale size-9 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <span className="bg-ink/70 h-2.5 w-28 rounded-full" />
          <span className="bg-ink-subtle/50 h-2 w-20 rounded-full" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-note text-ink font-semibold">Experience</p>
        {["w-full", "w-5/6", "w-2/3"].map((width) => (
          <span key={width} className={cn("bg-well h-2 rounded-full", width)} />
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {["React", "TypeScript", "SQL"].map((skill) => (
          <span
            key={skill}
            className="bg-brand-tint text-brand-ink text-note rounded-full px-2 py-0.5"
          >
            {skill}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="bg-well h-1.5 flex-1 overflow-hidden rounded-full">
          <span className="bg-brand animate-draw-x block h-full w-4/5 origin-left rounded-full" />
        </span>
        <span className="text-note text-ink-meta">80% Complete</span>
      </div>
    </div>
  );
}

const BOARD: [StageKey, string[]][] = [
  ["applied", ["Atlas Freight", "Verdant Health"]],
  ["interviewing", ["Northwind"]],
  ["offer", ["Lumen Labs"]],
];

function BoardScreen() {
  return (
    <div className="grid grid-cols-3 gap-2">
      {BOARD.map(([stage, companies]) => (
        <div
          key={stage}
          className={cn(
            "rounded-control flex flex-col gap-1.5 border p-2",
            STAGE_COLOR[stage].panel,
          )}
        >
          <p className="text-note text-ink flex items-center gap-1.5 font-semibold">
            <span className={cn("size-1.5 rounded-full", STAGE_COLOR[stage].fill)} />
            {STAGE_LABEL[stage]}
          </p>
          {companies.map((company, i) => (
            <span
              key={company}
              className="bg-panel text-note text-ink-muted animate-rise truncate rounded-md px-1.5 py-1 shadow-xs"
              style={{ animationDelay: `${120 + i * 80}ms` }}
            >
              {company}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
