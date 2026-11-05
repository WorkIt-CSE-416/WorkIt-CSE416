"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { TrashIcon } from "@/components/icons";
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
import { IconButton } from "@/components/ui/icon-button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

import type { Application } from "../tracker";
import { unsaveJob } from "../jobs/actions";

/**
 * In place of the stage menu on a closed saved job (`isClosedSaved` in
 * ../tracker.ts, 2026-11-05): a muted
 * "Posting closed", which says why the row's logo is grey, and a trash
 * button that takes the job out of the Tracker.
 *
 * The words carry the meaning, not the grey: colour alone fails WCAG 1.4.1,
 * and a screen reader never hears a faded logo. So the button's name repeats
 * the reason ("Remove Product Designer at Triumph, posting closed").
 *
 * IT ASKS FIRST. The API saves only an open job, so a closed one could not
 * be saved again: there is no Undo to offer, and the app asks first wherever
 * it has none (as the stage menu does before leaving Saved).
 */
export function ClosedSavedControl({
  app,
  className,
}: {
  app: Pick<Application, "id" | "role" | "company">;
  className?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();

  function remove() {
    setAsking(false);
    start(async () => {
      const { error } = await unsaveJob(app.id);
      if (error) {
        toast.show({ message: `Couldn't remove ${app.role}. ${error}` });
        return;
      }
      toast.show({ message: `Removed ${app.role}.` });
      router.refresh();
    });
  }

  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <span className="text-note text-ink-meta">Posting closed</span>
      <IconButton
        label={`Remove ${app.role} at ${app.company}, posting closed`}
        tooltip="Remove"
        disabled={pending}
        onClick={() => setAsking(true)}
      >
        <TrashIcon className="size-4" />
      </IconButton>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-subtitle font-semibold">Remove {app.role}?</DialogTitle>
            <DialogDescription>
              Its posting at {app.company} has closed, so you can&apos;t save it again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button variant="destructive" onClick={remove}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
