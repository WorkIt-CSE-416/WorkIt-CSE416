"use client";

import { Send, Target } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/shadcn/chart";
import { Badge } from "@/components/ui/badge";

import type { ActivityPoint } from "./data";

/**
 * Applications sent over the window: days this week, weeks over a month or
 * the season. Open on the page, under its heading, rather than in a card.
 *
 * A smooth line over a soft fill rather than bars: the question is the pace
 * — is it holding — which a line answers in its slope, and the curve keeps a
 * week with a quiet Tuesday from reading as a broken chart. A dot marks each
 * point, so a reader can still count individual weeks.
 *
 * THE GOAL LINE is the habit the Dashboard is for. Five a week is a steady,
 * reachable pace through a recruiting season, and a dashed line at it turns
 * every point into "made it" or "short" without a word. Drawn only over
 * weekly points; a weekly goal over daily ones would read as five a day.
 *
 * Brand for the series: --chart-1 is the one slot that clears 3:1 against
 * white on its own, which a 2px line needs.
 */
const config = {
  count: { label: "Applications", color: "var(--color-chart-1)" },
} satisfies ChartConfig;

export function Activity({ points, goal }: { points: ActivityPoint[]; goal: number | null }) {
  const total = points.reduce((sum, point) => sum + point.count, 0);
  const hit = goal === null ? 0 : points.filter((point) => point.count >= goal).length;

  return (
    <section aria-labelledby="activity">
      <h2 id="activity" className="text-title text-ink">
        Activity
      </h2>
      {/* Two chips, not a sentence: the total, and the goal coloured by how
          it went — green when the goal was hit in at least half the weeks,
          amber when it wasn't. The colour is the verdict a reader would
          otherwise have to work out from "met 2 of 4 weeks"; the words stay
          in the chip so nothing depends on the colour alone. */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge variant="tag" tone="brand" pill>
          <Send aria-hidden="true" className="mr-1.5 size-3.5" />
          <span>
            <span className="font-semibold">{total}</span> sent
          </span>
        </Badge>
        {goal !== null && (
          <Badge variant="tag" tone={hit * 2 >= points.length ? "positive" : "warning"} pill>
            <Target aria-hidden="true" className="mr-1.5 size-3.5" />
            <span>
              <span className="font-semibold">
                {hit}/{points.length}
              </span>{" "}
              weeks at goal
            </span>
          </Badge>
        )}
      </div>
      {/* The chart is drawn for the eye; this line is what a screen reader
          gets instead. Recharts' accessibilityLayer made the svg an unnamed
          role="application" tab stop with no visible focus, so it is off. */}
      <p className="sr-only">
        {total} applications sent in this range
        {goal !== null ? `, ${hit} of ${points.length} weeks at goal` : ""}.
      </p>

      <ChartContainer config={config} className="mt-4 aspect-auto h-56 w-full">
        <AreaChart
          accessibilityLayer={false}
          data={points}
          margin={{ left: 0, right: 12, top: 12, bottom: 0 }}
        >
          <defs>
            <linearGradient id="activity-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-count)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--color-count)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} className="stroke-border-subtle" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={8} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={24} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          {goal !== null && (
            <ReferenceLine
              y={goal}
              stroke="var(--color-ink-meta)"
              strokeDasharray="4 4"
              label={{
                value: `Goal ${goal}`,
                position: "insideTopRight",
                fill: "var(--color-ink-meta)",
                fontSize: 11,
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="count"
            stroke="var(--color-count)"
            strokeWidth={2.5}
            fill="url(#activity-fill)"
            dot={{ r: 3, fill: "var(--color-panel)", strokeWidth: 2 }}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      </ChartContainer>
    </section>
  );
}
