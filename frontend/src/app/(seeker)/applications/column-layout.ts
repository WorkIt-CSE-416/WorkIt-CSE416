import { useSyncExternalStore } from "react";

import { APPLICATIONS_COLUMNS_KEY } from "@/lib/local-drafts";

/**
 * The Applications list's columns, and the layout each browser keeps of
 * them (KAN-282): the order, the hidden columns and the widths.
 *
 * The columns run in the order job trackers read (KAN-256); `width` is each
 * one's starting width in px, what Reset Columns goes back to. Role is
 * FROZEN: always first, always shown, pinned at the left while the rest
 * scroll under it. It holds the company too, the role over the company's
 * name: Company was its own frozen column until the two took too much of
 * the width, and the role and company read as one fact anyway. Every other
 * column can be dragged to a new place, hidden from the Columns menu, and
 * resized by its heading's edge.
 *
 * THE LAYOUT IS A PREFERENCE OF THIS BROWSER, not of the view, so it stays
 * out of the URL (./query.ts holds what a shared link should carry: the
 * filters and the sort). It lives in localStorage under a lib/local-drafts.ts
 * key, which Sign Out clears, so the next person in this browser starts from
 * the default. Keeping it per account needs the API to store it. A layout
 * stored under old column ids (the separate Company column) loses those
 * ids on reading (`parse`), so it never breaks the table.
 *
 * An external store (useSyncExternalStore), because the table and the
 * Columns menu in the filter bar both read and write it. The server, and the
 * first render in the browser, draw the default; the stored layout swaps in
 * after hydration, so the two never disagree. The snapshot is cached by the
 * stored string, so a read that finds the same string returns the same
 * object, and one that finds the key gone (Sign Out) returns the default.
 */
export const COLUMNS = [
  { id: "role", label: "Role", width: 320 },
  { id: "status", label: "Status", width: 128 },
  { id: "applied", label: "Date Applied", width: 152 },
  { id: "match", label: "Match", width: 128 },
  { id: "track", label: "Track", width: 152 },
  { id: "location", label: "Location", width: 208 },
  { id: "workModel", label: "Work Model", width: 144 },
  { id: "pay", label: "Pay Range", width: 184 },
  { id: "source", label: "Source", width: 168 },
  { id: "resume", label: "Resume", width: 200 },
  { id: "posting", label: "Posting", width: 112 },
  { id: "notes", label: "Notes / Next Step", width: 224 },
] as const;

export type ColumnId = (typeof COLUMNS)[number]["id"];

export const FROZEN: ColumnId[] = ["role"];

/** The columns that move and hide, in their default order. */
const MOVABLE = COLUMNS.map(({ id }) => id).filter((id) => !FROZEN.includes(id));

/** How far a column resizes: past these a heading's text or the table's
 *  scroll stops making sense. */
export const MIN_WIDTH = 80;
export const MAX_WIDTH = 640;

export type ColumnLayout = {
  /** The movable columns in their order; the frozen two always lead. */
  order: ColumnId[];
  hidden: ColumnId[];
  /** Only the columns resized away from their default. */
  widths: Partial<Record<ColumnId, number>>;
};

export const DEFAULT_LAYOUT: ColumnLayout = { order: MOVABLE, hidden: [], widths: {} };

const isMovable = (id: unknown): id is ColumnId => MOVABLE.includes(id as ColumnId);

/** A stored layout, made safe: unknown columns dropped, a column added
 *  since it was stored put back at the end, widths clamped. Anything
 *  unreadable is the default. */
function parse(raw: string | null): ColumnLayout {
  if (!raw) return DEFAULT_LAYOUT;
  try {
    const stored = JSON.parse(raw) as Partial<ColumnLayout>;
    const order = [...new Set((stored.order ?? []).filter(isMovable))];
    const widths: ColumnLayout["widths"] = {};
    for (const [id, width] of Object.entries(stored.widths ?? {})) {
      if (COLUMNS.some((column) => column.id === id) && typeof width === "number") {
        widths[id as ColumnId] = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
      }
    }
    return {
      order: [...order, ...MOVABLE.filter((id) => !order.includes(id))],
      hidden: [...new Set((stored.hidden ?? []).filter(isMovable))],
      widths,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/** The layout when storage refuses (blocked site data): it then lasts as
 *  long as the tab. */
let memory: string | null = null;
let cached: { raw: string | null; layout: ColumnLayout } = { raw: null, layout: DEFAULT_LAYOUT };
const listeners = new Set<() => void>();

function readRaw() {
  try {
    return window.localStorage.getItem(APPLICATIONS_COLUMNS_KEY);
  } catch {
    return memory;
  }
}

function getSnapshot() {
  const raw = readRaw();
  if (raw !== cached.raw) cached = { raw, layout: parse(raw) };
  return cached.layout;
}

function getServerSnapshot() {
  return DEFAULT_LAYOUT;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changed it.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useColumnLayout() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Keeps `layout`; null goes back to the default (Reset Columns). */
export function setColumnLayout(layout: ColumnLayout | null) {
  memory = layout == null ? null : JSON.stringify(layout);
  try {
    if (memory == null) window.localStorage.removeItem(APPLICATIONS_COLUMNS_KEY);
    else window.localStorage.setItem(APPLICATIONS_COLUMNS_KEY, memory);
  } catch {
    // Storage refused: `memory` holds it until the tab closes.
  }
  for (const listener of listeners) listener();
}

/** Whether `layout` differs from the default, so Reset Columns has work. */
export function isCustomLayout(layout: ColumnLayout) {
  return (
    layout.hidden.length > 0 ||
    Object.keys(layout.widths).length > 0 ||
    layout.order.some((id, i) => id !== MOVABLE[i])
  );
}

/** `id` moved to where `target` stands, both movable. */
export function moveColumn(layout: ColumnLayout, id: ColumnId, target: ColumnId): ColumnLayout {
  if (id === target || !isMovable(id) || !isMovable(target)) return layout;
  const order = layout.order.filter((other) => other !== id);
  const at = order.indexOf(target);
  // Dropped on a column to its right: it lands after it, as a drag reads.
  const from = layout.order.indexOf(id);
  order.splice(from < layout.order.indexOf(target) ? at + 1 : at, 0, id);
  return { ...layout, order };
}
