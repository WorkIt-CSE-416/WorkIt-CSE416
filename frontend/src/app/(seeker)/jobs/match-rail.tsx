import { cn } from "@/lib/cn";

import { matchTier, type Highlight } from "./data";
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
 * prominence from the ring instead. Swapping the two classes on the <aside>
 * below for `bg-ink text-on-brand` is the whole change if a designer disagrees.
 *
 * The arc is brand at every score. Colouring it by band was the obvious
 * alternative and it is the wrong one twice over: green would collide with the
 * board, where green means an offer and nothing else, and a red-to-green scale
 * would tell someone a 68% job is a bad job when it is only a lower-ranked one.
 * Length carries the magnitude; the label carries the band.
 */

/* 64px box, 5px stroke, so the arc's centreline sits 2.5px inside the edge. */
const RADIUS = (64 - 5) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function MatchRing({ score }: { score: number }) {
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
          className="stroke-brand"
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

export function MatchRail({ score, highlights }: { score: number; highlights: Highlight[] }) {
  return (
    <aside
      aria-label="Why this matches"
      className="bg-well border-border-subtle flex shrink-0 flex-col items-center gap-2 border-t p-4 md:w-52 md:border-t-0 md:border-l"
    >
      <MatchRing score={score} />
      <p className="text-caption text-ink-meta uppercase">{matchTier(score)}</p>

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
