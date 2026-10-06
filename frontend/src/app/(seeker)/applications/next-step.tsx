import { CalendarIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

import { When } from "../local-time";
import type { TrackerEvent } from "../tracker";

/**
 * An application's next commitment: what it is, then when. The board card, the
 * grid card and the list row all draw it from here, so the three views
 * describe an application the same way.
 *
 * An icon rather than a grey box: on the board the box was a third nested
 * panel (column, card, box). The icon is grey, not brand: the calendar is the
 * Interviewing glyph and violet is the Applied colour, so a coloured one put a
 * second stage on every card. The dark, medium-weight label is what marks it
 * to act on.
 *
 * ALWAYS AT LEAST TWO LINES TALL. With nothing scheduled it says so and keeps
 * the second line's height, so a card without a next step stands as tall as
 * its neighbours and its footer stays on their line instead of jumping up.
 *
 * `truncate` holds each line to one row, for the list, where a wrapped label
 * would make that row taller than the rest. The cards let a label wrap.
 *
 * The caller picks the event (`nextEvent` in ../tracker.ts) and the date is
 * printed in the viewer's own time by <When>, so this stays a plain component
 * the server views and the client detail panel can both render.
 */
export function NextStep({
  next,
  truncate = false,
  className,
}: {
  next: TrackerEvent | undefined;
  truncate?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-8 items-start gap-2", className)}>
      <CalendarIcon className="text-ink-meta mt-0.5 size-3.5 shrink-0" />
      {next ? (
        <div className="min-w-0">
          <p className={cn("text-note text-ink font-medium", truncate && "truncate")}>
            {next.title}
          </p>
          <p className={cn("text-note text-ink-meta", truncate && "truncate")}>
            <When at={next.at} />
          </p>
        </div>
      ) : (
        <p className="text-note text-ink-meta">Nothing scheduled</p>
      )}
    </div>
  );
}
