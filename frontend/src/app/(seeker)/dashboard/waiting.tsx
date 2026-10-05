import Link from "next/link";

import { ArrowRightIcon } from "@/components/icons";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";

import { WAITING, type WaitBucket } from "./data";

/**
 * Applications with no reply yet, by how long they have waited — the seeker's
 * "Time in stage". Bars rather than a ring: the buckets are ordered, and the
 * question is how much of the pile is old, which a row of lengths answers in
 * one look.
 *
 * The colour carries the advice. Under two weeks is normal and stays brand
 * (the full brand, not its pale tint, which all but vanishes on the track);
 * fifteen to thirty is when a short follow-up note helps, so it turns amber;
 * past thirty it is probably a silent no, in red. The link under the bars says
 * the same thing in words, so nothing depends on telling the colours apart.
 */
const TONE: Record<WaitBucket["tone"], string> = {
  fresh: "bg-brand",
  due: "bg-warning",
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
    <Card padding="md" className="flex flex-col">
      <SectionHeading as="h2">Waiting to hear back</SectionHeading>
      <p className="text-note text-ink-meta mt-1">No reply yet, as of today.</p>

      {/* The headline first, so the card answers "how many" before "how
          old" — and fills the height Up next gives this row with a figure
          rather than with space around four bars. */}
      <p className="mt-4 flex items-baseline gap-2">
        <span className="text-display text-ink">{total}</span>
        <span className="text-body text-ink-meta">applications waiting</span>
      </p>

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

      {due > 0 && (
        <Link
          href="/applications"
          className="text-label text-brand-ink focus-visible:ring-brand-ring mt-auto inline-flex items-center gap-1 self-start rounded-xs pt-5 hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          Follow up on the {due} waiting over two weeks
          <ArrowRightIcon className="size-3.5" />
        </Link>
      )}
    </Card>
  );
}
