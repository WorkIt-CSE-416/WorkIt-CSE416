import type { ReactNode } from "react";

import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";

/**
 * A titled block of a detail page — "About the Role", "Qualifications".
 *
 * Moved here from the search detail pane once the job-detail pages became a
 * second and third consumer of the exact same shape.
 */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <SectionHeading>{title}</SectionHeading>
      {children}
    </section>
  );
}

/**
 * The search detail pane's mockup indents these and draws no markers, so
 * that screen drops the marker rather than faking one — `marker` defaults to
 * false to keep that look. role="list" keeps the semantics Safari removes
 * when a list has no marker either way.
 *
 * The job-detail pages pass `marker`: a "What You'll Do" or "Qualifications"
 * list reads as a list of separate items, and indentation alone left it
 * looking like one run-on paragraph split across lines rather than points.
 * A small drawn dot, not the browser's own disc, to match the dot `MatchRail`
 * already draws for a caveat rather than introducing a second bullet shape.
 */
export function Points({ items, marker = false }: { items: string[]; marker?: boolean }) {
  return (
    <ul role="list" className="mt-3 flex flex-col gap-1.5 pl-4">
      {items.map((item) => (
        <li
          key={item}
          className={cn(
            "text-label text-ink-muted leading-5 font-normal",
            marker && "flex items-start gap-2",
          )}
        >
          {marker && (
            <span aria-hidden="true" className="bg-ink-faint mt-2 size-1.5 shrink-0 rounded-full" />
          )}
          {item}
        </li>
      ))}
    </ul>
  );
}
