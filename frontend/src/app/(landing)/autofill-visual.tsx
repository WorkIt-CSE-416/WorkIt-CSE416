import * as React from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { Check, FileText, LoaderCircle, RotateCcw, Send, Sparkles } from "lucide-react";
import { autofillFeature } from "./feature-data";
import { cn } from "@/lib/cn";

/**
 * Feature carousel visual for autofill: an application form that types itself in
 * from the candidate's profile, attaches their resume, then sends. It plays
 * shortly after it mounts in view; the button starts it early and the replay
 * button runs it again. Rendered by the product tour, whose MotionConfig makes
 * transforms instant for visitors who prefer reduced motion.
 */

// Timeline, in seconds from the start of a run.
const START = 0.25;
const SECONDS_PER_CHAR = 0.028;
const ATTACH_SECONDS = 0.35;
const FIELD_GAP = 0.15;
const SEND_PAUSE = 0.75;
const SEND_SECONDS = 0.8;

const fields = (() => {
  let at = START;
  return autofillFeature.fields.map((field) => {
    const start = at;
    const file = Boolean(field.file);
    const end = start + (file ? ATTACH_SECONDS : field.value.length * SECONDS_PER_CHAR);
    at = end + FIELD_GAP;
    return { ...field, file, start, end };
  });
})();
const FILLED_AT = fields[fields.length - 1].end;
const SEND_AT = FILLED_AT + SEND_PAUSE;
const SENT_AT = SEND_AT + SEND_SECONDS;

type Stage = "idle" | "filling" | "review" | "sending" | "sent";

function stageAt(elapsed: number | null): Stage {
  if (elapsed === null) return "idle";
  if (elapsed < FILLED_AT) return "filling";
  if (elapsed < SEND_AT) return "review";
  if (elapsed < SENT_AT) return "sending";
  return "sent";
}

