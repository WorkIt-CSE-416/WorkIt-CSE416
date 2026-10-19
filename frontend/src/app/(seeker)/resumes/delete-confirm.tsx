import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/**
 * The line a row's Delete opens on Resumes & Experiences: what goes and what
 * stays, then the red Delete and Keep It. Both views draw it, a bank entry
 * and a resume or sent resume alike, so it stays beside the Resumes view
 * though `/bank` imports it too, as the shared header does: the two routes
 * are one page's views. A resume and a sent resume went at one click until
 * KAN-258, while a bank entry asked first.
 *
 * The two buttons wrap as one group: wrapped one by one, Keep It sat alone
 * on a line under Delete Resume. `busy` holds Delete while the request runs,
 * so a second press cannot send a second delete.
 */
export function DeleteConfirm({
  label,
  busy = false,
  onDelete,
  onKeep,
  children,
}: {
  /** The red button's words, "Delete Resume". */
  label: string;
  busy?: boolean;
  onDelete: () => void;
  onKeep: () => void;
  /** The question: what goes, and what stays. */
  children: ReactNode;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-note text-ink-muted">{children}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" onClick={onDelete} disabled={busy}>
          {label}
        </Button>
        <Button size="sm" variant="secondary" onClick={onKeep}>
          Keep It
        </Button>
      </div>
    </div>
  );
}
