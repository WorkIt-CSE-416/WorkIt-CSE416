"use client";

import { useState, useTransition } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button } from "@/components/ui/button";
import { changeJobStatus } from "@/lib/job-actions";

/**
 * The confirmation in front of closing a job, shared by the jobs table's row
 * menu and the edit page's status bar.
 *
 * Controlled (`open`/`onOpenChange`) rather than owning a trigger, because the
 * row menu opens it from a menu item, and a dialog nested inside the menu
 * would unmount the moment the menu closed. Closing is final, which is the
 * whole reason this asks first; pausing is undone with Resume, so it doesn't.
 */
export function CloseJobDialog({
  jobId,
  title,
  open,
  onOpenChange,
  onClosed,
}: {
  jobId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isClosing, startClosing] = useTransition();

  function close() {
    setError(null);
    startClosing(async () => {
      const result = await changeJobStatus(jobId, "closed");
      if (result.error) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      onClosed();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close {title}?</DialogTitle>
          <DialogDescription>
            Applicants won&apos;t be able to apply anymore, and a closed job can&apos;t be reopened
            or edited.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-meta text-danger">{error}</p>}

        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Keep It Open</Button>} />
          <Button variant="destructive" onClick={close} disabled={isClosing}>
            Close Job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
