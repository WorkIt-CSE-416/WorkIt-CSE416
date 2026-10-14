"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { setScoutTakeover } from "./scout-store";

/** The element in Scout's panel that a takeover's content renders into. */
export const SCOUT_SLOT_ID = "scout-slot";

/**
 * Hands Scout's panel to the page while the page is mounted: its children
 * render in the panel, in place of Scout's job chat, under `title` and
 * `subtitle`. The bar's launcher still opens and closes the panel, so the
 * page's assistant lives where Scout does. Leaving the page gives the panel
 * back to Scout, with its conversation as it was.
 *
 * A portal, so the children stay in the page's React tree: they keep its
 * state and props, and a save in the panel can refresh the page.
 */
export function ScoutTakeover({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // The panel renders in the layout, so its slot is in the DOM by now.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the DOM once mounted
    setSlot(document.getElementById(SCOUT_SLOT_ID));
    setScoutTakeover({ title, subtitle });
    return () => setScoutTakeover(null);
  }, [title, subtitle]);

  return slot ? createPortal(children, slot) : null;
}
