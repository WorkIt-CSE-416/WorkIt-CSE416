import { cn } from "@/lib/cn";

import { WAITING, type WaitBucket } from "./data";
import { SectionHeader } from "./section-header";

/**
 * Applications with no reply yet, by how long they have waited — the seeker's
 * "Time in stage". Open on the page, like the Dashboard's other sections. Bars rather than a ring: the buckets are ordered, and the
 * question is how much of the pile is old, which a row of lengths answers in
 * one look.
 *
 * THE COLOUR IS A TRAFFIC LIGHT, because that is the question: is this fine,
 * should I act, or is it gone. Green under two weeks (a normal wait), amber
 * from fifteen to thirty days (when a short follow-up note helps), red past
 * thirty (probably a silent no). It was brand purple shading into a dark
 * amber and red, which read as a palette rather than as a verdict — purple
 * says "brand", not "fine", and the text amber reads brown as a bar. The
 * figures beside the bars and the line under the headline say the same in
 * words, so nothing depends on telling the colours apart.
 */
const TONE: Record<WaitBucket["tone"], string> = {
  fresh: "bg-positive",
  due: "bg-warning-fill",
  stale: "bg-danger",
};

export function Waiting() {
  const max = Math.max(...WAITING.map((bucket) => bucket.count), 1);
  const total = WAITING.reduce((sum, bucket) => sum + bucket.count, 0);
  const due = WAITING.filter((bucket) => bucket.tone !== "fresh").reduce(
    (sum, bucket) => sum + bucket.count,
    0,
  );

  return (
    <section aria-labelledby="waiting" className="flex flex-col">
      <SectionHeader
        id="waiting"
        title="Waiting to Hear Back"
        link={
          due > 0
            ? { href: "/applications", text: "Follow Up", label: "Follow Up on Applications" }
            : undefined
        }
      />
      <p className="text-body text-ink-meta mt-1">No reply yet, as of today.</p>

      {/* The headline first, so the section answers "how many" before "how
          old"; the line under it is the reason to act, which used to be a
          sentence-long link at the bottom. */}
      <p className="mt-4 flex items-baseline gap-2">
        <span className="text-display text-ink">{total}</span>
        <span className="text-body text-ink-meta">applications waiting</span>
      </p>
      {due > 0 && (
        <p className="text-note text-ink-meta mt-0.5">
          <span className="text-ink font-semibold">{due}</span> over two weeks, worth a follow-up
        </p>
      )}

      <ul className="mt-4 flex flex-col gap-3.5">
        {WAITING.map((bucket) => (
          <li key={bucket.label} className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-3">
            <span className="text-note text-ink-meta">{bucket.label}</span>
            <span className="bg-well h-2.5 overflow-hidden rounded-full">
              <span
                className={cn("block h-full rounded-full", TONE[bucket.tone])}
                style={{ width: `${(bucket.count / max) * 100}%` }}
              />
            </span>
            <span className="text-label text-ink text-right tabular-nums">{bucket.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
