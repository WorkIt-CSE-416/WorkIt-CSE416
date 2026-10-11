import { cn } from "@/lib/cn";

import { WAITING, type WaitBucket } from "./data";
import { SectionHeader } from "./section-header";
import { SectionCard } from "./section-card";

/**
 * Applications with no reply yet, by how long they have waited — the seeker's
 * "Time in stage". A tile like the Dashboard's others: the total first, then
 * one column per verdict, oldest on the right.
 *
 * COLUMNS, NOT A RING. The buckets are ordered and the question is how much
 * of the pile is old, which a row of heights answers in one look. It was a
 * half-ring gauge for a while (KAN-173), and a ring split three ways never
 * drew cleanly: its round-capped parts left grey slivers of track between
 * them and past both ends. Columns stand apart on their own, with nothing to
 * line up.
 *
 * THREE COLUMNS, ONE PER COLOUR. Each column has its count on top and its
 * verdict and age under it, so nothing rests on colour and no legend is
 * needed; under the pointer it lifts and its count gives way to a tooltip
 * naming the bucket. There were four, with under a week and one to two weeks
 * apart, and two green columns side by side read as a mistake. Columns are 24px wide with 4px rounded tops, square on
 * the baseline, and grow from it as the page arrives.
 *
 * THE COLOUR IS A TRAFFIC LIGHT, because that is the question: is this fine,
 * should I act, or is it gone. Green under two weeks (a normal wait), amber
 * from fifteen to thirty days (when a short follow-up note helps), red past
 * thirty (probably a silent no). It was brand purple shading into a dark
 * amber and red, which read as a palette rather than as a verdict — purple
 * says "brand", not "fine", and the text amber reads brown as a bar. Green
 * and amber are under 3:1 on white, which the counts and labels on every
 * column make up for.
 */
const TONE: Record<WaitBucket["tone"], { fill: string; verdict: string }> = {
  fresh: { fill: "bg-positive", verdict: "On track" },
  due: { fill: "bg-warning-fill", verdict: "Follow up" },
  stale: { fill: "bg-danger", verdict: "Likely closed" },
};

export function Waiting({ className }: { className?: string }) {
  const total = WAITING.reduce((sum, bucket) => sum + bucket.count, 0);
  const due = WAITING.filter((bucket) => bucket.tone !== "fresh").reduce(
    (sum, bucket) => sum + bucket.count,
    0,
  );
  const max = Math.max(...WAITING.map((bucket) => bucket.count), 1);

  return (
    <SectionCard aria-labelledby="waiting" className={cn("flex flex-col", className)}>
      <SectionHeader
        id="waiting"
        title="Waiting"
        link={
          due > 0
            ? {
                // The list, filtered to what has been sent and is still
                // waiting: the applications a follow-up is for.
                href: "/applications?view=list&stage=applied",
                text: "Follow Up",
                label: "Follow Up on Applications",
              }
            : undefined
        }
      />

      {/* How many, then how many are worth a nudge: the reason to act. */}
      <p className="mt-3 flex items-baseline gap-2">
        <span className="text-figure text-ink">{total}</span>
        <span className="text-body text-ink-meta">no reply yet</span>
      </p>
      <p className="text-note text-ink-meta mt-0.5">
        {due > 0 ? (
          <>
            <span className="text-ink font-semibold">{due}</span> over two weeks, worth a follow-up
          </>
        ) : (
          "All under two weeks"
        )}
      </p>

      {/* The chart sits in the middle of whatever height the row gives the
          tile: beside Activity it is taller than the chart is. */}
      <div className="flex flex-1 flex-col justify-center pt-5">
        <ul
          aria-label="Applications by how long they have waited"
          className="border-border-subtle grid h-36 grid-cols-3 border-b"
        >
          {WAITING.map((bucket, i) => (
            // The whole slot is the hover target, wider than the 24px mark.
            <li
              key={bucket.label}
              className="group/col flex h-full flex-col items-center justify-end"
            >
              <span className="sr-only">
                {bucket.count} {TONE[bucket.tone].verdict}, waiting {bucket.label.toLowerCase()}
              </span>
              {/* The count rides the column's top; under the pointer it gives
                  way to the tooltip in the same place, which adds the bucket. */}
              <span aria-hidden="true" className="relative">
                <span className="text-label text-ink font-semibold transition-opacity duration-150 group-hover/col:opacity-0">
                  {bucket.count}
                </span>
                <span className="bg-ink text-note pointer-events-none absolute bottom-0 left-1/2 z-10 -translate-x-1/2 rounded-md px-2 py-1 whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/col:opacity-100">
                  <strong className="font-semibold">{bucket.count}</strong>
                  <span className="opacity-75"> · {bucket.label}</span>
                </span>
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "animate-draw-y mt-1.5 w-6 origin-bottom rounded-t-[4px] transition-[filter] duration-150 group-hover/col:brightness-110",
                  TONE[bucket.tone].fill,
                )}
                style={{
                  height: `calc((100% - 1.75rem) * ${bucket.count / max})`,
                  minHeight: bucket.count > 0 ? 4 : 0,
                  animationDelay: `${100 + i * 60}ms`,
                }}
              />
            </li>
          ))}
        </ul>

        {/* Under each column, what it means and how long: the verdict in
            ink, the age under it. */}
        <ul aria-hidden="true" className="mt-2 grid grid-cols-3">
          {WAITING.map((bucket) => (
            <li key={bucket.label} className="flex flex-col items-center text-center">
              <span className="text-note text-ink font-medium">{TONE[bucket.tone].verdict}</span>
              <span className="text-meta text-ink-meta">{bucket.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </SectionCard>
  );
}
