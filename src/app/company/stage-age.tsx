import { cn } from "@/lib/cn";

import { STAGE_AGE, STAGE_PAINT } from "./data";

/**
 * How long people are waiting, per stage.
 *
 * THE CHART FORM OF "NEEDS YOUR ATTENTION". That card names three specific
 * things a recruiter can clear today; this says whether the delay is one bad
 * week or the shape of the process. Both are on the screen because a list of
 * three items cannot show that interviews take twice as long as screens, and a
 * chart of four medians cannot tell you whose feedback is missing.
 *
 * TWO NUMBERS PER ROW, and the second one is the point. A median alone hides
 * the applicant who has been sitting in a screen for a fortnight; a maximum
 * alone makes every stage look broken. So the bar is the median and the notch
 * past it is the oldest, on one shared scale — the gap between them is how
 * unevenly a stage is being worked, which is a thing you can only see by
 * drawing both.
 *
 * The notch is a shape rather than a second fill: it is a 2px rule in the same
 * hue at full strength, which reads as a marker on the bar rather than as
 * another segment of it. Encoding it as colour would make a reader ask which
 * stage the second colour meant.
 *
 * COLOURED BY STAGE, matching the ring and the stacked bars, because these four
 * rows are the same four stages the stacked chart beside them colours — a
 * reader moving between the two cards should not have to relearn which row is
 * Interview. The bars carry no magnitude comparison that the colour could
 * duplicate, since every value is printed.
 */

/* One shared scale across all four rows, set by the worst wait rather than by
 * each row's own maximum. Per-row scaling would draw a 4-day offer queue and a
 * 21-day interview queue as the same length, which is the one thing this chart
 * must not do. */
const scale = Math.max(...STAGE_AGE.map((s) => s.oldestDays));

export function StageAge() {
  return (
    <ul className="flex h-full flex-1 flex-col justify-between gap-3.5">
      {STAGE_AGE.map(({ stage, medianDays, oldestDays }) => (
        <li key={stage}>
          <div className="text-note flex items-baseline justify-between gap-3">
            <span className="text-ink">{stage}</span>
            <span className="text-ink-meta tabular-nums">
              {medianDays}d median
              <span className="text-ink-faint"> · {oldestDays}d oldest</span>
            </span>
          </div>

          {/* No track behind the bar. A track would make this a meter — a
              ratio against a limit — and there is no limit here, only waits
              measured against each other. Same reasoning as ./status-by-role.tsx. */}
          <div className="relative mt-1.5 h-2.5">
            <span
              className={cn("absolute inset-y-0 left-0 rounded-r-[3px]", STAGE_PAINT[stage].fill)}
              style={{ width: `${(medianDays / scale) * 100}%` }}
            />

            {/* Sits at the oldest wait on the same scale, and is pulled back by
                its own width so the rule marks the value rather than starting
                at it. */}
            <span
              aria-hidden="true"
              /* Taller than the bar it marks, so it reads as a tick against
                 the scale rather than as a sliver of another segment. */
              className={cn(
                "absolute -inset-y-[3px] -ml-[2px] w-[2px] rounded-full",
                STAGE_PAINT[stage].fill,
              )}
              style={{ left: `${(oldestDays / scale) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
