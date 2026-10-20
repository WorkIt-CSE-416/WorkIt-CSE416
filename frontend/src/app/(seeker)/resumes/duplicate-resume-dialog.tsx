"use client";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button } from "@/components/ui/button";

/**
 * The pop-up for a resume the student already has (KAN-267): an upload whose
 * text matches one of their uploads, or a Generate that would print the same
 * as one of their built resumes. It shows the API's message, "Duplicate
 * Resume found: <name>", and an OK button; nothing else happens. Open while
 * `message` is set.
 */
export function DuplicateResumeDialog({
  message,
  onClose,
}: {
  message: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={message != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-subtitle font-semibold">{message}</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button>OK</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
