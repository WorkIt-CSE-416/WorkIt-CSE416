"use client";

import { ArrowRightIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";

import { useTailorReview } from "../../../resumes/[resumeId]/tailor-review";

/**
 * What the run did to the keyword match, over the tailored resume's editor:
 * "Keyword Match 3 of 14 → 9 of 14" and each keyword it added, from the
 * record the Tailor screen keeps in sessionStorage (`MatchShift`,
 * ../../../resumes/[resumeId]/tailor-review.tsx). The screen went straight
 * to the editor before, and the run's before and after matches, which the
 * API answers, were never shown. Like the editor's marks it lives in this
 * tab only, and it is the run's: a revert or edit after it does not move it.
 */
export function TailorScore({ resumeId }: { resumeId: string }) {
  const [record] = useTailorReview(resumeId);
  const match = record?.match;
  if (!match) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
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
