import type { Stage } from "./data";

/**
 * Counts per stage across every open posting.
 *
 * A bar chart, drawn in HTML rather than SVG because it is four horizontal
 * bars on a shared baseline and nothing here needs an axis system.
 *
 * WHAT THE MARKS FOLLOW: bars are capped well under the row height so the
 * band's leftover stays air rather than ink; each is square where it meets the
 * baseline and rounded at the data end, so the end a reader measures to is the
 * end that is shaped; and there is no track behind them. A track would make
 * this a meter — a ratio against a limit — and there is no limit here, only
 * counts against each other.
 *
 * WHY EVERY BAR IS THE SAME HUE: length already carries the count. Stepping the
 * colour light-to-dark across the stages would encode the same fact twice, and
 * WorkIt has no sequential scale to step through — see the note in ./data.ts.
 *
 * WHY THE CONVERSION IS PRINTED RATHER THAN HOVERED: the share reaching each
 * stage is the thing this chart is actually for, and a tooltip would put it
 * behind a mouse — unreachable by keyboard, invisible in a screenshot, gone on
 * touch. Every value is on the page, so the chart needs no interaction to be
 * read. The counts are direct-labelled for the same reason: there is no axis,
 * so an unlabelled bar would be unreadable rather than merely uncluttered.
 */
export function Pipeline({ stages }: { stages: Stage[] }) {
  /* The widest stage sets the scale. Bars are proportional to the top of the
   * funnel, not to whichever stage happens to be largest, so the shape stays
   * honest if an intake ever exceeds a later stage. */
  const widest = Math.max(...stages.map((s) => s.count), 1);

  return (
    <ul className="flex flex-col gap-3.5">
      {stages.map(({ name, count }, i) => {
        const share = Math.round((count / widest) * 100);

        return (
          <li key={name}>
            <div className="text-note flex items-baseline justify-between gap-3">
              <span className="text-ink">{name}</span>
              <span className="text-ink-meta tabular-nums">
                {count.toLocaleString()}
                {/* The first stage is the denominator, so "100% of applied"
                    would be noise rather than information. */}
                {i > 0 && <span className="text-ink-faint"> · {share}% of applied</span>}
              </span>
            </div>

            <div className="mt-1.5 h-2.5">
              <div
                className="bg-brand h-full rounded-r-[4px]"
                style={{ width: `${Math.max(share, 1)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
