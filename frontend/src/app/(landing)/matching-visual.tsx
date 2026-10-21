import * as React from "react";
import Image from "next/image";
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import { ArrowDownWideNarrow } from "lucide-react";

import { cn } from "@/lib/cn";

import { candidate, matchingFeature, type MatchFactor, type MatchJob } from "./feature-data";
import { scoreTone } from "./score-tone";
import { GLIDE, Story, type StoryScene } from "./story";

/**
 * The Matching stop, told as the app scores (backend matching/scoring.py):
 * WorkIt reads the student's experience bank into a profile, reads each
 * job posting for what the student has, scores each one with the four
 * things it weighs, and sorts them into Best Match order. The student is
 * the Resumes stop's Alex Morgan, so the two stops read as one pipeline.
 * One board across all four scenes, so the profile and the cards move
 * rather than swap. Timing and the step bar are the shared Story's.
 */

const SCENES = [
  { id: "read", label: "Read", caption: "WorkIt reads your experience bank", hold: 3200 },
  {
    id: "scan",
    label: "Scan",
    caption: "Then every job posting, for what you already have",
    hold: 4400,
  },
  {
    id: "score",
    label: "Score",
    caption: "Each posting gets a match, and the reasons for it",
    hold: 4600,
  },
  { id: "rank", label: "Rank", caption: "The best fits rise to the top", hold: 4200 },
] as const satisfies readonly StoryScene<string>[];

type Phase = (typeof SCENES)[number]["id"];
const PHASE_INDEX: Record<Phase, number> = { read: 0, scan: 1, score: 2, rank: 3 };

/** The stage's columns: the profile on the left, the postings on the right. */
const STAGE_W = 520;
const LEFT_W = 172;

/** Seconds between two cards' scans. */
const SCAN_STEP = 0.55;

const { profile, jobs, factorLabels } = matchingFeature;
const ranked = [...jobs].sort((a, b) => b.score - a.score);
const best = ranked[0];
const has = (keyword: string) => profile.skills.includes(keyword);

export default function MatchingVisual() {
  return (
    <Story
      label="Matching steps"
      scenes={SCENES}
      rest="rank"
      accent="bg-brand/50"
      stageHeight={480}
    >
      {(scene) => <Board phase={scene} />}
    </Story>
  );
}

function Board({ phase }: { phase: Phase }) {
  const p = PHASE_INDEX[phase];
  const order = p === 3 ? ranked : jobs;

  return (
    <div className="absolute inset-0 flex gap-3">
      {/* The profile: centred while it is read, then to the left column. */}
      <motion.div
        className="flex shrink-0 flex-col gap-3"
        style={{ width: LEFT_W }}
        animate={{ x: p === 0 ? (STAGE_W - LEFT_W) / 2 : 0 }}
        // Back to the middle only once the cards have faded out.
        transition={{ duration: 0.6, ease: GLIDE, delay: p === 0 ? 0.2 : 0 }}
      >
        <ProfileCard lit={p >= 1} />
        <AnimatePresence mode="wait">
          {p === 0 ? (
            <motion.p
              key="source"
              className="text-brand text-center text-[11px] font-semibold"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={{ delay: 1.4, duration: 0.3 }}
            >
              Read from your experience bank
            </motion.p>
          ) : (
            p >= 2 && <WhyPanel key="why" />
          )}
        </AnimatePresence>
      </motion.div>

      {/* The postings: read, scored, then sorted. */}
      <AnimatePresence>
        {p >= 1 && (
          <motion.div
            key="postings"
            className="flex min-w-0 flex-1 flex-col gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
          >
            <ListHeader phase={phase} />
            {order.map((job, i) => (
              <JobCard
                key={job.id}
                job={job}
                // The scan order, so a card's scan and score keep their turn
                // when the list is sorted.
                turn={jobs.indexOf(job)}
                phase={phase}
                first={p === 3 && i === 0}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ProfileCard({ lit }: { lit: boolean }) {
  // A skill lights up once the scan finds it in a posting.
  const found = new Set(jobs.flatMap((job) => job.keywords).filter(has));
  return (
    <div className="rounded-xl bg-white p-3 shadow-[0_12px_28px_-16px_rgb(16_48_94/0.5)] ring-1 ring-slate-900/5">
      <div className="flex items-center gap-2">
        <span className="bg-brand-tint text-brand-ink grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-bold">
          AM
        </span>
        <span className="min-w-0">
          <span className="text-ink block truncate text-xs font-semibold">{candidate.name}</span>
          <span className="text-ink-meta block text-[10px] leading-tight">{profile.degree}</span>
        </span>
      </div>

      <p className="text-ink-meta mt-3 text-[10px] font-medium">Skills</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {profile.skills.map((skill, i) => (
          <motion.span
            key={skill}
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 transition-colors duration-500 ring-inset",
              lit && found.has(skill)
                ? "bg-brand-tint text-brand-ink ring-brand/30"
                : "text-ink bg-slate-50 ring-slate-900/5",
            )}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 + i * 0.12, type: "spring", stiffness: 420, damping: 24 }}
          >
            {skill}
          </motion.span>
        ))}
      </div>

      <p className="text-ink-meta mt-2.5 text-[10px] font-medium">Past titles</p>
      <div className="mt-1 flex flex-col gap-0.5">
        {profile.titles.map((title, i) => (
          <motion.span
            key={title}
            className="text-ink text-[10px]"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1 + i * 0.12, duration: 0.3 }}
          >
            {title}
          </motion.span>
        ))}
      </div>
    </div>
  );
}

/** Why the best job scored as it did: the four things the score weighs. */
function WhyPanel() {
  const factors = Object.keys(factorLabels) as MatchFactor[];
  const shared = best.keywords.filter(has);
  return (
    <motion.div
      className="rounded-xl bg-white/90 p-3 shadow-[0_12px_28px_-16px_rgb(16_48_94/0.5)] ring-1 ring-slate-900/5"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ delay: 0.9, duration: 0.35, ease: GLIDE }}
    >
      <p className="text-ink text-[11px] font-semibold">
        Why {best.company} is a {best.score}
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        {factors.map((factor, i) => (
          <div key={factor} className="flex items-center gap-2">
            <span className="text-ink-meta w-[58px] shrink-0 text-[10px]">
              {factorLabels[factor]}
            </span>
            <span className="bg-brand-tint h-1.5 flex-1 overflow-hidden rounded-full">
              <motion.span
                className="bg-brand block h-full rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${best.factors[factor] * 100}%` }}
                transition={{ delay: 1.2 + i * 0.15, duration: 0.6, ease: GLIDE }}
              />
            </span>
          </div>
        ))}
      </div>
      <p className="text-ink-meta mt-2 text-[10px] leading-snug">
        Mentions {shared.join(" and ")}, both in your bank.
      </p>
    </motion.div>
  );
}

