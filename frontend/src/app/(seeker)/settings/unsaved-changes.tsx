"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

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

type Api = {
  setDirty: (id: string, dirty: boolean) => void;
  /** Runs `leave` at once when nothing is unsaved, else asks first. */
  guard: (leave: () => void) => void;
  pending: (() => void) | null;
  resolve: (discard: boolean) => void;
};

const Unsaved = createContext<Api | null>(null);

/**
 * Settings' guard against losing edits (KAN-364): a form with unsaved
 * changes reports them (`useUnsavedChanges`), and leaving the section, by
 * the nav or by closing the modal, asks "Discard Your Changes?" first
 * (`useLeaveGuard`, `DiscardDialog`). Closing the tab or reloading gets the
 * browser's own warning. Before this, an edit to the name or the job
 * preferences vanished without a word when the student switched sections.
 * A history Back is not caught: the browser gives a page no way to hold it.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirty = useRef(new Set<string>());
  const [pending, setPending] = useState<(() => void) | null>(null);

  const value = useMemo<Api>(
    () => ({
      setDirty(id, isDirty) {
        if (isDirty) dirty.current.add(id);
        else dirty.current.delete(id);
      },
      guard(leave) {
        if (dirty.current.size === 0) leave();
        // A function, so React stores it rather than calling it.
        else setPending(() => leave);
      },
      pending,
      resolve(discard) {
        setPending(null);
        if (discard && pending) {
          dirty.current.clear();
          pending();
        }
      },
    }),
    [pending],
  );

  return <Unsaved value={value}>{children}</Unsaved>;
}

/** Reports a form's unsaved changes while `dirty` holds. Outside the
 *  provider it still warns before the tab closes. */
export function useUnsavedChanges(dirty: boolean) {
  const api = useContext(Unsaved);
  const id = useId();

  useEffect(() => {
    api?.setDirty(id, dirty);
    return () => api?.setDirty(id, false);
  }, [api, id, dirty]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

/** The guard for a way out of the section: runs `leave` at once, or after
 *  the student agrees to discard. */
export function useLeaveGuard(): (leave: () => void) => void {
  const api = useContext(Unsaved);
  return api ? api.guard : (leave) => leave();
}

/**
 * The question itself. Placed inside the Settings modal's own content (or
 * on the full page), so it opens as a dialog nested in the modal and the
 * modal's focus trap lets it take focus.
 */
export function DiscardDialog() {
  const api = useContext(Unsaved);
  if (!api) return null;

  return (
    <Dialog open={api.pending !== null} onOpenChange={(open) => !open && api.resolve(false)}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-subtitle font-semibold">Discard Your Changes?</DialogTitle>
          <DialogDescription>
            You have changes you haven&apos;t saved. If you leave now, they&apos;re lost.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Keep Editing</Button>} />
          <Button variant="destructive" onClick={() => api.resolve(true)}>
            Discard Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
