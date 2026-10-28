"use client";

import { useState, type ReactElement, type ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { Button } from "@/components/ui/button";

/**
 * The line a bank entry's Delete opens on Experiences: what goes and what
 * stays, then the red Delete and Keep It. It stays beside the Resumes view
 * though only `/bank` imports it now, as the shared header does: the two
 * routes are one page's views. A resume asks in `DeleteResumeConfirm`,
 * below, with the same words and buttons.
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

/**
 * Delete's confirm on a resume (KAN-347): a popover hung from the control
 * that opened it, a card's trash or the upload page's Delete, so the
 * question sits where the student clicked. Under the card it opened below
 * the row's notes, away from the icon, and pushed the rows under it down.
 * Every resume's Delete asks here, so the cards and the upload page stay
 * alike. Escape or a click outside is Keep It. It stays open while the
 * delete runs, with Delete Resume held (`busy`): a deleted resume's row
 * takes it away, and a failed one closes it so the error under the row
 * shows.
 */
export function DeleteResumeConfirm({
  trigger,
  busy = false,
  onDelete,
}: {
  /** The button the popover hangs from. */
  trigger: ReactElement;
  busy?: boolean;
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  async function remove() {
    await onDelete();
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="end" className="w-auto max-w-72 gap-3">
        <p className="text-note text-ink-muted text-pretty">
          Delete this resume? Files you already sent are kept.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="destructive" onClick={remove} disabled={busy}>
            Delete Resume
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
            Keep It
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
