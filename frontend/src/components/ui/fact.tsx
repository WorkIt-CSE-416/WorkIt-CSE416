import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * One fact about a job: a glyph and the value beside it.
 *
 * The unit both job screens are built from — a search result stacks two of
 * these, a recommendation card lays six out on a grid — which is what moved it
 * here from search/page.tsx.
 *
 * `truncate` on the value rather than on the row is deliberate: it keeps the
 * icon at full size and clips only the text, so a long location loses its tail
 * instead of squeezing its pin. That only works because the icon is `shrink-0`
 * and the row can be given a width by whatever lays it out.
 *
 * The value is ink and the glyph ink-meta: the value is what a reader came
 * for, the glyph only says which fact it is. Both were ink-meta until
 * 2026-10-09, and the job card's facts read as faint beside its title. `title` puts the
 * whole value on the clipped text's hover, for a value that may not fit.
 */
export function Fact({
  Icon,
  title,
  className,
  children,
}: {
  Icon: ComponentType<{ className?: string }>;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn("text-note text-ink flex min-w-0 items-center gap-1.5", className)}>
      <Icon className="text-ink-meta size-3.5 shrink-0" />
      <span title={title} className="truncate">
        {children}
      </span>
    </span>
  );
}
