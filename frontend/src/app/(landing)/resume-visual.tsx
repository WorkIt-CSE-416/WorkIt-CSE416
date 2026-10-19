import * as React from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "motion/react";
import { Check, FileText, PenLine, Tag, TrendingUp, type LucideIcon } from "lucide-react";
import { Folder } from "./folder";
import { candidate, resumeFeature, type ResumeSuggestion } from "./feature-data";
import { cn } from "@/lib/cn";

/**
 * Feature carousel visual for resume versions and ATS feedback. A "Resumes" folder
 * holds the versions; picking one scans it (the folder opens while it does): a
 * scan line sweeps the page, then the score counts up, matched keywords light
 * up, and suggestions appear. Applying one rewrites its bullet in place and
 * raises the score. The scan runs when it mounts in view. Rendered by
 * the product tour, whose MotionConfig makes transforms instant for visitors
 * who prefer reduced motion.
 */

const SCAN_SECONDS = 1.4;
// Score at or above this counts as a strong match (the ring turns green).
const STRONG_SCORE = 85;

const kindIcon: Record<ResumeSuggestion["kind"], LucideIcon> = {
  keyword: Tag,
  impact: TrendingUp,
  clarity: PenLine,
};

type Phase = "idle" | "scanning" | "done";

export default function ResumeVisual() {
  const { versions } = resumeFeature;
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const reduceMotion = useReducedMotion();

  const [activeId, setActiveId] = React.useState(versions[0].id);
  // The resume whose scan has finished. The phase follows from it, so a
  // newly picked resume scans again.
  const [scannedId, setScannedId] = React.useState<string | null>(null);
  const phase: Phase = !inView
    ? "idle"
    : reduceMotion || scannedId === activeId
      ? "done"
      : "scanning";
  // Applied suggestion ids. Kept across resume switches, so going back to a
  // resume shows the fixes already made to it.
  const [applied, setApplied] = React.useState<ReadonlySet<string>>(() => new Set());
  // The bullet that was just rewritten, for a brief highlight.
  const [flash, setFlash] = React.useState<{ bullet: number; key: number } | null>(null);

  const active = versions.find((version) => version.id === activeId) ?? versions[0];
  const appliedHere = active.suggestions.filter((suggestion) => applied.has(suggestion.id));
  const target = active.score + appliedHere.reduce((sum, suggestion) => sum + suggestion.points, 0);
  const bullets = active.bullets.map(
    (text, index) => appliedHere.find((suggestion) => suggestion.bullet === index)?.after ?? text,
  );
  const remaining = active.suggestions.filter((suggestion) => !applied.has(suggestion.id));

  // Scan when the card first comes into view, and again for each resume picked.
  React.useEffect(() => {
    if (!inView || reduceMotion) return;
    const timer = window.setTimeout(() => setScannedId(activeId), SCAN_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [inView, activeId, reduceMotion]);

  // The score counts up to the target once the scan is done.
  const score = useMotionValue(0);
  React.useEffect(() => {
    const to = phase === "done" ? target : 0;
    if (reduceMotion) {
      score.jump(to);
      return;
    }
    const controls = animate(score, to, {
      duration: phase === "done" ? 1.1 : 0.3,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [phase, target, reduceMotion, score]);

  const pickResume = (id: string) => {
    if (id === activeId) return;
    setFlash(null);
    setActiveId(id);
  };

  const applySuggestion = (suggestion: ResumeSuggestion) => {
    setApplied((current) => new Set(current).add(suggestion.id));
    setFlash((current) => ({ bullet: suggestion.bullet, key: (current?.key ?? 0) + 1 }));
  };

  return (
    <div ref={ref} className="flex w-full max-w-sm flex-col gap-5">
      {/* The Resumes folder (its papers lift while a resume is scanned) and the
              version switcher. These blocks use layout="position", so they glide
              (rather than jump) when a rewritten bullet changes the resume's height. */}
      <motion.div layout="position" className="flex flex-col items-center gap-4 pt-2">
        <div aria-hidden="true">
          <Folder
            size="md"
            label="Resumes"
            open={phase === "scanning"}
            className="shadow-landing-brand-600/20 shadow-lg"
          />
        </div>
        <div
          role="group"
          aria-label="Resume versions"
          className="flex rounded-full bg-white/50 p-1 ring-1 ring-white/70"
        >
          {versions.map((version) => {
            const isActive = version.id === activeId;
            return (
              <button
                key={version.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => pickResume(version.id)}
                className={cn(
                  "relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors",
                  isActive ? "text-ink" : "text-ink-meta hover:text-ink",
                )}
              >
                {/* The white pill slides to the picked version. */}
                {isActive && (
                  <motion.span
                    layoutId="resume-version-pill"
                    className="absolute inset-0 rounded-full bg-white shadow-sm ring-1 ring-slate-900/5"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <FileText className="relative size-3" />
                <span className="relative">{version.label}</span>
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* The picked resume, with its ATS score. */}
      <motion.div
        layout="position"
        className="relative overflow-hidden rounded-2xl bg-white p-4 shadow-[0_16px_32px_-20px_rgb(16_48_94/0.45)] ring-1 ring-slate-900/5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-ink-meta flex items-center gap-1.5 text-[11px] font-medium">
              <FileText className="size-3.5 shrink-0" />
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={active.file}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                >
                  {active.file}
                </motion.span>
              </AnimatePresence>
            </p>
            <p className="text-ink mt-2 text-sm font-semibold">{candidate.name}</p>
            <p className="text-ink-meta text-xs">{active.role}</p>
          </div>
          <ScoreRing
            score={score}
            phase={phase}
            strong={phase === "done" && target >= STRONG_SCORE}
          />
        </div>

        <div className="bg-border my-3 h-px" />

        <ul className="space-y-2">
          {bullets.map((text, index) => (
            <li key={index} className="relative flex gap-2 text-[11px] leading-4 text-slate-600">
              {flash?.bullet === index && (
                <motion.span
                  key={flash.key}
                  aria-hidden="true"
                  className="bg-landing-brand-100 absolute -inset-x-1.5 -inset-y-1 rounded-md"
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 1.6, delay: 0.4 }}
                />
              )}
              <span className="relative mt-1.5 size-1 shrink-0 rounded-full bg-slate-400" />
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={text}
                  className="relative"
                  initial={{ opacity: 0, y: 4, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -4, filter: "blur(4px)" }}
                  transition={{ duration: 0.35 }}
                >
                  <Highlighted text={text} keywords={active.keywords} on={phase === "done"} />
                </motion.span>
              </AnimatePresence>
            </li>
          ))}
        </ul>

        {/* Scan line: sweeps down the page, trailing a soft brand glow. */}
        <AnimatePresence>
          {phase === "scanning" && (
            <motion.div
              key={`scan-${activeId}`}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="border-landing-brand-500/70 to-landing-brand-300/40 absolute inset-x-0 h-24 -translate-y-full border-b-2 bg-linear-to-b from-transparent"
                initial={{ top: "0%" }}
                animate={{ top: "115%" }}
                transition={{ duration: SCAN_SECONDS, ease: [0.45, 0, 0.3, 1] }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Suggestions: skeletons while scanning, then one-click fixes. */}
      <motion.div layout="position" className="flex flex-col gap-2">
        <div className="text-ink-meta flex items-center justify-between px-1 text-[11px] font-medium">
          <span>Suggestions</span>
          {phase === "done" && (
            <motion.span
              key={`${activeId}-${remaining.length}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {remaining.length > 0
                ? `+${remaining.reduce((sum, suggestion) => sum + suggestion.points, 0)} pts available`
                : "All fixes applied"}
            </motion.span>
          )}
        </div>
        {phase === "done"
          ? active.suggestions.map((suggestion, index) => (
              <SuggestionRow
                key={suggestion.id}
                suggestion={suggestion}
                index={index}
                done={applied.has(suggestion.id)}
                onApply={() => applySuggestion(suggestion)}
              />
            ))
          : active.suggestions.map((suggestion) => <SuggestionSkeleton key={suggestion.id} />)}
      </motion.div>
    </div>
  );
}

/** Ring gauge for the ATS score: spins while scanning, then fills to the score. */
function ScoreRing({
  score,
  phase,
  strong,
}: {
  score: MotionValue<number>;
  phase: Phase;
  strong: boolean;
}) {
  const progress = useTransform(score, (value) => value / 100);
  const label = useTransform(score, (value) => Math.round(value).toString());

  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <div className="relative grid size-12 place-items-center">
        <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90" aria-hidden="true">
          <circle
            cx="24"
            cy="24"
            r="20"
            fill="none"
            strokeWidth="4"
            className="stroke-landing-brand-100"
          />
          {phase === "scanning" ? (
            <motion.g
              style={{ originX: "24px", originY: "24px" }}
              animate={{ rotate: 360 }}
              transition={{ duration: 0.9, ease: "linear", repeat: Infinity }}
            >
              <circle
                cx="24"
                cy="24"
                r="20"
                fill="none"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray="30 126"
                className="stroke-landing-brand-400"
              />
            </motion.g>
          ) : (
            <motion.circle
              cx="24"
              cy="24"
              r="20"
              fill="none"
              strokeWidth="4"
              strokeLinecap="round"
              style={{ pathLength: progress }}
              className={cn(
                "transition-colors duration-500",
                strong ? "stroke-emerald-500" : "stroke-landing-brand-600",
              )}
            />
          )}
        </svg>
        <span className="text-ink relative text-sm font-semibold tabular-nums">
          {phase === "done" ? <motion.span>{label}</motion.span> : "–"}
        </span>
      </div>
      <span className="text-ink-meta text-[10px] font-medium">ATS score</span>
    </div>
  );
}

function SuggestionRow({
  suggestion,
  index,
  done,
  onApply,
}: {
  suggestion: ResumeSuggestion;
  index: number;
  done: boolean;
  onApply: () => void;
}) {
  const Icon = kindIcon[suggestion.kind];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + index * 0.1, type: "spring", stiffness: 260, damping: 24 }}
      className="flex items-center gap-2.5 rounded-xl bg-white/80 p-2.5 shadow-sm ring-1 ring-white"
    >
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-lg transition-colors duration-300",
          done ? "bg-emerald-100 text-emerald-700" : "bg-landing-brand-100 text-landing-brand-700",
        )}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={done ? "done" : "todo"}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 26 }}
          >
            {done ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
          </motion.span>
        </AnimatePresence>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-ink text-xs font-semibold">{suggestion.title}</p>
        <p className="text-ink-meta text-[11px]">{suggestion.detail}</p>
      </div>
      {done ? (
        <motion.span
          initial={{ opacity: 0, x: 6 }}
          animate={{ opacity: 1, x: 0 }}
          className="shrink-0 px-1 text-[11px] font-semibold text-emerald-700"
        >
          +{suggestion.points}
        </motion.span>
      ) : (
        <motion.button
          type="button"
          onClick={onApply}
          aria-label={`Apply suggestion: ${suggestion.title}`}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.94 }}
          className="text-landing-brand-950 shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold [box-shadow:var(--brand-glass-edge)] [background:var(--brand-glass-fill)]"
        >
          Apply
        </motion.button>
      )}
    </motion.div>
  );
}

function SuggestionSkeleton() {
  return (
    <div
      className="flex items-center gap-2.5 rounded-xl bg-white/50 p-2.5 ring-1 ring-white/70"
      aria-hidden="true"
    >
      <span className="bg-landing-brand-100/70 size-7 shrink-0 animate-pulse rounded-lg" />
      <div className="flex-1 space-y-1.5">
        <div className="h-2 w-2/3 animate-pulse rounded-full bg-slate-200/80" />
        <div className="h-2 w-1/2 animate-pulse rounded-full bg-slate-200/60" />
      </div>
    </div>
  );
}

/** Text with each keyword wrapped in a highlight that fades in when `on`. */
function Highlighted({ text, keywords, on }: { text: string; keywords: string[]; on: boolean }) {
  const escaped = [...keywords]
    .sort((a, b) => b.length - a.length)
    .map((keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`));

  return parts.map((part, index) =>
    keywords.includes(part) ? (
      <mark
        key={index}
        className={cn(
          "-mx-0.5 rounded-[3px] px-0.5 transition-colors duration-500",
          on ? "bg-landing-brand-100 text-landing-brand-900" : "bg-transparent text-inherit",
        )}
        style={{ transitionDelay: on ? `${150 + index * 60}ms` : "0ms" }}
      >
        {part}
      </mark>
    ) : (
      <React.Fragment key={index}>{part}</React.Fragment>
    ),
  );
}
