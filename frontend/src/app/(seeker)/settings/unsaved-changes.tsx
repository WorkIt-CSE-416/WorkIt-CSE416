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
 * changes reports them (`useUnsavedChanges`), and closing the modal asks
 * "Discard Your Changes?" first (`useLeaveGuard`, `DiscardBar`). Closing the tab or reloading gets the
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

/** The question while it is asked, for the modal's own ways out: Escape
 *  or a click outside answers Keep Editing. */
export function usePendingLeave(): { asking: boolean; keep: () => void } {
  const api = useContext(Unsaved);
  return { asking: api?.pending != null, keep: () => api?.resolve(false) };
}

/**
 * The question itself: a bar across the Settings modal's foot, never a
 * dialog over it (KAN-563, `docs/design.md`, "Never a dialog over a
 * dialog"). It was a dialog nested in the modal, which Base UI does not
 * dim, so it sat over the section with no edge of its own. As a bar the
 * edits it asks about stay in view above it. It takes the focus on Keep
 * Editing, the answer that loses nothing, and gives it back to where it
 * was when Keep Editing ends it.
 */
export function DiscardBar() {
  const api = useContext(Unsaved);
  const asking = api?.pending != null;
  const keep = useRef<HTMLButtonElement>(null);
  const title = useId();

  useEffect(() => {
    if (!asking) return;
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    keep.current?.focus();
    return () => {
      if (back?.isConnected) back.focus();
    };
  }, [asking]);

  if (!api || !asking) return null;

  return (
    <div
      role="alertdialog"
      aria-labelledby={title}
      className="border-border-subtle bg-panel animate-fade flex shrink-0 flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:px-6"
    >
      <p className="text-body text-ink-meta min-w-0 flex-1">
        <span id={title} className="text-ink font-semibold">
          Discard Your Changes?
        </span>{" "}
        You have changes you haven&apos;t saved. If you leave now, they&apos;re lost.
      </p>
      <div className="flex shrink-0 gap-2 sm:justify-end">
        <Button ref={keep} variant="secondary" onClick={() => api.resolve(false)}>
          Keep Editing
        </Button>
        <Button variant="destructive" onClick={() => api.resolve(true)}>
          Discard Changes
        </Button>
      </div>
    </div>
  );
}
