"use client";

import { ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/** How long the pointer may leave before a hover-opened panel closes, so a
 *  path that clips the gap between the trigger and the panel keeps it. */
const CLOSE_DELAY = 150;

/**
 * The header's Product ▾: a disclosure, not an ARIA menu, since its items
 * are plain links (the WAI-ARIA disclosure navigation pattern). It opens on
 * hover (a mouse only) and on click; a click on a hover-opened panel keeps
 * it open. Esc closes it and returns focus to the trigger; tabbing past its
 * last link, a click outside it and a navigation close it too. The panel (the
 * links, drawn by header.tsx on the server) follows the trigger in the DOM,
 * so Tab walks into it in order; while closed it is `invisible`, out of the
 * tab order.
 */
export function ProductMenu({ label, children }: { label: string; children: ReactNode }) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  // Why it is open: a hover-opened panel closes when the pointer leaves, a
  // clicked one stays until dismissed.
  const [open, setOpen] = useState<"hover" | "click" | null>(null);

  // Close on navigation, Back and Forward included. Set during render, not
  // in an effect.
  const pathname = usePathname();
  const [shownPath, setShownPath] = useState(pathname);
  if (pathname !== shownPath) {
    setShownPath(pathname);
    setOpen(null);
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (rootRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
      setOpen(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // A link inside closes the panel, even one to the page already shown.
  const onPanelClick = (event: MouseEvent) => {
    if ((event.target as Element).closest("a")) setOpen(null);
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        window.clearTimeout(closeTimer.current);
        setOpen((current) => current ?? "hover");
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse") return;
        closeTimer.current = window.setTimeout(
          () => setOpen((current) => (current === "hover" ? null : current)),
          CLOSE_DELAY,
        );
      }}
      onBlur={(event) => {
        // Only when focus moved to another element: a click on the panel's
        // blank space blurs to nothing and must not close it.
        const next = event.relatedTarget as Node | null;
        if (next && !event.currentTarget.contains(next)) setOpen(null);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open !== null}
        aria-controls={panelId}
        onClick={() => setOpen((current) => (current === "click" ? null : "click"))}
        className={cn(
          "hover:text-ink inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-slate-800 transition-colors",
          open && "text-ink",
        )}
      >
        {label}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "ease-glide size-4 opacity-60 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {/* The top padding bridges the gap to the trigger, so the pointer
          never leaves the root on its way down. */}
      <div
        id={panelId}
        data-open={open ? "" : undefined}
        onClick={onPanelClick}
        className={cn(
          "absolute top-full left-1/2 z-10 -translate-x-1/2 pt-3",
          "ease-exit invisible -translate-y-1 opacity-0 transition-[opacity,translate,visibility] duration-150",
          "data-open:ease-glide data-open:visible data-open:translate-y-0 data-open:opacity-100 data-open:duration-250",
        )}
      >
        {children}
      </div>
    </div>
  );
}
