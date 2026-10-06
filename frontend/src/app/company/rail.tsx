import { TrendIcon } from "@/components/icons";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";

import { ACTIVE_APPLICATIONS, HIGHLIGHTS, STAGE_REACH } from "./data";

/**
 * The column beside the trend chart.
 *
 * It exists because a full-width area chart wastes its right half: ninety days
 * of a single series needs height to be readable and not width, so the space
 * goes to the second-most-important thing on the screen instead of to more
 * pixels per day.
 *
 * Open on the page, like the chart beside it, and built the way the seeker
 * Dashboard's Waiting to hear back is: a heading, the headline number, a line
 * saying what it counts, then rows on hairlines straight under it. Pinning the
 * rows to the chart's baseline instead opened a gap in the middle of the
 * column that read as something missing; whitespace under an open section
 * reads as nothing.
 *
 * A HERO FIGURE AND THREE ROWS OF TEXT, NO MARKS. Every value here is one
 * current number, which the form heuristic answers with a figure rather than a
 * chart — three sparklines in a column this narrow would be three illegible
 * charts competing with the readable one beside them. `text-display` is the
 * stat tiles' token, one step down from the page heading, so the figure reads
 * as the biggest number in its column and not as a second <h1>.
 */
export function Rail() {
  return (
    <section aria-labelledby="highlights">
      <SectionHeading id="highlights">Highlights</SectionHeading>
      <p className="text-body text-ink-meta mt-1">Across your open roles, right now.</p>

      <p className="mt-4 flex items-baseline gap-2">
        <span className="text-display text-ink">{ACTIVE_APPLICATIONS.toLocaleString()}</span>
        <span className="text-body text-ink-meta">active applications</span>
      </p>
      {/* Says what the number excludes, because "active" could just as easily
          be read as everyone who ever applied, which is a different number
          (271, the ring's total in the band below). */}
      <p className="text-note text-ink-meta mt-0.5">
        Still in play, of{" "}
        <span className="text-ink font-semibold">{STAGE_REACH[0].count.toLocaleString()}</span>{" "}
        received.
      </p>

      <ul className="mt-4 flex flex-col">
        {HIGHLIGHTS.map(({ label, value, direction, upIsGood }) => {
          const good = (direction === "up") === upIsGood;

          return (
            <li
              key={label}
              className="border-border-subtle flex items-center justify-between gap-3 border-b py-3 last:border-b-0 last:pb-0"
            >
              <span className="text-note text-ink-muted">{label}</span>

              <span className="flex shrink-0 items-center gap-2">
                {/* The plain stat tiles' marker, so a direction reads the
                    same here as in the row above: colour is direction crossed
                    with whether up is the direction you wanted, so a falling
                    time-to-hire is drawn positive. The unhelpful direction is
                    the tiles' danger red, which the palette has had since the
                    Rejected chip. The arrow carries direction on its own, so
                    neither reading depends on colour. */}
                {direction && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full text-white",
                      good ? "bg-positive-ink" : "bg-danger",
                    )}
                  >
                    <TrendIcon className="size-3" down={direction === "down"} />
                  </span>
                )}
                <span className="text-label text-ink tabular-nums">{value}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
