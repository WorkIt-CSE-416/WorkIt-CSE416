import { cn } from "@/lib/cn";

import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";

import { HIGHLIGHTS, ACTIVE_APPLICATIONS, STAGE_REACH } from "./data";
import { TrendIcon } from "./icons";

/**
 * The column beside the trend chart.
 *
 * It exists because a full-width area chart wastes its right half: ninety days
 * of a single series needs height to be readable and not width, so the space
 * goes to the second-most-important thing on the screen instead of to more
 * pixels per day.
 *
 * A HERO FIGURE AND THREE ROWS OF TEXT, NO MARKS. Every value here is one
 * current number, which the form heuristic answers with a figure rather than a
 * chart — three sparklines in a column this narrow would be three illegible
 * charts competing with the readable one beside them. `text-display` is the
 * same token ./stat-tile.tsx uses, one step down from the page heading, so the
 * rail reads as the biggest number in its own card and not as a second <h1>.
 */
export function Rail() {
  return (
    <Card padding="md" className="flex h-full flex-col">
      <div>
        <p className="text-note text-ink-meta">Active applications</p>
        <p className="text-display text-ink mt-1.5">{ACTIVE_APPLICATIONS.toLocaleString()}</p>
        {/* Says what the number excludes, because "active" could just as easily
            be read as everyone who ever applied — which is a different number,
            271, sitting in the card below this one. */}
        <p className="text-meta text-ink-meta mt-1.5">
          Still in play, of {STAGE_REACH[0].count.toLocaleString()} received.
        </p>
      </div>

      <SectionHeading as="h2" className="text-subtitle mt-5">
        Highlights
      </SectionHeading>

      <ul className="mt-2 flex flex-1 flex-col justify-between">
        {HIGHLIGHTS.map(({ label, value, direction, upIsGood }) => (
          <li
            key={label}
            className="border-border-subtle flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0 last:pb-0"
          >
            <span className="text-note text-ink-muted">{label}</span>

            <span className="flex shrink-0 items-center gap-1.5">
              {/* Same rule as a stat tile's delta: the colour is direction
                  crossed with whether up is the direction you wanted, not
                  direction alone. A falling time-to-hire is the good kind of
                  fall and is drawn positive; the unhelpful direction stays in
                  muted ink rather than a red, because WorkIt has no red that a
                  designer has signed off on. The arrow carries direction on its
                  own, so neither reading depends on colour. */}
              {direction && (
                <TrendIcon
                  className={cn(
                    "size-3.5",
                    (direction === "up") === upIsGood ? "text-positive" : "text-ink-meta",
                  )}
                  down={direction === "down"}
                />
              )}
              <span className="text-label text-ink">{value}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
