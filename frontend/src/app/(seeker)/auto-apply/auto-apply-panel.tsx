import type { ReactNode } from "react";

/**
 * The Auto Apply page's heading: the title and, under it, the queue in a
 * line ("3 in progress · 2 queued", `summary`, counted in the browser by
 * ./up-next.tsx's QueueSummary). `children` is the page's sections, the setup strip and Up Next
 * (./page.tsx).
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
  /** The queue in a line, or null with nothing queued: the page's own line shows then. */
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div className="min-w-0">
        <h1 className="text-heading text-ink">Auto Apply</h1>
        <p className="text-body text-ink-meta mt-1">
          {summary ?? "Apply to the jobs that match you, with your resume filled in for you."}
        </p>
      </div>

      {children}
    </>
  );
}
