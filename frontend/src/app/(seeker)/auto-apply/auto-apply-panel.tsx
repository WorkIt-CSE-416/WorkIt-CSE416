import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The top of the Auto Apply page: the queue in a line, while it holds a job
 * ("3 in progress · 2 queued", `summary`, counted in the browser by
 * ./up-next.tsx's QueueSummary). `children` is the page's sections, the setup strip and Up Next
 * (./(queue)/page.tsx).
 *
 * NO BUTTON IN THE HEADER. Start Auto Apply sat at its top right until it
 * was dropped (asked for 2026-10-29): the app's page headers hold a view
 * switcher there, not a primary action. It queued the seeker's 10 best
 * matches (POST .../auto-apply/batches) and then opened the queue; its
 * Pause and Resume only moved a state of its own. Jobs now join the queue
 * from their own Auto Apply button or Up Next's Add Jobs, and open from Up
 * Next, where the student picks them and presses Auto Apply (./up-next.tsx).
 * Before it, Manage Resumes and Add to Claude sat here too (KAN-424): each
 * queued row shows and changes its own resume, and the setup strip
 * (./setup-strip.tsx) offers what a batch still needs.
 */
export function AutoApplyPanel({
  summary,
  children,
}: {
  /** The queue in a line, or null with nothing queued. */
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {summary && <p className="text-body text-ink-meta">{summary}</p>}
      {/* The page's padding is the first section's top margin with no line
          above it. */}
      <div className={cn(!summary && "[&>:first-child]:mt-0")}>{children}</div>
    </>
  );
}
