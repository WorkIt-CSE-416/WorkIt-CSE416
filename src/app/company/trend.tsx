"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/shadcn/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/shadcn/toggle-group";
import { SectionHeading } from "@/components/ui/section-heading";

import type { DayCount } from "./data";
import { formatRange, matchPreset, rangeLength, TOGGLE_PRESETS, useRange } from "./range";

/**
 * Applications over time, with the window under the reader's control.
 *
 * THE ONLY CHART HERE THAT EARNS RECHARTS. The other two are bars on a shared
 * baseline and are drawn in HTML — see ./status-by-role.tsx for why that is usually
 * the cheaper answer. This one needs a time axis whose ticks thin out as the
 * window widens, a crosshair that finds the nearest point, and a container that
 * re-scales on resize. That is an axis system, and hand-rolling one is how you
 * end up with a worse version of this library.
 *
 * SINGLE SERIES, SO NO LEGEND. A legend for one line is a box that repeats the
 * card's own title. The window's total and its busiest bucket are printed in
 * the header instead, which is the same reason the HTML bars direct-label: a
 * value that exists only inside a tooltip is unreachable by keyboard, invisible
 * in a screenshot and gone on touch.
 *
 * WHY BRAND AND NOT A STAGE COLOUR: this counts arrivals, and an arrival has no
 * stage yet. --chart-1 is the brand slot, which is also the only slot that
 * clears 3:1 against a white card on its own — see the contrast WARN recorded
 * in globals.css. A single-series area is where that matters most, because a
 * 2px line has no interior for a label to sit in.
 */
const config = {
  count: { label: "Applications", color: "var(--color-chart-1)" },
} satisfies ChartConfig;

/**
 * Past a month, the chart plots weeks rather than days.
 *
 * WHY, and it is the difference between a chart and a texture. People apply
 * from work, so a daily series carries a hard weekly sawtooth — five up, two
 * down, ninety times. Over a week that rhythm is the most useful thing on the
 * screen: it is why Sunday is a trough and nothing is wrong. Over a quarter it
 * is thirteen repetitions of a fact you learned from the first one, drawn loudly
 * enough to bury the trend underneath it. Every dashboard that plots ninety
 * daily points hits this, and most of them ship it.
 *
 * BUCKETED FROM THE END, so the most recent week is a whole week. Counting
 * forward from the oldest day would leave the newest bucket short and draw the
 * current week as a collapse that is really just a Tuesday. The cost is that
 * the OLDEST bucket can be short instead — 90 days is twelve weeks and six days
 * — which lands the shortfall on the quietest, least-consulted end of the
 * chart. Every day still falls in exactly one bucket, so the total the header
 * prints is the total the series holds either way.
 */
function toWeeks(daily: DayCount[]): DayCount[] {
  const weeks: DayCount[] = [];

  for (let end = daily.length; end > 0; end -= 7) {
    const week = daily.slice(Math.max(0, end - 7), end);

    weeks.push({
      date: week[0].date,
      count: week.reduce((sum, day) => sum + day.count, 0),
    });
  }

  return weeks.reverse();
}

/** Days is the unit up to a month; past that the sawtooth wins and it is weeks. */
const WEEKLY_ABOVE = 30;

/** Roughly how many x-axis labels fit across this card before they touch.
 *  Measured against the widest tick the formatter produces ("Aug 27"). */
const TICK_TARGET = 7;

/**
 * Axis ticks, formatted for the window rather than for the data.
 *
 * A week wants weekday names — "Mon" says more than "Aug 31" about why Sunday
 * is a trough. Anything wider wants a month and a day.
 *
 * Both date options below are doing real work, for the reasons `formatDate` in
 * ./table.tsx records: `timeZone: "UTC"` keeps a date-only string from being
 * pushed back a day for any viewer west of Greenwich, and the explicit `en-US`
 * keeps the server and the browser from formatting differently and tripping a
 * hydration mismatch.
 */