export default function AutofillVisual() {
  const { job } = autofillFeature;
  const Logo = job.logo;
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduceMotion = useReducedMotion();

  // performance.now() when the current run started; null before the first run.
  const [startedAt, setStartedAt] = React.useState<number | null>(null);
  const [elapsed, setElapsed] = React.useState<number | null>(null);
  const stage = stageAt(elapsed);

  const run = React.useCallback(() => {
    if (reduceMotion) {
      setElapsed(SENT_AT);
      return;
    }
    setElapsed(0);
    setStartedAt(performance.now());
  }, [reduceMotion]);

  // Play once, shortly after the card scrolls into view.
  React.useEffect(() => {
    if (!inView || elapsed !== null) return;
    const timer = window.setTimeout(run, reduceMotion ? 0 : 500);
    return () => window.clearTimeout(timer);
  }, [inView, elapsed, run, reduceMotion]);

  // Drive the timeline frame by frame while a run is playing.
  React.useEffect(() => {
    if (startedAt === null) return;
    let frame = 0;
    const tick = (now: number) => {
      const seconds = (now - startedAt) / 1000;
      setElapsed(Math.min(seconds, SENT_AT));
      if (seconds < SENT_AT) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [startedAt]);

  return (
    <div
      ref={ref}
      className="w-full max-w-sm rounded-2xl bg-white p-3.5 shadow-[0_16px_32px_-20px_rgb(16_48_94/0.45)] ring-1 ring-slate-900/5"
    >
      {/* Job being applied to */}
      <div className="flex items-center gap-2.5">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", job.logoTone)}>
          <Logo className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-ink truncate text-xs font-semibold">{job.title}</p>
          <p className="text-ink-meta truncate text-[11px]">{job.company}</p>
        </div>
        <AnimatePresence>
          {stage === "sent" && (
            <motion.button
              type="button"
              onClick={run}
              aria-label="Replay autofill"
              initial={{ opacity: 0, rotate: -90 }}
              animate={{ opacity: 1, rotate: 0 }}
              exit={{ opacity: 0 }}
              whileHover={{ rotate: -45 }}
              whileTap={{ scale: 0.9 }}
              className="text-ink-meta ring-border hover:bg-surface hover:text-ink grid size-7 shrink-0 place-items-center rounded-full ring-1 transition-colors"
            >
              <RotateCcw className="size-3.5" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Fields */}
      <div className="mt-3 space-y-2">
        {fields.map((field) => {
          const t = elapsed ?? -1;
          const active = t >= field.start && t < field.end;
          const filled = t >= field.end;
          const chars = field.file
            ? 0
            : Math.max(0, Math.floor((t - field.start) / SECONDS_PER_CHAR));
          return (
            <div key={field.id} className="flex items-center gap-2">
              <span className="text-ink-meta w-15 shrink-0 text-[11px]">{field.label}</span>
              <div
                className={cn(
                  "text-ink relative flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2.5 text-xs ring-1 transition-[background-color,box-shadow] duration-300",
                  active ? "bg-landing-brand-50 ring-landing-brand-300" : "bg-surface ring-border",
                )}
              >
                {field.file ? (
                  <AnimatePresence initial={false}>
                    {filled && (
                      <motion.span
                        className="text-landing-brand-800 ring-landing-brand-200 flex min-w-0 items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[11px] font-medium ring-1"
                        initial={{ opacity: 0, scale: 0.8, x: -6 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ type: "spring", stiffness: 420, damping: 24 }}
                      >
                        <FileText className="size-3 shrink-0" />
                        <span className="truncate">{field.value}</span>
                      </motion.span>
                    )}
                  </AnimatePresence>
                ) : (
                  <span className="truncate">
                    {field.value.slice(0, filled ? undefined : chars)}
                    {active && (
                      <span
                        aria-hidden="true"
                        className="bg-landing-brand-600 ml-px inline-block h-3.5 w-px translate-y-0.5 animate-pulse"
                      />
                    )}
                  </span>
                )}
                <AnimatePresence initial={false}>
                  {filled && (
                    <motion.span
                      className="ml-auto grid size-4 shrink-0 place-items-center rounded-full bg-emerald-500 text-white"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 22 }}
                    >
                      <Check className="size-2.5" strokeWidth={3} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </div>
          );
        })}
      </div>

      <AutofillButton stage={stage} onStart={run} />
    </div>
  );
}

const buttonLabel: Record<Stage, { icon: React.ElementType; text: string; spin?: boolean }> = {
  idle: { icon: Sparkles, text: "Autofill with WorkIt" },
  filling: { icon: LoaderCircle, text: "Filling in from your profile", spin: true },
  review: { icon: Send, text: "Send application" },
  sending: { icon: LoaderCircle, text: "Sending", spin: true },
  sent: { icon: Check, text: "Application sent" },
};

function AutofillButton({ stage, onStart }: { stage: Stage; onStart: () => void }) {
  const { icon: Icon, text, spin } = buttonLabel[stage];
  return (
    <motion.button
      type="button"
      onClick={onStart}
      disabled={stage !== "idle"}
      // "Presses" itself when the run moves from review to sending.
      animate={stage === "sending" ? { scale: [1, 0.96, 1] } : { scale: 1 }}
      transition={{ duration: 0.3 }}
      whileHover={stage === "idle" ? { scale: 1.02 } : undefined}
      whileTap={stage === "idle" ? { scale: 0.97 } : undefined}
      className={cn(
        "mt-3 flex h-9 w-full items-center justify-center gap-2 overflow-hidden rounded-xl text-xs font-semibold transition-colors duration-300 disabled:cursor-default",
        stage === "sent"
          ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
          : "text-landing-brand-950 [box-shadow:var(--brand-glass-edge)] [background:var(--brand-glass-fill)]",
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={stage}
          className="flex items-center gap-2"
          initial={{ opacity: 0, y: 10, filter: "blur(3px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -10, filter: "blur(3px)" }}
          transition={{ duration: 0.25 }}
        >
          <Icon className={cn("size-3.5", spin && "animate-spin")} />
          {text}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
