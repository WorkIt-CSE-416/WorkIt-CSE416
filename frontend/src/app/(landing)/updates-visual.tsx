import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  CalendarCheck,
  Check,
  Eye,
  FileText,
  Handshake,
  MessageCircle,
  MessagesSquare,
  Send,
  Video,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/cn";

import { FaviconLogo } from "./favicon-logo";
import { updatesFeature } from "./feature-data";
import { Burst } from "./stage-timeline";
import { GLIDE, Story, type StoryScene } from "./story";

/**
 * The Updates stop: one application hearing back, the Cloudflare one the
 * Auto Apply stop filled. Each scene's update drops in as a notification, then
 * lands: the application's track moves on and the update opens below it
 * (the resume they opened, the recruiter's message, the interview on the
 * week, the offer). Timing and the scene title are the shared Story's; with
 * reduced motion it holds the offer.
 */

const SCENES = [
  { id: "viewed", caption: "Cloudflare opens your application", hold: 3800 },
  { id: "message", caption: "Their recruiter writes back", hold: 4800 },
  { id: "interview", caption: "The interview lands on your week", hold: 4000 },
  { id: "offer", caption: "Then the offer, the moment it is sent", hold: 5000 },
] as const satisfies readonly StoryScene<string>[];

type Scene = (typeof SCENES)[number]["id"];
const ORDER: Record<Scene, number> = { viewed: 0, message: 1, interview: 2, offer: 3 };

/** How long a notification shows before its update lands, in ms. */
const LAND_MS = 1100;

/** The stage: the notification's room, the application card, the update. */
const STAGE_H = 368;

/** The notification for each scene. */
const NOTICE: Record<Scene, { icon: LucideIcon; text: string; color: string }> = {
  viewed: { icon: Eye, text: "viewed your application", color: "var(--color-match-good)" },
  message: { icon: MessageCircle, text: "sent you a message", color: "var(--color-brand)" },
  interview: {
    icon: CalendarCheck,
    text: "scheduled your interview",
    color: "var(--color-warning-fill)",
  },
  offer: { icon: Handshake, text: "sent you an offer", color: "var(--color-positive)" },
};

/** The application's track: the board's stage icons and colours, plus
 * Viewed in the stop's pink. `ink` is the colour as text on its tint (the
 * amber and green fills are too pale to read). `at` is the scene that
 * reaches it. */
const STEPS: { label: string; icon: LucideIcon; color: string; ink: string; at: number }[] = [
  {
    label: "Applied",
    icon: Send,
    color: "var(--color-brand)",
    ink: "var(--color-brand-ink)",
    at: -1,
  },
  {
    label: "Viewed",
    icon: Eye,
    color: "var(--color-match-good)",
    ink: "var(--color-match-good)",
    at: 0,
  },
  {
    label: "Interview",
    icon: MessagesSquare,
    color: "var(--color-warning-fill)",
    ink: "var(--color-warning)",
    at: 2,
  },
  {
    label: "Offer",
    icon: Handshake,
    color: "var(--color-positive)",
    ink: "var(--color-positive-ink)",
    at: 3,
  },
];

export default function UpdatesVisual() {
  return (
    <Story scenes={SCENES} rest="offer" accent="bg-match-good" stageHeight={STAGE_H}>
      {(scene) => <Board scene={scene} />}
    </Story>
  );
}