function ListHeader({ phase }: { phase: Phase }) {
  const text =
    phase === "rank"
      ? "Best Match"
      : phase === "score"
        ? `Scoring ${jobs.length} job postings`
        : `Reading ${jobs.length} job postings`;
  return (
    <div className="relative h-5">
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={text}
          className={cn(
            "absolute inset-0 flex items-center gap-1.5 text-[11px] font-semibold",
            phase === "rank" ? "text-brand" : "text-ink-meta",
          )}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
        >
          {phase === "rank" && <ArrowDownWideNarrow className="size-3.5" aria-hidden="true" />}
          {text}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

function JobCard({
  job,
  turn,
  phase,
  first,
}: {
  job: MatchJob;
  turn: number;
  phase: Phase;
  first: boolean;
}) {
  const p = PHASE_INDEX[phase];
  const scanAt = turn * SCAN_STEP;
  return (
    <motion.div
      layout="position"
      className={cn(
        "relative overflow-hidden rounded-xl bg-white px-2.5 py-2 shadow-[0_10px_24px_-16px_rgb(16_48_94/0.5)] ring-1 transition-shadow duration-500",
        first ? "ring-brand/50 ring-2" : "ring-slate-900/5",
      )}
      initial={{ opacity: 0, y: 10 }}
      // Once ranked, the weak fits step back.
      animate={{ opacity: p === 3 && job.score < 70 ? 0.55 : 1, y: 0 }}
      transition={{
        layout: { duration: 0.6, ease: GLIDE },
        default: { delay: turn * 0.1, duration: 0.35, ease: GLIDE },
      }}
    >
      <div className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white ring-1 ring-slate-900/5">
          <Image
            src={`https://www.google.com/s2/favicons?domain=${job.domain}&sz=64`}
            alt=""
            width={18}
            height={18}
            className="size-[18px] rounded-[4px]"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-ink block truncate text-[11px] font-semibold">{job.title}</span>
          <span className="text-ink-meta block text-[10px]">{job.company}</span>
        </span>
        {p >= 2 ? (
          <ScoreChip score={job.score} delay={p === 2 ? turn * 0.15 : 0} />
        ) : (
          <span className="h-5 w-10 shrink-0 rounded-md bg-slate-100" aria-hidden="true" />
        )}
      </div>
      <p className="text-ink-meta mt-1.5 truncate text-[10px]">
        <Snippet job={job} lit={p >= 1} delay={p === 1 ? scanAt + 0.35 : 0} />
      </p>

      {/* The scan: a soft band sweeps the card once, in turn. */}
      {p === 1 && (
        <motion.span
          aria-hidden="true"
          className="via-brand/20 pointer-events-none absolute inset-y-0 w-16 bg-linear-to-r from-transparent to-transparent"
          initial={{ left: "-20%", opacity: 1 }}
          animate={{ left: "110%", opacity: [1, 1, 0] }}
          transition={{ delay: scanAt, duration: 0.7, ease: "easeInOut" }}
        />
      )}
    </motion.div>
  );
}

/** A posting's line: the student's skills light up, the rest stay plain. */
function Snippet({ job, lit, delay }: { job: MatchJob; lit: boolean; delay: number }) {
  const pattern = new RegExp(
    `(${job.keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
  );
  return job.snippet.split(pattern).map((part, i) =>
    job.keywords.includes(part) && has(part) ? (
      <motion.mark
        key={i}
        className="text-brand-ink -mx-px rounded-[3px] px-px font-medium"
        initial={{ backgroundColor: "rgb(239 234 255 / 0)" }}
        animate={{ backgroundColor: lit ? "rgb(239 234 255 / 1)" : "rgb(239 234 255 / 0)" }}
        transition={{ delay, duration: 0.3 }}
      >
        {part}
      </motion.mark>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    ),
  );
}

/** A posting's match, counting up from nothing when it is scored. */
function ScoreChip({ score, delay }: { score: number; delay: number }) {
  const value = useMotionValue(0);
  const label = useTransform(value, (v) => `${Math.round(v)}%`);
  React.useEffect(() => {
    const controls = animate(value, score, { delay, duration: 0.8, ease: GLIDE });
    return () => controls.stop();
  }, [value, score, delay]);

  return (
    <motion.span
      className={cn(
        "shrink-0 rounded-md px-[7px] py-0.5 text-[11px] font-bold tabular-nums ring-1 ring-inset",
        scoreTone(score),
      )}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, type: "spring", stiffness: 420, damping: 24 }}
    >
      <motion.span>{label}</motion.span>
    </motion.span>
  );
}
