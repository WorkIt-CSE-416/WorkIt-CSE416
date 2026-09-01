import { cn } from "@/lib/cn";

import type { Stage } from "./data";

/**
 * The pill the shadcn kanban card carries: a small ring, then the percentage.
 *
 * A ring rather than the bar the grid and list draw, because a card in a column
 * has no width to spare — and because the design puts it inline with the
 * company, where a bar would have to compete for the same row.
 *
 * The arc starts at twelve o'clock, which is what the rotation is for: SVG
 * circles begin at three. Stroke colour is the stage's own accent, so the ring
 * agrees with the bar the other two views draw for the same application.
 *
 * Decorative: the percentage is right beside it in text.
 */
const STROKE = {
  pale: "stroke-brand-pale",
  brand: "stroke-brand",
  positive: "stroke-positive",
} as const;

const RADIUS = 5.4;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ProgressRing({ value, accent }: { value: number; accent: Stage["accent"] }) {
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
          strokeDashoffset={CIRCUMFERENCE * (1 - value / 100)}
          transform="rotate(-90 7 7)"
          className={cn(STROKE[accent])}
        />
      </svg>
      {value}%
    </span>
  );
}