function Board({ scene }: { scene: Scene }) {
  const reduceMotion = useReducedMotion();
  const n = ORDER[scene];
  // The last scene whose update has landed. Back to none when the story
  // starts over; set during render, not in an effect.
  const [landed, setLanded] = React.useState(reduceMotion ? n : -1);
  const [seen, setSeen] = React.useState(n);
  if (n !== seen) {
    setSeen(n);
    if (n === 0) setLanded(-1);
  }
  React.useEffect(() => {
    const timer = window.setTimeout(() => setLanded(n), reduceMotion ? 0 : LAND_MS);
    return () => window.clearTimeout(timer);
  }, [n, reduceMotion]);

  const showing = landed === n;

  return (
    <div className="absolute inset-0 flex flex-col gap-3 pt-2">
      <Notice scene={scene} hidden={showing} />
      <ApplicationCard landed={landed} />
      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait">
          {showing && (
            <motion.div
              key={scene}
              className="absolute inset-0"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.18 } }}
              transition={{ duration: 0.4, ease: GLIDE }}
            >
              {scene === "viewed" && <ViewedUpdate />}
              {scene === "message" && <MessageUpdate />}
              {scene === "interview" && <InterviewUpdate />}
              {scene === "offer" && <OfferUpdate />}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** The notification: drops in over the card, then rises away as it lands. */
function Notice({ scene, hidden }: { scene: Scene; hidden: boolean }) {
  const { company, domain } = updatesFeature.application;
  const { icon: Icon, text, color } = NOTICE[scene];
  return (
    <AnimatePresence>
      {!hidden && (
        <motion.div
          key={scene}
          className="glass-card text-ink absolute inset-x-6 top-2 z-20 flex items-center gap-3 rounded-2xl p-2.5 pr-4"
          initial={{ opacity: 0, y: -24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -14, scale: 0.98, transition: { duration: 0.25 } }}
          transition={{ type: "spring", stiffness: 360, damping: 26 }}
        >
          <span className="relative shrink-0">
            <FaviconLogo domain={domain} eager className="rounded-xl" />
            <span
              className="absolute -right-1 -bottom-1 grid size-[18px] place-items-center rounded-full text-white ring-2 ring-white"
              style={{ background: color }}
            >
              <Icon className="size-2.5" aria-hidden="true" />
            </span>
          </span>
          <span className="min-w-0 flex-1 text-[13px]">
            <span className="font-semibold">{company}</span> {text}
          </span>
          <span className="text-ink-meta shrink-0 text-[11px]">now</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The application on the student's tracker, its track moving as updates land. */
function ApplicationCard({ landed }: { landed: number }) {
  const { title, company, domain, applied } = updatesFeature.application;
  const reached = STEPS.filter((step) => step.at <= landed).length - 1;
  const current = STEPS[reached];
  return (
    <div className="rounded-2xl bg-white p-4 shadow-[0_16px_36px_-22px_rgb(16_48_94/0.5)] ring-1 ring-slate-900/5">
      <div className="flex items-center gap-3">
        <FaviconLogo domain={domain} eager className="size-10 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-ink truncate text-[14px] font-semibold">{title}</p>
          <p className="text-ink-meta text-[11.5px]">
            {company} · Applied {applied}
          </p>
        </div>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={current.label}
            className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{
              color: current.ink,
              background: `color-mix(in oklab, ${current.color} 14%, white)`,
            }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: GLIDE }}
          >
            {current.label}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* The track: a line through four nodes, filling as stages are reached. */}
      <div className="relative mt-4 grid grid-cols-4">
        <span className="absolute top-3 right-[12.5%] left-[12.5%] h-[3px] -translate-y-1/2 rounded-full bg-slate-100" />
        {/* The whole track's gradient, uncovered up to the stage reached. */}
        <motion.span
          className="absolute top-3 right-[12.5%] left-[12.5%] h-[3px] -translate-y-1/2 rounded-full"
          style={{
            background: `linear-gradient(to right, ${STEPS.map((step) => step.color).join(", ")})`,
          }}
          initial={false}
          animate={{
            clipPath: `inset(0 ${(1 - reached / (STEPS.length - 1)) * 100}% 0 0 round 2px)`,
          }}
          transition={{ duration: 0.6, ease: GLIDE }}
        />
        {STEPS.map((step, i) => {
          const lit = i <= reached;
          const Icon = step.icon;
          return (
            <div key={step.label} className="relative flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full ring-1 ring-slate-900/8 transition-[background-color,color,scale] duration-300 ring-inset",
                  i === reached ? "scale-115" : "scale-100",
                )}
                style={{
                  background: lit ? step.color : "white",
                  color: lit ? "white" : "#94a3b8",
                  transitionDelay: lit && i === reached ? "250ms" : "0ms",
                }}
              >
                <Icon className="size-3" aria-hidden="true" />
              </span>
              <span
                className={cn(
                  "text-[10.5px] font-medium transition-colors duration-300",
                  lit ? "text-ink" : "text-ink-meta",
                )}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The update's panel: one white card filling the room under the application. */
const PANEL =
  "flex h-full items-center gap-5 rounded-2xl bg-white/90 p-4 shadow-[0_16px_36px_-22px_rgb(16_48_94/0.5)] ring-1 ring-slate-900/5";

function ViewedUpdate() {
  return (
    <div className={PANEL}>
      {/* The tailored resume they opened, a recruiter's eye on it. */}
      <div className="relative h-[136px] w-[104px] shrink-0 rounded-md bg-white p-2.5 shadow-[0_12px_28px_-16px_rgb(16_48_94/0.55)] ring-1 ring-slate-900/5">
        <span className="mx-auto block h-[5px] w-1/2 rounded-full bg-slate-500" />
        <span className="mx-auto mt-1 block h-[3px] w-3/4 rounded-full bg-slate-200" />
        {[0, 1, 2].map((k) => (
          <div key={k} className="mt-2 flex flex-col gap-[3px]">
            <span className="block h-[3px] w-1/3 rounded-full bg-slate-500" />
            <span className="block h-px w-full bg-slate-300" />
            <span className="block h-[3px] w-4/5 rounded-full bg-slate-200" />
            <span className="block h-[3px] w-3/5 rounded-full bg-slate-200" />
          </div>
        ))}
        {/* A slow scan down the page, as it is read. */}
        <motion.span
          aria-hidden="true"
          className="via-match-good/25 pointer-events-none absolute inset-x-0 h-8 bg-linear-to-b from-transparent to-transparent"
          initial={{ top: "-20%" }}
          animate={{ top: "100%" }}
          transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.4 }}
        />
        <span className="bg-match-good absolute -top-2 -right-2 grid size-7 place-items-center rounded-full text-white shadow-md">
          <Eye className="size-3.5" aria-hidden="true" />
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-ink text-[15px] font-semibold">Your resume was opened</p>
        <p className="text-ink-meta mt-1 flex items-center gap-1.5 text-[12px]">
          <FileText className="text-danger size-3.5 shrink-0" aria-hidden="true" />
          Alex_Morgan_Cloudflare.pdf
        </p>
        <p className="text-ink-meta mt-3 text-[12px] leading-snug">
          By {updatesFeature.application.company}&rsquo;s recruiting team, just now. Your tracker
          marks it Viewed, so you know where it stands.
        </p>
      </div>
    </div>
  );
}

function MessageUpdate() {
  const { company, domain } = updatesFeature.application;
  const { text, replies } = updatesFeature.message;
  // Typing, then the message, then the quick replies, then one is sent.
  const [beat, setBeat] = React.useState(0);
  React.useEffect(() => {
    const times = [700, 1400, 2300];
    const timers = times.map((ms, i) => window.setTimeout(() => setBeat(i + 1), ms));
    return () => timers.forEach(window.clearTimeout);
  }, []);

  return (
    <div className={cn(PANEL, "flex-col items-stretch justify-center gap-2.5")}>
      <div className="flex items-center gap-2">
        <FaviconLogo domain={domain} eager className="size-6 rounded-md" />
        <span className="text-ink text-[12px] font-semibold">{company} Recruiting</span>
        <span className="text-ink-meta text-[11px]">· now</span>
      </div>

      {/* Their bubble: three dots while they type, then the words. */}
      <div className="min-h-[52px]">
        <AnimatePresence mode="wait">
          {beat === 0 ? (
            <motion.span
              key="typing"
              className="inline-flex gap-1 rounded-2xl rounded-tl-md bg-slate-100 px-3 py-3"
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
            >
              {[0, 1, 2].map((dot) => (
                <motion.span
                  key={dot}
                  className="size-1.5 rounded-full bg-slate-400"
                  animate={{ y: [0, -3, 0] }}
                  transition={{ duration: 0.6, repeat: Infinity, delay: dot * 0.12 }}
                />
              ))}
            </motion.span>
          ) : (
            <motion.p
              key="text"
              className="text-ink max-w-[88%] rounded-2xl rounded-tl-md bg-slate-100 px-3 py-2 text-[12.5px] leading-snug"
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.3, ease: GLIDE }}
            >
              {text}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* The student's side: quick replies, then the one they send. */}
      <div className="flex min-h-[30px] justify-end gap-2">
        <AnimatePresence mode="wait">
          {beat === 2 && (
            <motion.div
              key="replies"
              className="flex gap-2"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.25 }}
            >
              {replies.map((reply, i) => (
                <span
                  key={reply}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[12px] font-medium ring-1",
                    i === 0
                      ? "bg-brand-tint text-brand-ink ring-brand/30"
                      : "text-ink-meta bg-white ring-slate-900/10",
                  )}
                >
                  {reply}
                </span>
              ))}
            </motion.div>
          )}
          {beat === 3 && (
            <motion.span
              key="sent"
              className="bg-brand flex items-center gap-1.5 rounded-2xl rounded-br-md px-3 py-1.5 text-[12.5px] font-medium text-white"
              initial={{ opacity: 0, x: 10, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 420, damping: 28 }}
            >
              {replies[0]}
              <Check className="size-3.5 opacity-80" aria-hidden="true" />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function InterviewUpdate() {
  const { title, week, day, time } = updatesFeature.interview;
  return (
    <div className={PANEL}>
      {/* The week: the interview drops into its day. */}
      <div className="grid w-[248px] shrink-0 grid-cols-5 gap-1.5">
        {week.map((d, i) => (
          <div key={d.date} className="flex flex-col items-center gap-1">
            <span
              className={cn(
                "text-[10px] font-medium",
                i === day ? "text-warning" : "text-ink-meta",
              )}
            >
              {d.day}
            </span>
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full text-[11px] font-semibold",
                i === day ? "bg-warning-fill text-white" : "text-ink",
              )}
            >
              {d.date}
            </span>
            <div className="relative mt-1 h-[92px] w-full overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-900/5">
              {/* Hour lines. */}
              {[1, 2, 3].map((line) => (
                <span
                  key={line}
                  className="absolute inset-x-0 h-px bg-slate-200/80"
                  style={{ top: `${line * 25}%` }}
                />
              ))}
              {i === day && (
                <motion.span
                  className="bg-warning-fill absolute inset-x-1 top-[44%] h-[30%] rounded-md shadow-[0_6px_14px_-6px_var(--color-warning-fill)]"
                  initial={{ opacity: 0, y: -40 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25, type: "spring", stiffness: 320, damping: 20 }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="min-w-0">
        <p className="text-ink text-[15px] font-semibold">{title}</p>
        <p className="text-ink-meta mt-1 text-[12px]">
          Thu, Oct {week[day].date} · {time}
        </p>
        <p className="text-ink-meta mt-0.5 flex items-center gap-1.5 text-[12px]">
          <Video className="size-3.5 shrink-0" aria-hidden="true" />
          Video call with the frontend team
        </p>
        <motion.p
          className="text-positive-ink mt-3 flex items-center gap-1.5 text-[12px] font-semibold"
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.8, duration: 0.3 }}
        >
          <span className="bg-positive grid size-4 place-items-center rounded-full text-white">
            <Check className="size-2.5" strokeWidth={3.5} aria-hidden="true" />
          </span>
          On your calendar
        </motion.p>
      </div>
    </div>
  );
}

function OfferUpdate() {
  const { company, title } = updatesFeature.application;
  const { term, replyBy } = updatesFeature.offer;
  return (
    <div
      className={cn(PANEL, "ring-positive/30")}
      style={{
        background:
          "radial-gradient(80% 120% at 0% 0%, color-mix(in oklab, var(--color-positive) 16%, white), white 70%)",
      }}
    >
      <span className="relative grid size-16 shrink-0 place-items-center">
        <motion.span
          className="bg-positive grid size-16 place-items-center rounded-2xl text-white shadow-[0_14px_28px_-12px_var(--color-positive)]"
          initial={{ scale: 0.6, rotate: -8 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 16 }}
        >
          <Handshake className="size-8" aria-hidden="true" />
        </motion.span>
        <Burst color="var(--color-positive)" />
      </span>
      <div className="min-w-0">
        <p className="text-positive-ink text-[11px] font-semibold tracking-wide uppercase">Offer</p>
        <p className="text-ink mt-0.5 text-[18px] leading-tight font-semibold">
          {company} wants you on the team
        </p>
        <p className="text-ink-meta mt-1 text-[12px]">
          {title} · {term}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="bg-positive rounded-full px-3 py-1 text-[12px] font-semibold text-white">
            Review offer
          </span>
          <span className="text-ink rounded-full bg-white px-3 py-1 text-[12px] font-medium ring-1 ring-slate-900/10">
            Reply by {replyBy}
          </span>
        </div>
      </div>
    </div>
  );
}
