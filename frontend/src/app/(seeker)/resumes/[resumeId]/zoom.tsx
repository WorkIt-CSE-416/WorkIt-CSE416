"use client";

import { MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon } from "@phosphor-icons/react/ssr";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { EDITOR_ZOOM_KEY, readLocalDraft, writeLocalDraft } from "@/lib/local-drafts";

/** The zoom steps, in percent of the page's printed size: 100% is 8.5in
 *  at 96 CSS px an inch (816px), as a browser's PDF viewer draws it. The
 *  page never grows past its column, so a high step on a narrow screen
 *  stops at the column's width. Each page draws again at its new width
 *  (`PageCanvas`), so text stays sharp at every step. An upload's page
 *  (../uploaded/[id]/viewer.tsx) draws the same control over its own
 *  state, opening at 100% and storing nothing. */
const ZOOMS = [50, 75, 90, 100, 125, 150];
const DEFAULT_ZOOM = 125;
export const zoomWidth = (zoom: number) => `${(816 * zoom) / 100}px`;

/** The page's zoom, kept per browser (`EDITOR_ZOOM_KEY`). The server and
 *  hydration draw the default, then the browser's own step. */
const zoomListeners = new Set<() => void>();
// The pick this tab made, so the zoom still moves when storage refuses it
let pickedZoom: number | null = null;
function readZoom() {
  if (pickedZoom != null) return pickedZoom;
  const kept = readLocalDraft<number>(EDITOR_ZOOM_KEY);
  return kept && ZOOMS.includes(kept) ? kept : DEFAULT_ZOOM;
}
export function useZoom() {
  const zoom = useSyncExternalStore(
    (listener) => {
      zoomListeners.add(listener);
      return () => zoomListeners.delete(listener);
    },
    readZoom,
    () => DEFAULT_ZOOM,
  );
  const set = (to: number) => {
    pickedZoom = to;
    writeLocalDraft(EDITOR_ZOOM_KEY, to);
    zoomListeners.forEach((listener) => listener());
  };
  return [zoom, set] as const;
}

/** Zoom out, the zoom as a menu of its steps, and zoom in, as a PDF
 *  viewer has them. After KAN-421 widened every seeker page to 1440px,
 *  the page filled its column and took most of the screen; it now opens
 *  at 125% and the student picks. */
export function Zoom({ zoom, onZoom }: { zoom: number; onZoom: (zoom: number) => void }) {
  const at = ZOOMS.indexOf(zoom);
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Zoom out"
        title="Zoom out"
        disabled={at <= 0}
        onClick={() => onZoom(ZOOMS[at - 1])}
      >
        <MagnifyingGlassMinusIcon aria-hidden />
      </Button>
      <select
        aria-label="Zoom"
        value={zoom}
        onChange={(e) => onZoom(Number(e.target.value))}
        className="text-note text-ink-muted hover:bg-ink/5 h-7 cursor-pointer appearance-none rounded-md bg-transparent px-1.5 text-center font-medium tabular-nums"
      >
        {ZOOMS.map((step) => (
          <option key={step} value={step}>
            {step}%
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Zoom in"
        title="Zoom in"
        disabled={at >= ZOOMS.length - 1}
        onClick={() => onZoom(ZOOMS[at + 1])}
      >
        <MagnifyingGlassPlusIcon aria-hidden />
      </Button>
      <span aria-hidden className="bg-border-subtle mx-1 h-5 w-px" />
    </div>
  );
}
