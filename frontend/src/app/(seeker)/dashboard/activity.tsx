"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/shadcn/chart";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";

import type { ActivityPoint } from "./data";

/**
 * Applications sent over the window: days this week, weeks over a month or
 * the season. Bars, not the company's area chart: a student sends a handful a
 * week, and at that count each send is a thing that happened rather than a
 * point on a continuous flow — and a zero day is a gap, not a dip.
 *
 * THE GOAL LINE is the habit the Dashboard is for. Five a week is a steady,
 * reachable pace through a recruiting season, and a dashed line at it turns
 * every bar into "made it" or "short" without a word. It is drawn only over
 * weekly bars; a weekly goal over daily bars would read as five a day.
 *
 * Brand for the series, for the reason the company trend gives: --chart-1 is
 * the one slot that clears 3:1 against a white card on its own.
 */
const config = {
  count: { label: "Applications", color: "var(--color-chart-1)" },
} satisfies ChartConfig;

export function Activity({ points, goal }: { points: ActivityPoint[]; goal: number | null }) {
  const total = points.reduce((sum, point) => sum + point.count, 0);
  const hit = goal === null ? 0 : points.filter((point) => point.count >= goal).length;

  return (
    <Card padding="md" className="flex flex-col">
      <SectionHeading as="h3">Activity</SectionHeading>
      <p className="text-note text-ink-meta mt-1">
        {total} {total === 1 ? "application" : "applications"} sent
        {goal !== null && (
          <>
            {" "}
            · goal of {goal} a week met {hit} of {points.length} weeks
          </>
        )}
        .
      </p>

      <ChartContainer config={config} className="mt-4 aspect-auto h-52 w-full">
        <BarChart data={points} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} className="stroke-border-subtle" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={8} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={24} />
          <ChartTooltip cursor={{ fill: "var(--color-well)" }} content={<ChartTooltipContent />} />
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
          <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ChartContainer>
    </Card>
  );
}
