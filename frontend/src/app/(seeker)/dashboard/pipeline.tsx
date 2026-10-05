import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";

import type { PipelineStage } from "./data";

/**
 * Applied, then how many of those heard back, interviewed, got an offer — the
 * seeker's version of the company's Application Status, drawn as a funnel
 * because each stage is a subset of the one before it. A ring would show the
 * same four numbers as parts of a whole, which they are not.
 *
 * THE BAND. Each stage is a column; under its figures runs a band whose
 * thickness is that stage's share of Applied, easing into the next column's
 * thickness across the last quarter of the column so the drop between stages
 * reads as flow rather than as four separate bars. Each segment deepens a step
 * in violet, so the eye lands on the end of the funnel. A stage of zero still
 * draws a hairline (MIN_SHARE), or a week with no offers would end the band
 * in mid-air.
 *
 * Plain SVG rather than Recharts: there is no axis, tooltip or scale to share,
 * only four paths, and preserveAspectRatio="none" stretches them to the card
 * at any width while the figures above stay real text.
 *
 * The conversion under each later stage is from the stage before ("33% of
 * applied heard back"), which is the number a student can act on: a low
 * Applied → Heard back rate says the targeting or the resume needs work; a
 * low Interviewed → Offer rate says interview practice does.
 */
const W = 100; // per column, in viewBox units
const H = 80;
const MIN_SHARE = 0.04;
const EASE = 0.25; // the share of a column spent easing into the next one
const SHADES = [0.28, 0.5, 0.75, 1];

export function Pipeline({ stages }: { stages: PipelineStage[] }) {
  const first = stages[0]?.count || 1;
  const heights = stages.map((stage) => Math.max(stage.count / first, MIN_SHARE) * H);

  return (
    <Card padding="md">
      <SectionHeading as="h2">Your pipeline</SectionHeading>
      <p className="text-note text-ink-meta mt-1">
        How far your applications get, and where they drop off.
      </p>

      <div className="mt-4">
        <dl className="grid grid-cols-4">
          {stages.map((stage, i) => {
            const previous = stages[i - 1];
            const rate =
              previous && previous.count > 0
                ? Math.round((stage.count / previous.count) * 100)
                : null;

            return (
              <div
                key={stage.label}
                className="border-border-subtle flex flex-col gap-1 border-l px-2 first:border-l-0 first:pl-0 @xl/main:px-3"
              >
                <dt className="text-note text-ink-meta">{stage.label}</dt>
                <dd className="text-title text-ink">{stage.count}</dd>
                <dd className="text-note text-ink-meta">
                  {/* "of heard back" only where a quarter of the card can
                      hold it: on a phone it stacked the rate three lines
                      tall, and the stage name above already says it. */}
                  {rate === null ? (
                    i === 0 ? (
                      "Total sent"
                    ) : (
                      "—"
                    )
                  ) : (
                    <>
                      {rate}%
                      <span className="hidden @xl/main:inline">
                        {" "}
                        of {previous.label.toLowerCase()}
                      </span>
                    </>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>

        <svg
          viewBox={`0 0 ${W * stages.length} ${H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="mt-3 h-24 w-full"
        >
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
                className="fill-brand"
                fillOpacity={SHADES[i] ?? 1}
              />
            );
          })}
        </svg>
      </div>
    </Card>
  );
}
