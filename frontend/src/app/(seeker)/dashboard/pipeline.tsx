import Link from "next/link";
import type { ComponentType } from "react";

import {
  ArrowRightIcon,
  AwardIcon,
  BriefcaseIcon,
  CalendarIcon,
  MailIcon,
} from "@/components/icons";
import { cn } from "@/lib/cn";

import type { PipelineStage } from "./data";

/**
 * Applied, then how many of those heard back, interviewed, got an offer — as
 * a neutral grey band that sets this section apart from everything above it.
 *
 * WHY A BAND AND NOT ANOTHER CARD. The page is open sections on white, one
 * violet hero, and this: a grey panel holding four small white cards, each
 * with a coloured badge that breaks its top edge, and a violet "Full board"
 * tile closing the row. The change of surface is what tells the eye "this is
 * a different kind of thing" without a heading having to.
 *
 * EACH STAGE HAS ONE COLOUR, and the badge and the funnel both wear it:
 * brand violet for applying, the advanced blue for a reply, amber for the
 * interview (the expensive, nerve-racking step), green for an offer. The band
 * was lavender with a funnel in four shades of violet, which made the whole
 * section one purple and left the badges' colours meaning nothing below
 * them. The panel is neutral now so the stage colours carry it; only the Full
 * board tile keeps the brand, as the section's one action.
 *
 * The interview amber is --color-warning-fill, with an ink glyph: the text
 * amber renders brown at this size, and white on the bright one is 2.1:1.
 * The offer green is --color-positive-ink: a white glyph on the lighter
 * #17b076 is 2.8:1, under the 3:1 an icon needs; the deeper green is 5.4:1.
 *
 * THE FUNNEL runs under the cards across the same four columns, so each
 * segment sits beneath its stage: a band whose thickness is that stage's
 * share of Applied, in that stage's colour, easing into the next stage's
 * thickness and colour together across the last quarter of the column (a
 * gradient over the same span the curve takes), so it reads as one flow. A zero still draws a
 * hairline (MIN_SHARE), or a week with no offers would end the band in
 * mid-air. Plain SVG, stretched with preserveAspectRatio="none"; the numbers
 * are real text in the cards above it. Shown only once the cards sit four
 * across (@3xl/main): two across, its four columns would line up with
 * nothing, and the rates in the cards already tell the story.
 *
 * The rate under each later stage is from the stage before ("33% of applied
 * heard back"): a low first rate says the targeting or the resume needs
 * work, a low last one says interview practice does.
 */
const STAGE_STYLE: {
  Icon: ComponentType<{ className?: string }>;
  /** The badge's fill and glyph colour. */
  badge: string;
  /** The same colour for the funnel's SVG. */
  color: string;
}[] = [
  { Icon: BriefcaseIcon, badge: "bg-brand text-white", color: "var(--color-brand)" },
  { Icon: MailIcon, badge: "bg-advanced text-white", color: "var(--color-advanced)" },
  {
    Icon: CalendarIcon,
    badge: "bg-warning-fill text-ink",
    color: "var(--color-warning-fill)",
  },
  { Icon: AwardIcon, badge: "bg-positive-ink text-white", color: "var(--color-positive-ink)" },
];

const W = 100; // per column, in viewBox units
const H = 60;
const MIN_SHARE = 0.05;
const EASE = 0.25;

export function Pipeline({ stages, scope }: { stages: PipelineStage[]; scope: string }) {
  const first = stages[0]?.count || 1;
  const heights = stages.map((stage) => Math.max(stage.count / first, MIN_SHARE) * H);

  return (
    <section aria-labelledby="pipeline" className="bg-app rounded-[1.25rem] p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="pipeline" className="text-title text-ink">
            Your pipeline
          </h2>
          <p className="text-body text-ink-meta mt-1">How far your applications got, {scope}.</p>
        </div>
      </div>

      {/* Four stages and the tile; the funnel takes the row under the four. */}
      <div className="mt-9 grid grid-cols-2 gap-x-3 gap-y-9 @3xl/main:grid-cols-[repeat(4,minmax(0,1fr))_8.5rem] @3xl/main:gap-y-4">
        {stages.map((stage, i) => {
          const previous = stages[i - 1];
          const rate =
            previous && previous.count > 0
              ? Math.round((stage.count / previous.count) * 100)
              : null;
          const { Icon, badge } = STAGE_STYLE[i] ?? STAGE_STYLE[0];

          return (
            <div
              key={stage.label}
              className="bg-panel shadow-card relative rounded-2xl px-3 pt-7 pb-4 text-center"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "ring-app absolute -top-5 left-1/2 flex size-10 -translate-x-1/2 items-center justify-center rounded-full ring-4",
                  badge,
                )}
              >
                <Icon className="size-4" />
              </span>
              <p className="text-label text-ink font-semibold">{stage.label}</p>
              <p className="text-heading text-ink mt-1">{stage.count}</p>
              <p className="text-note text-ink-meta mt-0.5">
                {rate === null
                  ? i === 0
                    ? "Total sent"
                    : "—"
                  : `${rate}% of ${previous.label.toLowerCase()}`}
              </p>
            </div>
          );
        })}

        <Link
          href="/applications"
          className="bg-brand text-on-brand hover:bg-brand-hover focus-visible:ring-brand-ring shadow-card col-span-2 flex items-center justify-between gap-3 rounded-2xl p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none @3xl/main:col-span-1 @3xl/main:row-span-2 @3xl/main:flex-col @3xl/main:items-start"
        >
          <span className="text-subtitle">Full board</span>
          <span className="text-brand-ink flex size-9 items-center justify-center rounded-full bg-white">
            <ArrowRightIcon className="size-4" />
          </span>
        </Link>

        <svg
          viewBox={`0 0 ${W * stages.length} ${H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="hidden h-14 w-full @3xl/main:col-span-4 @3xl/main:block"
        >
          <defs>
            {heights.map((_, i) => {
              const x1 = i * W + W * (1 - EASE);
              const from = STAGE_STYLE[i]?.color ?? STAGE_STYLE[0].color;
              const to = STAGE_STYLE[i + 1]?.color ?? from;

              return (
                <linearGradient
                  key={i}
                  id={`pipeline-stage-${i}`}
                  gradientUnits="userSpaceOnUse"
                  x1={x1}
                  x2={i * W + W}
                  y1={0}
                  y2={0}
                >
                  <stop offset="0" style={{ stopColor: from }} />
                  <stop offset="1" style={{ stopColor: to }} />
                </linearGradient>
              );
            })}
          </defs>
          {heights.map((h, i) => {
            const next = heights[i + 1] ?? h;
            const x0 = i * W;
            const x1 = x0 + W * (1 - EASE);
            const x2 = x0 + W;
            const mid = (x1 + x2) / 2;
            const [top, bottom] = [(H - h) / 2, (H + h) / 2];
            const [nTop, nBottom] = [(H - next) / 2, (H + next) / 2];

            return (
              <path
                key={stages[i].label}
                d={[
                  `M${x0},${top}`,
                  `L${x1},${top}`,
                  `C${mid},${top} ${mid},${nTop} ${x2},${nTop}`,
                  `L${x2},${nBottom}`,
                  `C${mid},${nBottom} ${mid},${bottom} ${x1},${bottom}`,
                  `L${x0},${bottom}`,
                  "Z",
                ].join(" ")}
                fill={`url(#pipeline-stage-${i})`}
              />
            );
          })}
        </svg>
      </div>
    </section>
  );
}
