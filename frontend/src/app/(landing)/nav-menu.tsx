"use client";

import { CaretDownIcon } from "@phosphor-icons/react/ssr";
import { usePathname } from "next/navigation";
import {
  createContext,
  use,
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
  type ReactNode,
  type SetStateAction,
} from "react";

import { cn } from "@/lib/cn";

import { NAV_ITEM } from "./layout-parts";

/** How long the pointer may leave before a hover-opened panel closes, so a
 *  path that clips the gap between the trigger and the panel keeps it. */
const CLOSE_DELAY = 150;

/** Which menu is open, and why: a hover-opened panel closes when the pointer
 *  leaves, a clicked one stays until dismissed. */
type Open = { id: string; why: "hover" | "click" } | null;

/** Closes menu `id` only, so a late event from one menu never shuts the
 *  other. */
const shut = (id: string) => (current: Open) => (current?.id === id ? null : current);

const NavMenuContext = createContext<{
  open: Open;
  setOpen: Dispatch<SetStateAction<Open>>;
} | null>(null);

/**
 * Holds the header's menus (Features ▾, Resources ▾), so only one is open
 * at a time: opening one closes the other, and a hover on the second
 * trigger moves straight to it. Each menu with its own state let a pinned
 * panel stay open under the other's. A navigation closes both.
 */
export function NavMenuGroup({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open>(null);

  // Close on navigation, Back and Forward included. Set during render, not
  // in an effect.
  const pathname = usePathname();
  const [shownPath, setShownPath] = useState(pathname);
  if (pathname !== shownPath) {
    setShownPath(pathname);
    setOpen(null);
  }

  return <NavMenuContext value={{ open, setOpen }}>{children}</NavMenuContext>;
}

/**
 * One of the header's menus: a disclosure, not an ARIA menu, since its items
 * are plain links (the WAI-ARIA disclosure navigation pattern). It opens on
 * hover (a mouse only) and on click; a click on a hover-opened panel keeps
 * it open. Esc closes it and returns focus to the trigger; tabbing past its
 * last link, a click outside it and a navigation close it too. The panel (the
 * links, drawn by header.tsx on the server) follows the trigger in the DOM,
 * so Tab walks into it in order; while closed it is `invisible`, out of the
 * tab order. It must sit inside a NavMenuGroup.
 */
export function NavMenu({ label, children }: { label: string; children: ReactNode }) {
  const group = use(NavMenuContext);
  if (!group) throw new Error("NavMenu must sit inside a NavMenuGroup.");
  const { setOpen } = group;

  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const open = group.open?.id === id;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(shut(id));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (rootRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
      setOpen(shut(id));
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, id, setOpen]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const close = () => setOpen(shut(id));

  // A link inside closes the panel, even one to the page already shown.
  const onPanelClick = (event: MouseEvent) => {
    if ((event.target as Element).closest("a")) close();
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        window.clearTimeout(closeTimer.current);
        setOpen((current) => (current?.id === id ? current : { id, why: "hover" }));
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse") return;
        closeTimer.current = window.setTimeout(
          () =>
            setOpen((current) => (current?.id === id && current.why === "hover" ? null : current)),
          CLOSE_DELAY,
        );
      }}
      onBlur={(event) => {
        // Only when focus moved to another element: a click on the panel's
        // blank space blurs to nothing and must not close it.
        const next = event.relatedTarget as Node | null;
        if (next && !event.currentTarget.contains(next)) close();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() =>
          setOpen((current) =>
            current?.id === id && current.why === "click" ? null : { id, why: "click" },
          )
        }
        className={cn(NAV_ITEM, open && "bg-slate-900/[0.04]")}
      >
        {label}
        <CaretDownIcon
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
        id={`${id}-panel`}
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
