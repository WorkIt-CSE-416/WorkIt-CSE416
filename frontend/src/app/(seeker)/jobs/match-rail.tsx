import { cn } from "@/lib/cn";
import { matchColor, matchTier } from "@/lib/match";

import type { Highlight } from "./data";
import { CheckIcon } from "./icons";

/**
 * The scored rail down the right of a recommendation.
 *
 * WHY IT IS NOT DARK. The reference layout paints this panel near-black, which
 * is what makes the score the loudest thing on the row. WorkIt has no dark
 * surface role — `deep` exists only as a tint under a company glyph — so a
 * 200px black block would be the only dark thing in the signed-in app and would
 * read as an advert pinned to every card. The rail uses `--color-well`, the
 * recessed surface the profile dropzone already established, and earns its
 * prominence from the ring instead.
 *
 * The arc and the tier label now colour by band — green through red, from
 * `matchColor` in @/lib/match — rather than a single brand blue at every score.
 * See the note on `TIERS` there for why that reverses this file's own earlier
 * reasoning, and why it's a safe reversal even so. Length still carries the
 * magnitude and the label still carries the band; colour is a third, faster
 * read of the same two facts, not a replacement for either.
 *
 * `standalone` only changes the shape — a card with its own rounded corners
 * and border, rather than a rail flush against a bigger card's edge — not the
 * fill.
 */

/* 64px box, 5px stroke, so the arc's centreline sits 2.5px inside the edge. */
const RADIUS = (64 - 5) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function MatchRing({ score }: { score: number }) {
  const color = matchColor(score);

  return (
    <div className="relative size-16">
      {/* -rotate-90 starts the arc at twelve o'clock rather than three. */}
      <svg viewBox="0 0 64 64" aria-hidden="true" className="size-full -rotate-90">
        <circle
          cx="32"
          cy="32"
          r={RADIUS}
          fill="none"
          strokeWidth="5"
          className="stroke-border-strong"
        />
        <circle
          cx="32"
          cy="32"
          r={RADIUS}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${(CIRCUMFERENCE * score) / 100} ${CIRCUMFERENCE}`}
          style={{ stroke: color }}
        />
      </svg>

      <p className="absolute inset-0 flex items-center justify-center">
        <span className="flex items-baseline">
          <span className="text-title text-ink">{score}</span>
          <span className="text-meta text-ink-meta">%</span>
        </span>
      </p>
    </div>
  );
}

/** A caveat's marker. Sized like the check it replaces, so the text lines up. */
function Dot() {
  return (
    <span aria-hidden="true" className="flex size-3.5 shrink-0 items-center justify-center">
      <span className="bg-ink-faint size-1.5 rounded-full" />
    </span>
  );
}

export function MatchRail({
  score,
  highlights,
  standalone = false,
}: {
  score: number;
  highlights: Highlight[];
  /** A rounded card that floats on its own — the job detail page's layout,
   *  which sits it beside the facts rather than flush against a bigger
   *  card's edge. Default false keeps the recommendation feed's flush rail
   *  unchanged. */
  standalone?: boolean;
}) {
  return (
    <aside
      aria-label="Why this matches"
      className={cn(
        "bg-well border-border-subtle flex shrink-0 flex-col items-center gap-2 p-4 md:w-52",
        standalone ? "rounded-card border" : "border-t md:border-t-0 md:border-l",
      )}
    >
      <MatchRing score={score} />
      <p className="text-caption font-semibold uppercase" style={{ color: matchColor(score) }}>
        {matchTier(score)}
      </p>

      <ul className="border-border-subtle mt-1 flex w-full flex-col gap-1.5 border-t pt-3">
        {highlights.map((highlight) => (
          <li key={highlight.text} className="flex items-start gap-1.5">
            {/* The tick and the dot are the whole distinction on screen, so the
                same distinction is spelled out for anyone not seeing them. */}
            <span className="sr-only">{highlight.met ? "In your favour:" : "Worth weighing:"}</span>
            {highlight.met ? (
              <CheckIcon className="text-positive mt-px size-3.5 shrink-0" />
            ) : (
              <Dot />
            )}
            <span className={cn("text-meta", highlight.met ? "text-ink-muted" : "text-ink-faint")}>
              {highlight.text}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
