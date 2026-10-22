import type { CSSProperties, ReactNode } from "react";
import { Calendar } from "lucide-react";

import { cn } from "@/lib/cn";

import { stages, type Stage, type TrackedJob } from "./board-data";
import { FaviconLogo } from "./favicon-logo";
import { Marquee } from "./marquee";
import { scoreTone } from "./score-tone";

/**
 * Tilted 3D board of WorkIt job cards, one auto-scrolling column per stage.
 * Pure CSS animation: render it without a client directive (no JS shipped).
 * It's decorative (cards repeat), so it's hidden from assistive tech; the
 * surrounding section's copy describes the feature. The cards are frosted
 * glass (`.glass-card`) over soft blobs in the four stages' colours, so the
 * glass has colour to blur; nothing between the blobs and the cards may
 * fade, filter or mask, or the blur sees nothing (landing.css).
 *
 * In the pinned applications section (applications.tsx) the column of the
 * timeline's current stage (`active`) glows in its stage's colour, behind
 * the glass, so its cards take the colour; `children` draw over the board,
 * flat, where the followed application's card crosses it. Each column marks
 * its centre (`data-board-col`), so that card can find it.
 */
export default function ApplicationBoard({
  active = null,
  children,
}: {
  active?: number | null;
  children?: ReactNode;
}) {
  return (
    <div
      aria-hidden="true"
      data-board
      className="relative isolate flex h-[28rem] w-full items-center justify-center overflow-hidden rounded-[2rem] [perspective:650px] sm:h-[34rem] lg:h-[32rem]"
      style={{ background: BACKDROP }}
    >
      {/* Perspective and angles are tuned for 4 × w-72 columns at the site's
          content width; the original demo's 300px perspective suits an 800px box.
          From lg up the board shares its row with the section copy, so it shrinks
          (and shifts left, since the tilt enlarges the right side) to fit all
          four columns. */}
      <div
        className="flex flex-row items-center gap-4 lg:-translate-x-12 lg:scale-60"
        style={{
          transform:
            "translateX(-20px) translateZ(-60px) rotateX(22deg) rotateY(-12deg) rotateZ(18deg)",
        }}
      >
        {stages.map((stage, index) => (
          <div
            key={stage.id}
            data-lit={active === index || undefined}
            className="board-column relative"
            style={{ "--lit": stage.color } as CSSProperties}
          >
            {/* Lit while the timeline is on this stage: a glow behind the
                cards, which fades itself, never them, and an outline on
                each card (landing.css). */}
            <div
              className="absolute -inset-x-4 top-1/2 -z-10 h-[44rem] -translate-y-1/2 rounded-[3rem] blur-2xl transition-opacity duration-500 ease-out"
              style={{ background: stage.color, opacity: active === index ? 0.8 : 0 }}
            />
            <span data-board-col={index} className="absolute top-1/2 left-1/2" />
            <Marquee
              pauseOnHover
              reverse={index % 2 === 1}
              repeat={3}
              tabIndex={-1}
              className="[--duration:40s]"
            >
              {stage.jobs.map((job) => (
                <JobCard key={`${job.company}-${job.title}`} job={job} stage={stage} />
              ))}
            </Marquee>
          </div>
        ))}
      </div>

      {/* Soften the board's top and bottom into the panel. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-linear-to-b from-white/70" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-white/70" />
      {children}
    </div>
  );
}

/**
 * The panel behind the board: a blob per stage, in its timeline colour
 * (board-data.ts), over the violet tint.
 */
const BACKDROP = [
  "radial-gradient(40% 45% at 18% 22%, color-mix(in oklab, var(--color-brand) 34%, transparent), transparent)",
  "radial-gradient(38% 42% at 82% 18%, color-mix(in oklab, var(--color-warning-fill) 30%, transparent), transparent)",
  "radial-gradient(42% 46% at 78% 82%, color-mix(in oklab, var(--color-positive) 26%, transparent), transparent)",
  "radial-gradient(40% 44% at 22% 80%, color-mix(in oklab, var(--color-match-good) 22%, transparent), transparent)",
  "var(--color-brand-tint)",
].join(", ");

/** A WorkIt job card in frosted glass, after the product's card layout. */
function JobCard({ job, stage }: { job: TrackedJob; stage: Stage }) {
  const StageIcon = stage.icon;
  const FooterIcon = stage.footerIcon;

  return (
    <div className="glass-card text-ink w-72 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
            stage.chipClass,
          )}
        >
          <StageIcon className={cn("size-3", stage.iconClass)} />
          {stage.cardLabel}
        </span>
        <span
          className={cn(
            "shrink-0 rounded-md px-[7px] py-0.5 text-[11px] font-bold shadow-[inset_0_1px_0_rgb(255_255_255/0.8)] ring-1 ring-inset",
            scoreTone(job.score),
          )}
        >
          {job.score}%
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2.5">
        <FaviconLogo domain={job.domain} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm/5 font-semibold text-balance">{job.title}</span>
          <span className="text-ink-meta block text-xs">{job.company}</span>
        </span>
      </div>

      <div className="mt-3 flex gap-2.5 rounded-xl bg-white/55 p-3 ring-1 ring-white/70 ring-inset">
        <Calendar className="text-ink-meta mt-0.5 size-3.5 shrink-0" />
        <div>
          <p className="text-xs font-semibold">Next: {job.next.label}</p>
          <p className="text-ink-meta mt-0.5 text-[11px]">{job.next.when}</p>
        </div>
      </div>

      <div className="text-ink-meta mt-3 flex items-center gap-2 border-t border-white/70 pt-3 text-[11px]">
        <FooterIcon className="size-3.5 shrink-0" />
        {job.footer}
      </div>
    </div>
  );
}
