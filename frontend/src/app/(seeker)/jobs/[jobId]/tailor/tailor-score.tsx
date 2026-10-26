"use client";

import type { MatchShift } from "../../../resumes/[resumeId]/tailor-review";

/**
 * What the run did to the keyword match, as one thin row at the top of the
 * Suggestions panel (./tailor-suggestions.tsx): "Keyword match 3 → 9 of
 * 14" over a hairline meter, the part the run added in green, and the
 * keywords it added. When the run matched no new keyword (3 → 3) it says
 * so in words: an arrow to the same number read as a fault. From the
 * record the Tailor screen keeps in sessionStorage (`MatchShift`,
 * ../../../resumes/[resumeId]/tailor-review.tsx). It is the run's:
 * accepting, rejecting or editing after it does not move it.
 */
export function TailorScore({ match }: { match: MatchShift }) {
  const { before, after, total, added } = match;
  const share = (n: number) => `${total > 0 ? (Math.min(n, total) / total) * 100 : 0}%`;
  const gained = after > before;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-note text-ink-muted flex flex-wrap items-baseline gap-x-1.5">
        <span>Keyword match</span>
        {gained ? (
          <span className="text-ink tabular-nums">
            {before} → <span className="text-positive-ink font-semibold">{after}</span> of {total}
          </span>
        ) : (
          <>
            <span className="text-ink tabular-nums">
              {after} of {total}
            </span>
            <span className="text-ink-meta">· No new keywords matched</span>
          </>
        )}
      </p>
      <div aria-hidden className="bg-ink/5 relative h-1 overflow-hidden rounded-full">
        {gained && (
          <span className="bg-positive absolute inset-y-0 left-0" style={{ width: share(after) }} />
        )}
        <span className="bg-ink/25 absolute inset-y-0 left-0" style={{ width: share(before) }} />
      </div>
      {added.length > 0 && (
        <p className="text-caption text-ink-meta truncate">
          Added: {added.map((k) => k.keyword).join(", ")}
        </p>
      )}
    </div>
  );
}
