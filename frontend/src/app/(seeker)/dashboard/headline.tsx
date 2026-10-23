"use client";

import Link from "next/link";
import type { ComponentType } from "react";

import {
  BookmarkIcon,
  BriefcaseIcon,
  CalendarIcon,
  ArrowRightIcon,
  SparkleIcon,
  TrendIcon,
} from "@/components/icons";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format-count";

import type { DashboardStat, StatKey } from "./data";
import { RANGES, type RangeKey } from "./range";
import { useRange } from "./range-switch";
import { SectionCard } from "./section-card";

/** Each tile's glyph, by what it counts: the data is plain, so the icons stay
 *  on this side of the server boundary. */
const STAT_ICONS: Record<StatKey, ComponentType<{ className?: string }>> = {
  applications: BriefcaseIcon,
  goodMatches: SparkleIcon,
  interviews: CalendarIcon,
  saved: BookmarkIcon,
};

/**
 * The headline numbers for the range in the URL, one tile each, four across
 * the top of the Dashboard. It is handed every range's figures and picks one
 * in the browser, so moving the range switch counts each figure to its new
 * value at once (AnimatedNumber) rather than after the server has drawn the
 * page again.
 *
 * Applications is filled violet, the row's one solid colour, and the other
 * three are white. Each wears its glyph in a ring at the top right.
 *
 * EVERY TILE IS A LINK (KAN-342): a click anywhere on a tile opens the page
 * that lists what it counts (the Applications list filtered to its stage,
 * or the Jobs page in Best Match order), its label the link stretched over
 * it. Under the pointer a tile lifts 2px onto --shadow-lift, its ring fills
 * violet (white on the violet tile), and its glyph slides out as an arrow
 * slides in, so the tile reads as clickable; a press settles it. A lift
 * alone was too slight to say so. A keyboard focus rings the tile.
 *
 * Its own tile rather than components/stat-tile.tsx, which the company
 * Dashboard keeps: this one sets the figure large at medium weight
 * (--text-figure) and the change as a small boxed figure before its words.
 */
export function Headline({ stats }: { stats: Record<RangeKey, DashboardStat[]> }) {
  const range = useRange();
  const { period, note } = RANGES.find((option) => option.key === range)!;

  // A fragment, not a wrapper: each number is its own tile on the page's grid.
  return (
    <>
      {stats[range].map((stat) => {
        const Icon = STAT_ICONS[stat.key];
        const brand = stat.key === "applications";
        const change =
          stat.value !== null && stat.previous !== null && period
            ? stat.value - stat.previous
            : null;
        const labelClass = cn("text-body font-medium", brand ? "text-on-brand" : "text-ink");

        return (
          <SectionCard
            key={stat.key}
            as="div"
            tone={brand ? "brand" : "plain"}
            className={cn(
              "group/stat @container/stat flex flex-col",
              // Lifts 2px onto --shadow-lift under the pointer and settles
              // on the press, as a whole-target card does (docs/motion.md).
              "ease-glide hover:shadow-lift transition-[translate,scale,box-shadow] duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] active:duration-150",
              "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
              "has-[a:focus-visible]:ring-brand-ring has-[a:focus-visible]:ring-2",
            )}
          >
            {/* The label centred on its 36px ring, and the row 36px tall
                even where the ring is hidden, so a figure sits at the same
                height in every tile. */}
            <div className="flex min-h-9 items-center justify-between gap-3">
              <Link
                href={stat.href}
                className={cn(
                  labelClass,
                  // The overlay sits over the figure too, which is layered (its
                  // count animates), so a click anywhere on the tile lands.
                  "after:absolute after:inset-0 after:z-10 focus-visible:outline-none",
                )}
              >
                {stat.label}
              </Link>
              <span
                aria-hidden="true"
                className={cn(
                  // Only where the tile has room beside its label: in the
                  // narrowest four-column layout a long label wrapped and
                  // dropped its figure below the other three.
                  "relative hidden size-9 shrink-0 items-center justify-center overflow-hidden rounded-full @[10.5rem]/stat:flex",
                  "ease-glide transition-colors duration-200",
                  brand
                    ? "text-brand bg-white"
                    : "text-ink border-border-subtle group-hover/stat:border-brand group-hover/stat:bg-brand group-hover/stat:text-on-brand border",
                )}
              >
                {/* Under the pointer the glyph slides out to the right and
                    an arrow slides in after it: the tile says where it
                    goes. Clipped by the ring. */}
                <Icon className="ease-glide size-4 transition-[translate,opacity] duration-200 group-hover/stat:translate-x-5 group-hover/stat:opacity-0 motion-reduce:transition-none" />
                <ArrowRightIcon className="ease-glide absolute size-4 -translate-x-5 opacity-0 transition-[translate,opacity] duration-200 group-hover/stat:translate-x-0 group-hover/stat:opacity-100 motion-reduce:transition-none" />
              </span>
            </div>

            {/* Pushed to the foot: a label that wraps makes its tile taller,
                the row stretches the other three to match, and every figure
                in the row still sits on one line. */}
            <p className={cn("text-figure mt-auto pt-3", brand ? "text-on-brand" : "text-ink")}>
              {stat.value === null ? (
                "–"
              ) : (
                <>
                  <AnimatedNumber value={stat.value} />
                  {stat.suffix}
                </>
              )}
            </p>

            {/* Always one line, a non-breaking space at worst, so the four
                tiles keep one height whatever the range has to compare. */}
            <p
              key={`${range} ${change}`}
              className={cn(
                // h-5 whether it holds the boxed change or plain words, so
                // the box does not lift its tile's figure 2px above the rest.
                "text-note animate-fade mt-2 flex h-5 items-center gap-1.5",
                brand ? "text-white/80" : "text-ink-meta",
              )}
            >
              {change === null ? (
                (stat.note ?? (stat.value === null ? "Couldn't load" : note) ?? " ")
              ) : (
                <>
                  {change !== 0 && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-0.5 rounded-md border px-1 font-semibold tabular-nums",
                        brand
                          ? "border-white/40 text-white"
                          : change > 0
                            ? "border-positive/40 text-positive-ink"
                            : "border-danger/40 text-danger",
                      )}
                    >
                      {change > 0 ? "+" : "−"}
                      {formatCount(Math.abs(change))}
                      {stat.suffix}
                      <TrendIcon className="size-3" down={change < 0} />
                    </span>
                  )}
                  {change === 0 ? (
                    `Same as ${period}`
                  ) : (
                    // Beside the box only where the tile has room for both:
                    // on a phone "vs last week" wrapped under it and lifted
                    // the figure above its row. The range switch says which
                    // week either way.
                    <span className="hidden whitespace-nowrap @[8.5rem]/stat:inline">
                      vs {period}
                    </span>
                  )}
                </>
              )}
            </p>
          </SectionCard>
        );
      })}
    </>
  );
}
