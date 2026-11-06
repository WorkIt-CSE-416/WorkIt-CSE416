"use client";

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Phosphor's glyph itself, not icons.tsx's CloseIcon: the root layout
// mounts this provider on every page, and the bundler takes icons.tsx
// whole, so all its glyphs (about 40 KB compressed) loaded on every page,
// the marketing pages included (frontend/CLAUDE.md, Icons).
import { XIcon } from "@phosphor-icons/react/ssr";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

/**
 * Toasts: a short message in the window's bottom right corner that rises in
 * from below the page (`animate-toast-in`), stays 5 seconds (8 with an
 * action, `TOAST_ACTION_DURATION`), and drops away (`animate-toast-out`).
 * Its cross closes it at once. An optional action (Undo), or two side by
 * side (`actions`: Save's View and Undo), runs, then closes it.
 *
 * It is the inverted surface (`bg-inverse`, KAN-217): dark on the light
 * app, so it stands out from every white card; the user missed the white
 * one. Its buttons and cross are the `inverse` variants, light on it. Read
 * the tokens, never ink and panel, so a dark theme turns it light.
 *
 * One `<ToastProvider>` in the root layout, beside the tooltips', so every
 * page, both shells and the design kit, can call `useToast().show(...)`. It
 * lives above the page so a toast outlives what raised it: Live Activity's
 * cross refreshes the route, and the row it was on is gone before its Undo
 * is clicked.
 *
 * - **The timer stops while the pointer or the keyboard is on a toast**, and
 *   goes on from where it was, so nobody loses an Undo mid-reach (WCAG 2.2.1).
 * - **At most three show**, newest at the bottom, nearest the corner. A
 *   fourth drops the oldest.
 * - **The region is a polite live region**, so a screen reader reads a toast
 *   after whatever it is reading. The toasts themselves take clicks; the
 *   corner they stand in does not.
 * - **`onClose` runs once the toast is gone, unless its action ran**: its
 *   time ran out, its cross was pressed, a newer toast pushed it out or
 *   `dismiss` was called. A write held back for Undo is sent there
 *   (Application Info's Transcript Remove): the action takes it back by
 *   never sending it.
 * - Copy follows frontend/CLAUDE.md: the message is sentence case, the
 *   action a Title Case button label.
 */

export type ToastAction = {
  label: string;
  /** May be async: the button shows it is working until it ends. */
  onClick: () => void | Promise<void>;
};

export type ToastInput = {
  message: ReactNode;
  action?: ToastAction;
  /** Two actions side by side, in place of `action` (Save's View and Undo,
   *  KAN-217); any one of them closes the toast. */
  actions?: ToastAction[];
  /** How long it stays, in ms: TOAST_DURATION, or TOAST_ACTION_DURATION
   *  when it has an action. */
  duration?: number;
  /** Runs once the toast is gone, unless its action ran. */
  onClose?: () => void;
};

type ShownToast = ToastInput & { id: number; leaving: boolean };

type ToastApi = {
  /** Shows a toast and answers its id, for `dismiss`. */
  show: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
};

export const TOAST_DURATION = 5000;
/** A toast with an action stays longer: at 5 s the user missed Save's Undo
 *  (KAN-217). */
export const TOAST_ACTION_DURATION = 8000;
const MAX_TOASTS = 3;
/** `--animate-toast-out`'s length. The toast is removed this long after it
 *  starts to leave even if no animationend comes (a hidden tab skips it). */
const EXIT_MS = 180;

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = use(ToastContext);
  if (!api) throw new Error("useToast needs a <ToastProvider> above it (app/layout.tsx).");
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ShownToast[]>([]);
  const nextId = useRef(0);
  // Each waiting `onClose` by toast id, and which of those ids a render has
  // shown: one is run only after its toast was in the list and then left it.
  const closers = useRef(new Map<number, () => void>());
  const drawn = useRef(new Set<number>());

  useEffect(() => {
    const ids = new Set(toasts.map((toast) => toast.id));
    for (const [id, close] of closers.current) {
      if (ids.has(id)) drawn.current.add(id);
      else if (drawn.current.has(id)) {
        closers.current.delete(id);
        drawn.current.delete(id);
        close();
      }
    }
  }, [toasts]);

  // Its action ran, so its `onClose` never will.
  const settle = useCallback((id: number) => {
    closers.current.delete(id);
  }, []);

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      setToasts((list) =>
        list.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)),
      );
      setTimeout(() => remove(id), EXIT_MS + 50);
    },
    [remove],
  );

  const show = useCallback((toast: ToastInput) => {
    const id = ++nextId.current;
    if (toast.onClose) closers.current.set(id, toast.onClose);
    setToasts((list) => [
      ...list.filter((shown) => !shown.leaving).slice(-(MAX_TOASTS - 1)),
      { ...toast, id, leaving: false },
    ]);
    return id;
  }, []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext value={api}>
      {children}
      <section
        aria-label="Notifications"
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <ToastCard
            key={toast.id}
            toast={toast}
            dismiss={dismiss}
            remove={remove}
            settle={settle}
          />
        ))}
      </section>
    </ToastContext>
  );
}

/** One toast. `dismiss`, `remove` and `settle` are the provider's, stable
 *  across renders, so the timer restarts only when it pauses or resumes. */
function ToastCard({
  toast,
  dismiss,
  remove,
  settle,
}: {
  toast: ShownToast;
  dismiss: (id: number) => void;
  remove: (id: number) => void;
  settle: (id: number) => void;
}) {
  const { id } = toast;
  const [paused, setPaused] = useState(false);
  const [acting, setActing] = useState(false);
  const actions = toast.actions ?? (toast.action ? [toast.action] : []);
  const remaining = useRef(
    toast.duration ?? (actions.length ? TOAST_ACTION_DURATION : TOAST_DURATION),
  );

  useEffect(() => {
    if (paused || acting || toast.leaving) return;
    const started = Date.now();
    const timer = setTimeout(() => dismiss(id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused, acting, toast.leaving, dismiss, id]);

  async function act(action: ToastAction) {
    setActing(true);
    settle(id);
    try {
      await action.onClick();
    } finally {
      dismiss(id);
    }
  }

  return (
    <div
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false);
      }}
      onAnimationEnd={(e) => {
        if (toast.leaving && e.target === e.currentTarget) remove(id);
      }}
      className={cn(
        "bg-inverse text-on-inverse rounded-card shadow-lift pointer-events-auto flex items-center gap-3 py-2.5 pr-2 pl-4",
        toast.leaving ? "animate-toast-out" : "animate-toast-in",
      )}
    >
      <p className="text-body min-w-0 flex-1">{toast.message}</p>
      {actions.map((action) => (
        <Button
          key={action.label}
          variant="inverse"
          size="sm"
          className="shrink-0"
          disabled={acting}
          onClick={() => act(action)}
        >
          {action.label}
        </Button>
      ))}
      <IconButton
        label="Close"
        variant="inverse"
        tooltip="Close"
        className="size-7 shrink-0"
        onClick={() => dismiss(id)}
      >
        <XIcon aria-hidden className="size-3.5" />
      </IconButton>
    </div>
  );
}
