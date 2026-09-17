import { matchColor, matchTier } from "@/lib/match";

/**
 * A card's match score as a pill: a small ring, then the percentage.
 *
 * The small version of the Jobs screen's match rail, coloured by the same bands
 * through `matchColor`, so a score reads the same on both screens. It used to
 * show the stage's progress in the stage's accent, which put one number on
 * every card in a column; the grid and list still draw that progress as a bar.
 *
 * A ring rather than a bar because a card in a column has no width to spare,
 * and the design puts it inline with the company, where a bar would have to
 * compete for the same row. The arc starts at twelve o'clock, which is what the
 * rotation is for: SVG circles begin at three.
 *
 * The ring is decorative. The band its colour stands for is spelled out for a
 * screen reader after the number.
 */
const RADIUS = 5.4;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function MatchBadge({ score }: { score: number }) {
  return (
    <span className="border-border-subtle text-meta text-ink-meta inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5">
      <svg viewBox="0 0 14 14" aria-hidden="true" className="size-3.5">
        <circle
          cx="7"
          cy="7"
          r={RADIUS}
          fill="none"
          strokeWidth="1.7"
          className="stroke-border-strong"
        />
        <circle
          cx="7"
          cy="7"
          r={RADIUS}
          fill="none"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - score / 100)}
          transform="rotate(-90 7 7)"
          style={{ stroke: matchColor(score) }}
        />
      </svg>
      {score}%<span className="sr-only">, {matchTier(score)}</span>
    </span>
  );
}
