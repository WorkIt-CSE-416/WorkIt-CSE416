import { Card } from "@/components/ui/card";

import type { Stat } from "./data";
import { TrendIcon } from "./icons";

/**
 * One headline number.
 *
 * Four current values are a KPI row, not a chart — a grouped bar of open roles
 * against interviews would invite a comparison between quantities that share no
 * unit. So each tile is label, value, and a change against a named period.
 *
 * The value uses the font's proportional figures rather than tabular ones.
 * tabular-nums gives every digit the width of a zero, which is what keeps a
 * column of numbers aligned in a table — at 28px in a tile it just makes a
 * number like 214 look gappy. Tabular figures are for columns; this is not one.
 *
 * DELTA COLOUR IS DIRECTION x WHETHER UP IS GOOD, not direction alone. More
 * applicants arriving is good and green; more sitting unreviewed is not, and
 * six more of them should not read as an achievement. The unhelpful direction
 * is drawn in muted ink rather than a red, because WorkIt has no red — see the
 * OPEN note on --destructive in globals.css. Inventing one here would put a
 * colour nobody designed on the first screen a company sees. The arrow carries
 * direction on its own either way, so the tile never depends on colour alone.
 */
export function StatTile({ label, value, delta }: Stat) {
  return (
    <Card padding="md">
      <p className="text-note text-ink-meta">{label}</p>
      <p className="text-display text-ink mt-1.5">{format(value)}</p>

      {delta && (
        <p
          className={`text-meta mt-1.5 flex items-center gap-1 ${
            isGood(delta.value, delta.upIsGood) ? "text-positive" : "text-ink-meta"
          }`}
        >
          <TrendIcon className="size-3.5 shrink-0" down={delta.value < 0} />
          <span>
            {delta.value > 0 ? "+" : ""}
            {format(delta.value)} vs {delta.period}
          </span>
        </p>
      )}
    </Card>
  );
}

/** A rise is good only when rising is the direction you wanted. */
function isGood(value: number, upIsGood: boolean) {
  return value > 0 === upIsGood;
}

/** Compact above five figures, so a tile never wraps its own number. */
function format(value: number) {
  const abs = Math.abs(value);
  if (abs < 10_000) return value.toLocaleString();

  return `${(value / 1000).toFixed(abs < 100_000 ? 1 : 0)}K`;
}
