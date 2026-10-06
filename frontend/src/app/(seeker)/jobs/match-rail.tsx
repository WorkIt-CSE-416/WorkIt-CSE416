import { CheckIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { matchColor, matchTier } from "@/lib/match";

import type { Highlight } from "./data";

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
 * The arc and the dot before the tier label colour by band, light to deep
 * magenta, from `matchColor` in @/lib/match, rather than one brand colour at
 * every score: the brand is the Applied stage's colour, so a violet ring read
 * as a status. See the note on `TIERS` there. Length still carries the
 * magnitude and the label still carries the band; colour is a third, faster
 * read of the same two facts, not a replacement for either.
 *
 * The label's words are ink-muted, not the band colour. Painted in the old
 * green, yellow and red bands, three of the four measured 1.79 to 3.51:1 on
 * the well, so the one-word verdict a seeker reads before applying was the
 * hardest thing on the rail to read. The magenta ramp is drawn for strokes
 * (its lightest step is 3.22:1 on the well, short of the 4.5:1 a label
 * needs), so the dot keeps the colour and the words keep the contrast.
 *
 * Caveats sit in ink-meta, a step quieter than the wins in ink-muted but still
 * clear of AA: the tick and the dot already tell the two kinds apart, so fading
 * the reasons to hesitate further would only say they do not matter.
 *
 * WITH NO SCORE (`score` null) IT IS A PLACEHOLDER, not absent. Nothing
 * scores a live role yet, but the feed card keeps the rail so it has the
 * shape it will have once matching exists: the ring's empty track with a
 * dash in it, "Score Coming Soon" where the tier goes, and three grey bars
 * where the reasons go. A screen reader hears that the score is not
 * available yet rather than a dash. Not a made-up number: a fake 87% on a
 * real role would read as a real verdict.
 *
 * `standalone` only changes the shape — a card with its own rounded corners
 * and border, rather than a rail flush against a bigger card's edge — not the
 * fill.
 *
 * Its width and edge switch at `@xl`, so it needs an `@container` ancestor:
 * `JobDetailHeader`'s card is one, and stacks the rail under the facts below
 * 576px of card, not at a window breakpoint that cannot see the shell's panel.
 */

/* 64px box, 5px stroke, so the arc's centreline sits 2.5px inside the edge. */
const RADIUS = (64 - 5) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function MatchRing({ score }: { score: number | null }) {
  const color = score === null ? undefined : matchColor(score);

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
        {score !== null && (
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
        )}
      </svg>

      <p className="absolute inset-0 flex items-center justify-center">
        {score === null ? (
          <span aria-hidden="true" className="text-title text-ink-subtle">
            –
          </span>
        ) : (
          <span className="flex items-baseline">
            <span className="text-title text-ink">{score}</span>
            <span className="text-meta text-ink-meta">%</span>
          </span>
        )}
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
  /** Null draws the placeholder rail; see "WITH NO SCORE" above. */
  score: number | null;
  highlights: Highlight[];
  /** A rounded card that floats on its own — the job detail page's layout,
   *  which sits it beside the facts rather than flush against a bigger
   *  card's edge. Default false keeps the recommendation feed's flush rail
   *  unchanged. */
  standalone?: boolean;
}) {
  return (
    <aside
      aria-label="Why This Matches"
      className={cn(
        "bg-well border-border-subtle flex shrink-0 flex-col items-center gap-2 p-4 @xl:w-52",
        standalone ? "rounded-card border" : "border-t @xl:border-t-0 @xl:border-l",
      )}
    >
      <MatchRing score={score} />
      {score === null ? (
        <>
          <p className="text-caption text-ink-meta flex items-center gap-1.5 font-semibold uppercase">
            <span aria-hidden="true" className="bg-border-strong size-2 rounded-full" />
            Score Coming Soon
          </p>
          <p className="sr-only">
            This role has no match score yet. Reasons it fits you will show here once matching is
            built.
          </p>
          {/* Where the reasons will go: a caveat's dot and a bar per row, at
              the rows' own 15px rhythm. */}
          <ul
            aria-hidden="true"
            className="border-border-subtle mt-1 flex w-full flex-col gap-1.5 border-t pt-3"
          >
            {["w-full", "w-4/5", "w-11/12"].map((width) => (
              <li key={width} className="flex h-[15px] items-center gap-1.5">
                <Dot />
                <span className={cn("bg-border-strong h-2 rounded-full", width)} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-caption text-ink-muted flex items-center gap-1.5 font-semibold uppercase">
          <span
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{ background: matchColor(score) }}
          />
          {matchTier(score)}
        </p>
      )}

      {score !== null && (
        <ul className="border-border-subtle mt-1 flex w-full flex-col gap-1.5 border-t pt-3">
          {highlights.map((highlight) => (
            <li key={highlight.text} className="flex items-start gap-1.5">
              {/* The tick and the dot are the whole distinction on screen, so the
                same distinction is spelled out for anyone not seeing them. */}
              <span className="sr-only">
                {highlight.met ? "In your favour:" : "Worth weighing:"}
              </span>
              {highlight.met ? (
                <CheckIcon className="text-positive mt-px size-3.5 shrink-0" />
              ) : (
                <Dot />
              )}
              <span className={cn("text-meta", highlight.met ? "text-ink-muted" : "text-ink-meta")}>
                {highlight.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
