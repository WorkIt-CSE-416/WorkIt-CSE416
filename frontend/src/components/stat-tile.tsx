import type { ComponentType } from "react";

import { TrendIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export type StatDelta = {
  value: number;
  /** "last week" — printed after "vs". */
  period: string;
  /** Whether a rise is the good direction. More applicants: yes. More sitting
   *  unreviewed: no. Decides how the delta is coloured. */
  upIsGood: boolean;
};

/**
 * One headline number.
 *
 * Four current values are a KPI row, not a chart — a grouped bar of open roles
 * against interviews would invite a comparison between quantities that share no
 * unit. So each tile is a label and its glyph, the value, and a change against
 * a named period.
 *
 * PRESENTATION ONLY: it takes a resolved value, delta and glyph rather than a
 * fixture record. Each dashboard decides what its numbers are — the company's
 * Hiring Overview resolves one tile against the selected window
 * (company/stats-row.tsx), the seeker's Dashboard reads its own fixture — and
 * neither decision belongs to the thing drawing the box. Moved here from
 * company/ when the seeker Dashboard became its second consumer.
 *
 * The value uses the font's proportional figures rather than tabular ones.
 * tabular-nums gives every digit the width of a zero, which is what keeps a
 * column of numbers aligned in a table — at 28px in a tile it just makes a
 * number like 214 look gappy. Tabular figures are for columns; this is not one.
 *
 * ---------------------------------------------------------------------------
 * THE DELTA IS A PILL, AND THE PILL IS <Badge>, not a shape rebuilt here.
 * `variant="status"` is already the fully rounded tinted chip this wants, and
 * `positive` / `danger` are already the two tones. Hand-rolling a rounded span
 * with its own tint would be a fifth chip in a codebase that has four, and it
 * would drift from them the first time anyone retones a status.
 *
 * ONLY THE NUMBER GOES IN THE PILL. "vs last week" stays outside it in muted
 * ink, because the tint is what makes the pill mean something and a period
 * label has no direction to report. Four pills wide enough to hold a sentence
 * would also be the loudest thing in the row, above the figures they annotate.
 *
 * COLOUR IS DIRECTION x WHETHER UP IS GOOD, not direction alone. More
 * applicants arriving is good and reads positive; more sitting unreviewed is
 * not, and six more of them should not read as an achievement.
 *
 * ZERO IS ITS OWN CASE, and it took a one-day window to expose it. `value > 0
 * === upIsGood` sends a delta of exactly nothing down the not-good branch, so
 * picking Yesterday — 7 applications against the 7 before it — painted a red
 * pill and an arrow for a number that had not moved. No change is neither
 * good nor bad: it takes the inert tone, drops the arrow, and says so in
 * words rather than printing a signless 0 the reader has to interpret.
 *
 * WHAT CHANGED, AND WHY THE OLD REASONING NO LONGER HOLDS: the unhelpful
 * direction used to be drawn in plain muted ink, on the grounds that WorkIt had
 * no red and inventing one for this tile would put an undesigned colour on the
 * first screen a company sees. That was true when it was written. The palette
 * has since grown --color-danger and --color-danger-tint for the Rejected chip,
 * so `danger` here is not a new colour — it is the same pill the applicants
 * table already prints, saying the same thing. It is still marked UNMEASURED in
 * globals.css, which is a fair note against it; what makes it safe to use is
 * that it is now inconsistent NOT to.
 *
 * The arrow carries direction on its own either way, so neither reading depends
 * on colour.
 * ------------------------------------------------------------------------- */

export function StatTile({
  label,
  Icon,
  value,
  suffix = "",
  delta,
}: {
  label: string;
  /** Decoration beside the label; see the note on the glyph below. */
  Icon: ComponentType<{ className?: string }>;
  value: number;
  /** Printed after the value and its delta — "%" for a rate. */
  suffix?: string;
  delta?: StatDelta;
}) {
  return (
    <Card padding="md">
      {/* The glyph is decoration, not information: the label beside it already
          says what the number is, so it is aria-hidden and the row is not a
          heading with an image in it. items-start keeps a two-line label
          (Awaiting your review, at narrow widths) from dragging the glyph down
          with its second line. */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-note text-ink-meta">{label}</p>
        <Icon aria-hidden="true" className="text-ink-subtle size-4 shrink-0" />
      </div>

      <p className="text-display text-ink mt-1.5">
        {format(value)}
        {suffix}
      </p>

      {delta && (
        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {delta.value === 0 ? (
            <Badge variant="status" tone="inert">
              No change
            </Badge>
          ) : (
            <Badge
              variant="status"
              tone={isGood(delta.value, delta.upIsGood) ? "positive" : "danger"}
            >
              <TrendIcon className="mr-1 size-3 shrink-0" down={delta.value < 0} />
              {delta.value > 0 ? "+" : ""}
              {format(delta.value)}
              {suffix}
            </Badge>
          )}
          <span className="text-note text-ink-meta">vs {delta.period}</span>
        </p>
      )}
    </Card>
  );
}

function isGood(value: number, upIsGood: boolean) {
  return value > 0 === upIsGood;
}

function format(value: number) {
  const abs = Math.abs(value);
  if (abs < 10_000) return value.toLocaleString();

  return `${(value / 1000).toFixed(abs < 100_000 ? 1 : 0)}K`;
}
