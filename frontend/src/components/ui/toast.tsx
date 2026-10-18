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

import { CloseIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

/**
 * Toasts: a short message in the window's bottom right corner that rises in
 * from below the page (`animate-toast-in`), stays 5 seconds, and drops away
 * (`animate-toast-out`). Its cross closes it at once. An optional action
 * (Undo) runs, then closes it.
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
  /** How long it stays, in ms. */
  duration?: number;
};

type ShownToast = ToastInput & { id: number; leaving: boolean };

type ToastApi = {
  /** Shows a toast and answers its id, for `dismiss`. */
  show: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
};

export const TOAST_DURATION = 5000;
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
          <ToastCard key={toast.id} toast={toast} dismiss={dismiss} remove={remove} />
        ))}
      </section>
    </ToastContext>
  );
}

/** One toast. `dismiss` and `remove` are the provider's, stable across
 *  renders, so the timer restarts only when it pauses or resumes. */
function ToastCard({
  toast,
  dismiss,
  remove,
}: {
  toast: ShownToast;
  dismiss: (id: number) => void;
  remove: (id: number) => void;
}) {
  const { id } = toast;
  const [paused, setPaused] = useState(false);
  const [acting, setActing] = useState(false);
  const remaining = useRef(toast.duration ?? TOAST_DURATION);

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
        "bg-panel border-border-subtle rounded-card shadow-lift pointer-events-auto flex items-center gap-3 border py-2.5 pr-2 pl-4",
        toast.leaving ? "animate-toast-out" : "animate-toast-in",
      )}
    >
      <p className="text-body text-ink min-w-0 flex-1">{toast.message}</p>
      {toast.action && (
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          disabled={acting}
          onClick={() => act(toast.action!)}
        >
          {toast.action.label}
        </Button>
      )}
      <IconButton
        label="Close"
        tooltip="Close"
        className="size-7 shrink-0"
        onClick={() => dismiss(id)}
      >
        <CloseIcon className="size-3.5" />
      </IconButton>
    </div>
  );
}
