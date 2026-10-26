"use client";

import { ArrowRightIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";

import type { MatchShift } from "../../../resumes/[resumeId]/tailor-review";

/**
 * What the run did to the keyword match, at the top of the Suggestions
 * panel (./tailor-suggestions.tsx): "Keyword Match 3 of 14 → 9 of 14" and
 * each keyword it added, from the record the Tailor screen keeps in
 * sessionStorage (`MatchShift`, ../../../resumes/[resumeId]/tailor-review.tsx).
 * It is the run's: accepting, rejecting or editing after it does not move it.
 */
export function TailorScore({ match }: { match: MatchShift }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="text-label text-ink flex items-center gap-2">
        Keyword Match
        <span className="text-ink-meta">
          {match.before} of {match.total}
        </span>
        <ArrowRightIcon className="text-ink-meta size-4" />
        <span className="text-positive-ink font-semibold">
          {match.after} of {match.total}
        </span>
      </p>
      {match.added.length > 0 && (
        <ul role="list" aria-label="Keywords the run added" className="flex flex-wrap gap-1.5">
          {match.added.map((k) => (
            <li key={k.keyword}>
              <Badge variant="tag" tone="positive">
                {k.keyword}
                {k.kind === "required" && <span className="sr-only"> (required)</span>}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
