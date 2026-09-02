"use client";

import { Cell, Pie, PieChart } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/shadcn/chart";
import { cn } from "@/lib/cn";

import { STAGE_REACH, STAGE_PAINT, STAGE_TOTALS } from "./data";

/**
 * Every application as one ring: which stage all 271 of them are sitting in.
 *
 * ---------------------------------------------------------------------------
 * WHY A RING CAN BE HONEST HERE, WHEN IT USUALLY IS NOT
 *
 * A pie asserts that its wedges are parts of one whole. That is what makes it
 * the wrong chart for a funnel: STAGE_REACH is CUMULATIVE — 271 applied, 68 of
 * them reached screening, 23 of those an interview — so anyone mid-process is
 * counted in three stages at once. Drawing those four numbers as wedges would
 * total 368 across 271 applications and give every wedge a share of a
 * denominator that does not exist.
 *
 * STAGE_TOTALS is the same set cut so that it does sum: one applicant, one
 * current stage, five disjoint counts totalling 271. That is a genuine
 * part-to-whole, and it is the only version of this data a ring can carry
 * without lying about it.
 *
 * The conversion rates the funnel was for are not thrown away — they are the
 * line under the legend, where three percentages cost three phrases instead of
 * a second chart. A ring cannot show them, because "25% of applicants reach
 * screening" is a statement about a cohort over time, not about a share of
 * today's total.
 *
 * WHAT KEEPS IT READABLE, since a five-wedge donut is usually decoration:
 *
 *   - The centre carries the total, so the denominator every wedge is a share
 *     of is printed rather than inferred.
 *   - The legend carries a count AND a percentage per stage, so no value is
 *     hover-only. That is what the palette's contrast WARN in globals.css
 *     obligates: --color-chart-3 and --chart-5 sit under 3:1 on a white card,
 *     and relief means visible labels, not a tooltip.
 *   - Wedges are separated by a 2px gap in the surface colour, so two adjacent
 *     fills read as two shapes rather than one with a colour change in it.
 *   - Five is the cap. Fold a sixth stage into the tail rather than seating a
 *     wedge nobody can pick out of a ring — see the note in globals.css about
 *     why there is no fifth hue.
 *
 * The reference layout's donut did none of that: five grey wedges, no legend,
 * no labels, and a centre reading "186 Visitors" under a card titled Project
 * Efficiency. The form was not the problem there.
 * ------------------------------------------------------------------------- */

const config: ChartConfig = {
  count: { label: "Applicants" },
  ...Object.fromEntries(
    STAGE_TOTALS.map(({ stage }) => [stage, { label: stage, color: STAGE_PAINT[stage].color }]),
  ),
};

const total = STAGE_TOTALS.reduce((sum, { count }) => sum + count, 0);

/**
 * Conversion, as the funnel used to draw it.
 *
 * Read from STAGE_REACH rather than STAGE_TOTALS on purpose: reaching a stage is
 * the cumulative question, and the disjoint counts in the ring cannot answer
 * it. The first stage is the denominator, so it is skipped — "100% of applied"
 * is not information.
 */
const conversions = STAGE_REACH.slice(1).map(({ name, count }) => ({
  name,
  share: Math.round((count / STAGE_REACH[0].count) * 100),
}));

export function StatusRing() {
  return (
    /* h-full and a column, so the card's stretched height is this component's
     * to spend: the footnote takes mt-auto and settles on the card's bottom
     * edge instead of leaving a gap under itself. */
    <div className="flex h-full flex-col">
      {/* THE CENTRE IS HTML OVER THE CHART, NOT AN SVG <Label>.
          recharts 3 does not render a <Label> passed as a child of <Pie> — it
          emits no node at all, which is a silent failure rather than a broken
          one. Overlaying it is the better answer regardless: the figure gets
          the real --text-display token with its weight and tracking instead of
          an SVG text node that ignores both, and a screen reader reads it as
          ordinary text rather than as a graphic's label.

          pointer-events-none so the overlay cannot swallow the hover the
          wedges underneath it need. */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-display text-ink">{total.toLocaleString()}</p>
          <p className="text-meta text-ink-meta">applications</p>
        </div>

        {/* mx-auto and a fixed height rather than an aspect ratio: this card is
            the narrow half of its band, and an aspect-video ring would grow and
            shrink with the column while the legend under it stayed put. */}
        <ChartContainer config={config} className="mx-auto aspect-auto h-44 w-full">
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent className="bg-panel border-border-subtle" hideLabel />}
            />

            <Pie
              data={STAGE_TOTALS}
              dataKey="count"
              nameKey="stage"
              /* A ring and not a full pie. The hole is what makes room for the
               total, and it also drops the wedge tips — the part of a pie that
               is hardest to compare and carries the least area. */
              innerRadius={52}
              outerRadius={78}
              /* The 2px surface gap the marks spec asks for, spent as an angular
               gap plus a stroke in the card's own colour so the separation
               holds at the inner edge as well as the outer. */
              paddingAngle={2}
              stroke="var(--color-panel)"
              strokeWidth={2}
              /* Twelve o'clock, clockwise, so the wedges run in funnel order from
               the top the way a reader scans them. Recharts starts at three
               o'clock and runs anticlockwise by default. */
              startAngle={90}
              endAngle={-270}
              /* Same reasoning as ./trend.tsx: recharts reveals a pie by
               animating its radius from zero, which leaves an empty card until
               the animation runs and an empty card in any headless capture. */
              isAnimationActive={false}
            >
              {STAGE_TOTALS.map(({ stage }) => (
                <Cell key={stage} fill={STAGE_PAINT[stage].color} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
      </div>

      {/* The legend is the chart's labels, not a key to it: every wedge's count
          and share are here, in wedge order, so the ring needs no interaction
          to be read. */}
      <ul className="mt-3 mb-3 flex flex-col">
        {STAGE_TOTALS.map(({ stage, count }) => (
          <li
            key={stage}
            className="border-border-subtle flex items-center gap-2 border-b py-1.5 last:border-b-0"
          >
            <span
              aria-hidden="true"
              className={cn("size-2.5 shrink-0 rounded-[3px]", STAGE_PAINT[stage].fill)}
            />
            <span className="text-note text-ink-muted flex-1 truncate">{stage}</span>
            <span className="text-note text-ink shrink-0 tabular-nums">{count}</span>
            <span className="text-meta text-ink-faint w-9 shrink-0 text-right tabular-nums">
              {Math.round((count / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>

      {/* What the funnel was for. Three phrases rather than a second chart —
          these are conversions against a cohort, a different question from the
          shares above, and putting them in the ring would conflate the two. */}
      <p className="text-meta text-ink-meta border-border-subtle mt-auto border-t pt-3">
        Of everyone who applied,{" "}
        {conversions.map(({ name, share }, i) => (
          <span key={name}>
            {i > 0 && (i === conversions.length - 1 ? " and " : ", ")}
            <span className="text-ink-muted tabular-nums">{share}%</span> reached{" "}
            {name.toLowerCase()}
          </span>
        ))}
        .
      </p>
    </div>
  );
}
