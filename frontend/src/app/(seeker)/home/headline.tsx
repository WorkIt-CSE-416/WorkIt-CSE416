"use client";

import Link from "next/link";
import type { ComponentType } from "react";

import {
  BookmarkIcon,
  BriefcaseIcon,
  CalendarIcon,
  ArrowRightIcon,
  MatchIcon,
  TrendIcon,
} from "@/components/icons";
import { Skeleton } from "@/components/shadcn/skeleton";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format-count";

import { STAGE_COLOR } from "../stage-colors";
import type { HomeStat, StatKey } from "./data";
import { RANGES, type RangeKey } from "./range";
import { useRange } from "./range-switch";
import { SectionCard } from "./section-card";

/** Each tile's glyph, by what it counts: the data is plain, so the icons stay
 *  on this side of the server boundary. */
const STAT_ICONS: Record<StatKey, ComponentType<{ className?: string }>> = {
  strongMatches: MatchIcon,
  saved: BookmarkIcon,
  applied: BriefcaseIcon,
  interviewing: CalendarIcon,
};

/**
 * Each tile's colours (KAN-423), as the user picked them: Strong Matches
 * green, Saved grey, Applied violet, Interviewing yellow. `tint` is the
 * tile's ground, the pale tint each colour already has; `disc` the solid
 * disc behind its white glyph. Saved, Applied and Interviewing take their
 * stage's tint from ../stage-colors.ts, the Applications board's panels.
 * Strong Matches' disc is --color-positive-ink (5.35:1 under white; the
 * brighter --color-positive holds 2.8:1, under the 3:1 a glyph needs), and
 * Interviewing's is --color-warning-deep (4.92:1), more yellow than the
 * stage's own orange-leaning amber. On every tint the ink-meta note holds
 * 4.7:1 or better and the green or red change 4.5:1 or better. Magenta (the
 * match ramp), a burnt amber, solid fills and plain white tiles were tried
 * first and turned down.
 */
/** The tiles' order, for the skeleton: getHeadline's order in ./data.ts. */
const STAT_ORDER: StatKey[] = ["strongMatches", "saved", "applied", "interviewing"];

const STAT_TONE: Record<StatKey, { tint: string; disc: string }> = {
  strongMatches: { tint: "bg-positive-tint", disc: "bg-positive-ink" },
  saved: { tint: STAGE_COLOR.saved.tint, disc: STAGE_COLOR.saved.fill },
  applied: { tint: STAGE_COLOR.applied.tint, disc: STAGE_COLOR.applied.fill },
  interviewing: { tint: STAGE_COLOR.interviewing.tint, disc: "bg-warning-deep" },
};

/**
 * The headline numbers for the range in the URL, one tile each, four across
 * the top of Home. It is handed every range's figures and picks one
 * in the browser, so moving the range switch counts each figure to its new
 * value at once (AnimatedNumber) rather than after the server has drawn the
 * page again.
 *
 * Every tile is tinted with the pale shade of its own colour, and wears its
 * white glyph in a solid disc of that colour at the top right (KAN-423,
 * STAT_TONE), so the four stand apart at a glance without four loud
 * blocks. Strong Matches was the one filled tile, in violet, until then:
 * violet is Applied's stage colour, so the filled tile and the Applied
 * badges said two things in one colour.
 *
 * EVERY TILE IS A LINK (KAN-342): a click anywhere on a tile opens the page
 * that lists what it counts (the Applications list filtered to its stage,
 * or the Jobs page in Best Match order), its label the link stretched over
 * it. Under the pointer a tile lifts 2px onto --shadow-lift and its glyph
 * slides out of its disc as an arrow slides in, so the tile reads as
 * clickable; a press settles it. A lift
 * alone was too slight to say so. A keyboard focus rings the tile.
 *
 * Its own tile rather than components/stat-tile.tsx, which the company
 * Home keeps: this one sets the figure large at medium weight
 * (--text-figure) and the change as a small boxed figure before its words.
 */
export function Headline({ stats }: { stats: Record<RangeKey, HomeStat[]> }) {
  const range = useRange();
  const { period, note } = RANGES.find((option) => option.key === range)!;

  // A fragment, not a wrapper: each number is its own tile on the page's grid.
  return (
    <>
      {stats[range].map((stat) => {
        const Icon = STAT_ICONS[stat.key];
        const change =
          stat.value !== null && stat.previous !== null && period
            ? stat.value - stat.previous
            : null;

        return (
          <SectionCard
            key={stat.key}
            as="div"
            className={cn(
              "group/stat @container/stat flex flex-col",
              STAT_TONE[stat.key].tint,
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
                  "text-body text-ink font-medium",
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
                  "relative hidden size-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-white @[10.5rem]/stat:flex",
                  STAT_TONE[stat.key].disc,
                )}
              >
                {/* Under the pointer the glyph slides out to the right and
                    an arrow slides in after it: the tile says where it
                    goes. Clipped by the ring. */}
                <Icon
                  aria-hidden
                  className="ease-glide size-4 transition-[translate,opacity] duration-200 group-hover/stat:translate-x-5 group-hover/stat:opacity-0 motion-reduce:transition-none"
                />
                <ArrowRightIcon className="ease-glide absolute size-4 -translate-x-5 opacity-0 transition-[translate,opacity] duration-200 group-hover/stat:translate-x-0 group-hover/stat:opacity-100 motion-reduce:transition-none" />
              </span>
            </div>

            {/* Pushed to the foot: a label that wraps makes its tile taller,
                the row stretches the other three to match, and every figure
                in the row still sits on one line. */}
            <p className="text-figure text-ink mt-auto pt-3">
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
                "text-note animate-fade text-ink-meta mt-2 flex h-5 items-center gap-1.5",
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
                        change > 0
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

/**
 * The four numbers while they load (page.tsx streams them in their own
 * <Suspense>, and ./loading.tsx draws the page with these): each tile in
 * the real one's boxes, row for row, so the grid holds its height and
 * nothing under it moves when the figures land. The label row's 36px, the
 * figure's 12px of padding over its 40px line (--text-figure) and the
 * note's 20px line each hold a bar in place of the words, on the tile's own
 * tint, so the row reads as itself while it waits. A fragment, as Headline is: each tile is a cell of the page's
 * grid.
 *
 * A streamed tile mounts with its figure, and AnimatedNumber prints a first
 * value as it is, so nothing counts up from 0 when the numbers arrive.
 */
export function HeadlineSkeleton() {
  return (
    <>
      {STAT_ORDER.map((key) => (
        <SectionCard
          key={key}
          as="div"
          aria-hidden="true"
          className={cn("flex flex-col", STAT_TONE[key].tint)}
        >
          <div className="flex min-h-9 items-center">
            <Skeleton className="bg-panel h-4 w-24" />
          </div>
          <div className="mt-auto pt-3">
            <Skeleton className="bg-panel h-10 w-16" />
          </div>
          <div className="mt-2 flex h-5 items-center">
            <Skeleton className="bg-panel h-3 w-28" />
          </div>
        </SectionCard>
      ))}
    </>
  );
}
