import { Calendar } from "lucide-react";
import { Marquee } from "./marquee";
import { stages, type Stage, type TrackedJob } from "./board-data";
import { cn } from "@/lib/cn";

/**
 * Tilted 3D board of WorkIt job cards, one auto-scrolling column per stage.
 * Pure CSS animation: render it without a client directive (no JS shipped).
 * It's decorative (cards repeat), so it's hidden from assistive tech; the
 * surrounding section's copy describes the feature.
 */
export default function ApplicationBoard() {
  return (
    <div
      aria-hidden="true"
      className="relative flex h-[28rem] w-full items-center justify-center overflow-hidden [perspective:650px] sm:h-[34rem] lg:h-[32rem]"
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
          <Marquee
            key={stage.id}
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
        ))}
      </div>

      {/* Fade the board into the page on every edge. */}
      <div className="from-background pointer-events-none absolute inset-x-0 top-0 h-1/4 bg-linear-to-b" />
      <div className="from-background pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-linear-to-t" />
      <div className="from-background pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-linear-to-r lg:w-1/8" />
      <div className="from-background pointer-events-none absolute inset-y-0 right-0 w-1/4 bg-linear-to-l lg:w-1/8" />
    </div>
  );
}

/** A WorkIt job card, matching the product's card layout. */
function JobCard({ job, stage }: { job: TrackedJob; stage: Stage }) {
  const Logo = job.logo;
  const StageIcon = stage.icon;
  const FooterIcon = stage.footerIcon;

  return (
    <div className="bg-card text-card-foreground border-border w-72 rounded-2xl border p-5 shadow-sm shadow-slate-900/5">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
          stage.chipClass,
        )}
      >
        <StageIcon className={cn("size-3", stage.iconClass)} />
        {stage.cardLabel}
      </span>

      <p className="text-ink mt-2.5 text-base font-semibold">{job.title}</p>
      <p className="text-ink-meta mt-1 text-xs/5">{job.note}</p>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg",
              job.logoTone,
            )}
          >
            <Logo className="size-4" />
          </span>
          <span className="text-ink-meta truncate text-xs">{job.company}</span>
        </div>
        <span className="border-border text-ink-meta flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
          <ScoreRing value={job.score} />
          {job.score}%
        </span>
      </div>

      <div className="bg-surface mt-3 flex gap-2.5 rounded-lg p-3">
        <Calendar className="text-ink-meta mt-0.5 size-3.5 shrink-0" />
        <div>
          <p className="text-ink text-xs font-semibold">Next: {job.next.label}</p>
          <p className="text-ink-meta mt-0.5 text-[11px]">{job.next.when}</p>
        </div>
      </div>

      <div className="border-border text-ink-meta mt-3 flex items-center gap-2 border-t pt-3 text-[11px]">
        <FooterIcon className="size-3.5 shrink-0" />
        {job.footer}
      </div>
    </div>
  );
}

function ScoreRing({ value }: { value: number }) {
  const radius = 5;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 14 14" className="size-3.5 -rotate-90">
      <circle
        cx="7"
        cy="7"
        r={radius}
        fill="none"
        strokeWidth="2.5"
        className="stroke-landing-brand-100"
      />
      <circle
        cx="7"
        cy="7"
        r={radius}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${(value / 100) * circumference} ${circumference}`}
        className="stroke-landing-brand-600"
      />
    </svg>
  );
}
