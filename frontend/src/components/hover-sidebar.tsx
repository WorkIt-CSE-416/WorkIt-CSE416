"use client";

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FocusEvent,
} from "react";

import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/shadcn/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { cn } from "@/lib/cn";

/**
 * THE SIDEBAR IS PINNED OR HOVERED (KAN-300), for both shells.
 *
 * Pinned, it stays open and the page makes room, as it always did. Unpinned,
 * it is the icon rail, and pointing at it (or tabbing into it) opens it OVER
 * the page for as long as the pointer or focus stays: the page underneath
 * neither moves nor reflows, so crossing the rail never shifts what the
 * seeker is reading. Leaving it closes it again. The toggle in the bar pins
 * and unpins, and the choice is the same sidebar_state cookie the layouts
 * read, so it survives a reload. Below md the sidebar is shadcn's sheet,
 * which has no hover, and works as before.
 *
 * Built around shadcn's provider rather than in it: src/components/shadcn is
 * vendored, so a hand edit there is a fork. The provider is controlled, open
 * when pinned or peeking. Opening for a peek sets its state to "expanded",
 * which on its own would widen the gap beside the panel and push the page,
 * so a peek holds that gap at the rail's width (data-peek below), and
 * anything sized by the pinned width reads `pinned`, never shadcn's `state`:
 * in React through useSidebarPin (the company bar's corner cell,
 * sidebar-brand.tsx), in CSS through data-pinned on the wrapper (the seeker
 * page's --panel-gain).
 */

/** shadcn's own cookie, which the layouts read as the pinned state. */
const COOKIE = "sidebar_state";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/** A pause before a peek opens, so a pointer only crossing the rail on its
 *  way to the page does not flash the panel open. */
const OPEN_DELAY = 150;
/** A pause before it closes, so a pointer that slips just past the edge,
 *  or crosses the gap to a tooltip, does not snap it shut. */
const CLOSE_DELAY = 300;

type HoverProps = {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: (event: FocusEvent<HTMLElement>) => void;
};

type SidebarPin = {
  pinned: boolean;
  peeking: boolean;
  /** For the panel (app-sidebar.tsx) to spread on itself; null while pinned,
   *  when there is nothing to peek. */
  hoverProps: HoverProps | null;
};

/** Pinned and never peeking outside a HoverSidebarProvider: the plain
 *  shadcn behaviour. */
const SidebarPinContext = createContext<SidebarPin>({
  pinned: true,
  peeking: false,
  hoverProps: null,
});

export function useSidebarPin() {
  return use(SidebarPinContext);
}

export function HoverSidebarProvider({
  defaultPinned,
  className,
  ...props
}: Omit<ComponentProps<typeof SidebarProvider>, "open" | "onOpenChange" | "defaultOpen"> & {
  /** The sidebar_state cookie, read by the layout. */
  defaultPinned: boolean;
}) {
  const [pinned, setPinned] = useState(defaultPinned);
  const [peeking, setPeeking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const firstRender = useRef(true);

  // shadcn writes its cookie on every toggle, but with the value it computed
  // from `open`, which a peek has set to true, so a pin from a peek would be
  // saved as unpinned. This runs after it and writes what was meant.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.cookie = `${COOKIE}=${pinned}; path=/; max-age=${COOKIE_MAX_AGE}`;
  }, [pinned]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Escape closes a peek. On the window, in the capture phase: a menu row's
  // tooltip takes Escape first and stops it, so a listener on the panel
  // never heard it (checked in Chromium).
  useEffect(() => {
    if (!peeking || pinned) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        clearTimeout(timer.current);
        setPeeking(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [peeking, pinned]);

  const peekAfter = useCallback((next: boolean, delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPeeking(next), delay);
  }, []);

  const hoverProps: HoverProps | null = pinned
    ? null
    : {
        onMouseEnter: () => peekAfter(true, OPEN_DELAY),
        onMouseLeave: () => peekAfter(false, CLOSE_DELAY),
        // Keyboard users get the labels too, the moment focus arrives.
        onFocus: () => peekAfter(true, 0),
        onBlur: (event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            peekAfter(false, 0);
          }
        },
      };

  return (
    <SidebarPinContext value={{ pinned, peeking, hoverProps }}>
      <SidebarProvider
        {...props}
        open={pinned || peeking}
        // Every toggle (the bar's button, Ctrl/Cmd+B) pins or unpins, whatever
        // shadcn computed from `open`: a click while peeking pins it.
        onOpenChange={() => {
          clearTimeout(timer.current);
          setPeeking(false);
          setPinned((p) => !p);
        }}
        data-peek={!pinned && peeking}
        // The pin itself, for CSS that is sized by the pinned width: the
        // seeker page's --panel-gain readers key on it with an in-data-
        // variant ((seeker)/layout.tsx, "A PAGE KEEPS THE WIDTH"). Written
        // from the same state, in the same render, as shadcn's data-state,
        // so the page's ease starts in the very frame the panel's does.
        data-pinned={pinned ? "true" : "false"}
        // A peek's panel opens over the page: the gap beside it keeps the
        // rail's width, so the page stays where it is.
        className={cn(
          "data-[peek=true]:[&_[data-slot=sidebar-gap]]:w-(--sidebar-width-icon)",
          className,
        )}
      />
    </SidebarPinContext>
  );
}

/**
 * The bar's sidebar button: on a desktop it pins and unpins the panel, and
 * says which (aria-pressed, and a tooltip naming what a click will do);
 * below md it opens and closes the sheet, as before.
 */
export function SidebarPinToggle({ className }: { className?: string }) {
  const { pinned } = useSidebarPin();
  const { isMobile } = useSidebar();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarTrigger
            className={className}
            aria-label={isMobile ? undefined : "Pin Sidebar"}
            aria-pressed={isMobile ? undefined : pinned}
          />
        }
      />
      <TooltipContent>
        {isMobile ? "Toggle sidebar" : pinned ? "Unpin sidebar" : "Pin sidebar"}
      </TooltipContent>
    </Tooltip>
  );
}