function tick(iso: string, days: number) {
  return new Date(iso).toLocaleDateString(
    "en-US",
    days <= 7
      ? { weekday: "short", timeZone: "UTC" }
      : { month: "short", day: "numeric", timeZone: "UTC" },
  );
}

/** The date a point sits on. A weekday is worth printing for a single day and
 *  is meaningless for a bucket of seven, which all start on the same one. */
function pointDate(iso: string, weekly: boolean) {
  return new Date(iso).toLocaleDateString("en-US", {
    ...(weekly ? {} : { weekday: "short" as const }),
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The tooltip's heading — the axis only had room for part of this. */
function pointLabel(iso: string, weekly: boolean) {
  return weekly ? `Week of ${pointDate(iso, true)}` : pointDate(iso, false);
}

/** The same point, mid-sentence in the card's subtitle, where it needs a
 *  preposition and no capital. */
function pointPhrase(iso: string, weekly: boolean) {
  return weekly ? `in the week of ${pointDate(iso, true)}` : `on ${pointDate(iso, false)}`;
}

export function Trend() {
  /* THE WINDOW IS THE PAGE'S, NOT THIS CARD'S. It used to be local state here,
   * which made the toggle below the only thing that knew what period the chart
   * covered. Once the header could set a window too, two controls owned one
   * fact — so both now write the same state and the toggle is a shortcut
   * rather than a rival. See the note in ./range.tsx. */
  const { range, days: daily, setRange } = useRange();

  const active = matchPreset(range, TOGGLE_PRESETS);
  const span = rangeLength(range);

  /* Named `visible` rather than the obvious `window`, which would shadow the
   * global inside a "use client" component — a name that resolves to an array
   * here and to the browser everywhere else in the file is a trap for whoever
   * adds a resize listener next. */
  const weekly = span > WEEKLY_ABOVE;
  const visible = weekly ? toWeeks(daily) : daily;

  /* Totalled from the daily series, not the buckets, so the number is the same
   * either side of the granularity switch. They agree by construction today;
   * reading it from the source means they cannot stop agreeing. */
  const total = daily.reduce((sum, day) => sum + day.count, 0);
  const busiest = visible.reduce(
    (max, point) => (point.count > max.count ? point : max),
    visible[0] ?? { date: range.from, count: 0 },
  );

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionHeading as="h2">Applications</SectionHeading>
          <p className="text-note text-ink-meta mt-1">
            {total.toLocaleString()} over {formatRange(range)}
            {busiest.count > 0 && (
              <>
                , peaking at {busiest.count} {pointPhrase(busiest.date, weekly)}
              </>
            )}
            .
          </p>
        </div>

        {/* Base UI's ToggleGroup gives this arrow-key navigation and one tab
            stop, which a row of buttons would not.

            `value` is an array, and an EMPTY one is meaningful here rather than
            a state to guard against: a window picked from the calendar matches
            no preset, and pressing nothing is the honest rendering of that.
            Pressing the pressed item also empties it, which would otherwise
            silently un-scope the page — hence the guard in the handler. */}
        <ToggleGroup
          value={active ? [active.label] : []}
          onValueChange={([next]) => {
            const preset = TOGGLE_PRESETS.find((p) => p.label === next);
            if (preset) setRange(preset.range);
          }}
          aria-label="Time range"
          spacing={0}
          className="border-border-subtle bg-well rounded-control shrink-0 border p-0.5"
        >
          {TOGGLE_PRESETS.map((preset) => (
            <ToggleGroupItem
              key={preset.label}
              value={preset.label}
              size="sm"
              /* The chip is abbreviated; the accessible name is not. */
              aria-label={preset.label}
              className="text-note text-ink-meta hover:text-ink aria-pressed:bg-panel aria-pressed:text-ink rounded-[6px] px-2.5 aria-pressed:shadow-sm"
            >
              {preset.short}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* h-56 rather than the container's own aspect-video: the card beside
          this one is a fixed stack of rows, and an aspect-ratio chart grows
          with the column width until the two are wildly different heights. */}
      <ChartContainer config={config} className="mt-4 aspect-auto h-56 w-full">
        {/* right:26 is not padding, it is room for half of the last tick.
            Recharts centres a tick label on its point and then clips whatever
            crosses the SVG edge, so the newest week rendered as "Aug 2" with
            its own digits cut off — the one label on the axis a reader is most
            likely to want. */}
        <AreaChart data={visible} margin={{ left: 0, right: 26, top: 8, bottom: 0 }}>
          <defs>
            {/* A fill under the line, not a second encoding — it fades out so
                the area reads as one region rather than as a stacked band. */}
            <linearGradient id="applications-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-count)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--color-count)" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          {/* Horizontal only. Vertical rules on a time axis fence the data into
              columns it does not have — the series is continuous. */}
          <CartesianGrid vertical={false} className="stroke-border-subtle" />

          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            minTickGap={24}
            /* THINNED FROM THE POINT COUNT, not from the span, because the
               range is now arbitrary — a calendar can hand this anything from
               one day to thirteen weeks, and a rule written per preset went
               wrong the moment 30 days and 90 days both landed on "every
               other" (fifteen daily ticks, which collide, and seven weekly
               ones, which do not). Aiming at TICK_TARGET labels holds for any
               length. Recharts does drop overlapping ticks itself, but only
               after laying them out, which leaves an uneven gap — asking for
               fewer up front is steadier. */
            interval={Math.max(0, Math.ceil(visible.length / TICK_TARGET) - 1)}
            tickFormatter={(iso: string) => tick(iso, span)}
          />

          <YAxis
            width={28}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            /* Three ticks. The y scale is here to give the line a magnitude,
               not to be read off precisely — that is what the tooltip and the
               header total are for. */
            tickCount={3}
          />

          <ChartTooltip
            cursor={{ className: "stroke-border-strong" }}
            content={
              <ChartTooltipContent
                className="bg-panel border-border-subtle"
                labelFormatter={(_, payload) =>
                  pointLabel(String(payload?.[0]?.payload?.date), weekly)
                }
              />
            }
          />

          <Area
            dataKey="count"
            type="monotone"
            stroke="var(--color-count)"
            strokeWidth={2}
            fill="url(#applications-fill)"
            /* Recharts multiplies its own 0.6 default into whatever the fill
               resolves to, which would take the gradient's 22% top stop down to
               13% and leave the area a rumour. The gradient already carries the
               opacity this wants, so it is the only thing that should decide it. */
            fillOpacity={1}
            /* NO ENTRY ANIMATION, and it is not only a taste call. Recharts
               reveals an area by widening a clip rect from zero, so until the
               animation has run the chart is not faint — it is absent. That
               makes the first read of the data wait on a 1.5s reveal that
               replays on every navigation back to this screen, ignores
               prefers-reduced-motion, and leaves the clip rect at width="0" in
               any headless capture, so a screenshot of this card shows empty
               axes. A dashboard should be readable the instant it paints. */
            isAnimationActive={false}
            /* A dot per point is noise at thirteen weeks and unreadable at
               thirty days, so normally there are none — just one on hover,
               sized past the 8px floor so it is a target and not merely a
               highlight.

               THE EXCEPTION IS A WINDOW OF ONE OR TWO DAYS, which Today,
               Yesterday and This Month can all produce. An area needs width to
               be visible at all: at a single point the fill has none and the
               stroke has nowhere to run, so the card renders axes over an empty
               plot and looks broken rather than sparse. A dot is the mark a
               one-point series actually has. */
            dot={visible.length <= 2 ? { r: 3.5 } : false}
            activeDot={{ r: 4, strokeWidth: 2, className: "stroke-panel" }}
          />
        </AreaChart>
      </ChartContainer>
    </>
  );
}
