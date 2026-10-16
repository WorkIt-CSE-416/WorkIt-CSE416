"use client";

import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Scissors,
  Sparkles,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Bank } from "@/lib/bank-actions";
import type { Choices, ChoicesUpdate, RenderBox, RenderedPdf } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";

import { lineName, pageLabel, tray, type Line } from "./model";
import { boxKey, kindLabel, PdfPages } from "./pdf-pages";
import { Tray } from "./tray";

/**
 * The phone editor (KAN-219, the KAN-201 prototype's variant A). The page
 * fills the width and stays the editor: tap a line and a bottom sheet slides
 * up with that line in a 16 px field, its actions at 44 pt, and previous and
 * next arrows that step through the lines in page order, so a mis-tap on a
 * 7 px line costs one arrow press. The sheet has no scrim: the page above it
 * still scrolls and takes taps. Zoom draws the page at two times the width.
 * The whole layout is sized to the visual viewport, because the iOS keyboard
 * covers the layout viewport instead of shrinking it; sized this way the
 * sheet stays above the keyboard. The desktop editor owns the state and the
 * saves; this file only lays them out. "Ask WorkIt", in the bottom bar and
 * in a line's sheet, opens the assistant (KAN-221) in its own sheet.
 */

/** Below this width the editor takes the phone layout. */
const PHONE_QUERY = "(max-width: 40rem)";
/** 44 pt, Apple's smallest touch target, for every control in the sheet. */
const TAP = "[&_button]:min-h-11 [&_button]:min-w-11";
/** 16 px: below this, iOS Safari zooms the page when the field gets focus. */
const FIELD =
  "bg-panel text-ink ring-border-subtle focus:ring-brand w-full resize-none rounded-xl px-3 py-2.5 text-[16px] leading-6 ring-1 outline-none focus:ring-2";

function subscribeQuery(onChange: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True on a phone-width screen; false on the server, so the first paint is desktop's. */
export function usePhone() {
  return useSyncExternalStore(
    subscribeQuery,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

function subscribeViewport(onChange: () => void) {
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", onChange);
  viewport?.addEventListener("scroll", onChange);
  window.addEventListener("resize", onChange);
  return () => {
    viewport?.removeEventListener("resize", onChange);
    viewport?.removeEventListener("scroll", onChange);
    window.removeEventListener("resize", onChange);
  };
}

/** The visual viewport's height and offset, as "height|top". */
function viewportSnapshot() {
  const viewport = window.visualViewport;
  return `${viewport?.height ?? window.innerHeight}|${viewport?.offsetTop ?? 0}`;
}

/** Each box's line once, in page order: by page, then top to bottom, then left to right. */
export function pageOrder(boxes: RenderBox[]) {
  const sorted = [...boxes].sort((a, b) => a.page - b.page || a.y0 - b.y0 || a.x0 - b.x0);
  return [...new Set(sorted.map(boxKey))];
}

export function PhoneEditor({
  rendered,
  bank,
  choices,
  selected,
  line,
  box,
  text,
  saving,
  elapsed,
  error,
  fitUndo,
  actions,
  assistant,
  onSelect,
  onType,
  onFlush,
  onApply,
  onFit,
  onUndoFit,
  onDrawn,
}: {
  rendered: RenderedPdf;
  bank: Bank;
  choices: Choices;
  selected: string | null;
  line: Line | null;
  box: RenderBox | undefined;
  /** The selected line's typed text, or null when it is not typed in place. */
  text: string | null;
  saving: boolean;
  elapsed: number | null;
  error: string | null;
  fitUndo: ChoicesUpdate | null;
  /** The selected line's actions, the same as the desktop sticky bar's. */
  actions: ReactNode;
  /** The editor assistant (KAN-221), shown in a sheet when asked for. */
  assistant: ReactNode;
  onSelect: (key: string | null) => void;
  onType: (text: string) => void;
  onFlush: () => void;
  onApply: (changes: ChoicesUpdate) => void;
  onFit: () => void;
  onUndoFit: () => void;
  onDrawn: () => void;
}) {
  const snapshot = useSyncExternalStore(subscribeViewport, viewportSnapshot, () => "0|0");
  const [height, top] = snapshot.split("|").map(Number);
  const [zoom, setZoom] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const order = pageOrder(rendered.boxes);
  const at = selected ? order.indexOf(selected) : -1;
  const waiting = tray(bank, choices).length;

  // Bring the selected line to the middle of the page area, also after an arrow press
  useEffect(() => {
    if (!selected) return;
    scroller.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [selected, zoom]);

  return (
    <div
      className="bg-app fixed inset-x-0 top-0 z-40 flex flex-col overflow-hidden"
      style={{ height: height || "100dvh", transform: `translateY(${top}px)` }}
    >
      <header className="bg-surface/95 border-border-subtle flex flex-col gap-2 border-b px-4 pt-3 pb-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <Link
            href="/bank"
            aria-label="Back to Experience Bank"
            className="text-ink -ml-2 flex size-11 items-center justify-center rounded-full"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <Badge tone={rendered.page_count <= 1 ? "positive" : "warning"}>
            {rendered.page_count <= 1 && <Check className="mr-1 size-3" />}
            {pageLabel(rendered.page_count, rendered.lines_over)}
          </Badge>
          <span className="text-note text-ink-meta ml-auto" aria-live="polite">
            {saving ? "Saving…" : elapsed != null ? `Saved, ${elapsed} ms` : ""}
          </span>
        </div>
        <div className={cn("flex flex-wrap items-center gap-2", TAP)}>
          {rendered.page_count > 1 && (
            <Button variant="outline" size="sm" onClick={onFit} disabled={saving}>
              <Scissors /> Fit to One Page
            </Button>
          )}
          {fitUndo && (
            <Button variant="secondary" size="sm" onClick={onUndoFit} disabled={saving}>
              <Undo2 /> Undo
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            aria-pressed={zoom}
            onClick={() => setZoom(!zoom)}
          >
            {zoom ? <ZoomOut /> : <ZoomIn />}
            {zoom ? "Fit Width" : "Zoom"}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-note text-danger">
            {error}
          </p>
        )}
      </header>

      <div
        ref={scroller}
        className={cn("min-h-0 flex-1 overflow-auto p-4", selected ? "pb-[70vh]" : "pb-24")}
      >
        <div className={zoom ? "w-[200%]" : "w-full"}>
          <PdfPages
            pdf={rendered.pdf}
            boxes={rendered.boxes}
            selected={selected}
            onSelect={(key) => onSelect(selected === key ? null : key)}
            onDrawn={onDrawn}
          />
        </div>
      </div>

      {!selected && (
        <div
          className={cn(
            "bg-surface/95 border-border-subtle absolute inset-x-0 bottom-0 border-t p-3 backdrop-blur",
            TAP,
          )}
        >
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setTrayOpen(true)}>
              Not on This Resume {waiting > 0 && <span className="text-ink-meta">({waiting})</span>}
            </Button>
            <Button variant="outline" onClick={() => setAsking(true)}>
              <Sparkles /> Ask WorkIt
            </Button>
          </div>
        </div>
      )}

      {/* No scrim: the page above the sheet still scrolls and takes taps */}
      {selected && line && box && (
        <Sheet
          onClose={() => onSelect(null)}
          title={
            <div className="flex min-w-0 items-center gap-1">
              <Button
                variant="secondary"
                size="sm"
                aria-label="Previous Line"
                disabled={at <= 0}
                onClick={() => onSelect(order[at - 1])}
              >
                <ChevronLeft />
              </Button>
              <span className="text-label text-ink-meta min-w-0 flex-1 truncate text-center font-semibold">
                {kindLabel(box.kind)} · {lineName(line)}
              </span>
              <Button
                variant="secondary"
                size="sm"
                aria-label="Next Line"
                disabled={at < 0 || at >= order.length - 1}
                onClick={() => onSelect(order[at + 1])}
              >
                <ChevronRight />
              </Button>
            </div>
          }
        >
          {text != null &&
            (line.kind === "bullet" ? (
              <textarea
                aria-label={kindLabel(box.kind)}
                value={text}
                enterKeyHint="done"
                onChange={(e) => onType(e.target.value)}
                onBlur={onFlush}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  e.currentTarget.blur();
                }}
                className={cn(FIELD, "field-sizing-content min-h-24")}
              />
            ) : (
              <input
                aria-label={kindLabel(box.kind)}
                value={text}
                enterKeyHint="done"
                onChange={(e) => onType(e.target.value)}
                onBlur={onFlush}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className={FIELD}
              />
            ))}
          <div className={cn("flex flex-wrap items-center gap-2", TAP)}>
            {actions}
            <Button variant="outline" size="sm" onClick={() => setAsking(true)}>
              <Sparkles /> Ask WorkIt About This Line
            </Button>
          </div>
        </Sheet>
      )}

      {/* Kept mounted while closed, so the chat survives closing it */}
      <div className={cn("absolute inset-x-0 bottom-0 z-50 h-[70%]", !asking && "hidden")}>
        <Sheet onClose={() => setAsking(false)} title="WorkIt Assistant" fill>
          {assistant}
        </Sheet>
      </div>

      {trayOpen && (
        <>
          <div className="absolute inset-0 z-30 bg-black/25" onClick={() => setTrayOpen(false)} />
          <Sheet onClose={() => setTrayOpen(false)} title="Not on This Resume">
            <div className={TAP}>
              <Tray bank={bank} choices={choices} onPutBack={onApply} />
              {waiting === 0 && (
                <p className="text-body text-ink-meta">
                  Everything in your bank is on this resume.
                </p>
              )}
            </div>
          </Sheet>
        </>
      )}
    </div>
  );
}

/** A panel that slides up from the bottom edge of the layout. */
function Sheet({
  title,
  onClose,
  children,
  fill = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** The body fills the sheet's full height and scrolls itself (the chat). */
  fill?: boolean;
}) {
  return (
    <div
      className={cn(
        "animate-rise bg-surface ring-border-subtle absolute inset-x-0 bottom-0 z-40 flex flex-col rounded-t-3xl shadow-lg ring-1",
        fill ? "h-full" : "max-h-[70%]",
      )}
      // A press on a button keeps focus in the field, so the keyboard stays up
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) e.preventDefault();
      }}
    >
      <div className="bg-border-subtle mx-auto mt-2 h-1 w-10 rounded-full" />
      <div className={cn("flex items-center gap-2 px-4 pt-1", TAP)}>
        <div className="text-label text-ink-meta min-w-0 flex-1 truncate font-semibold">
          {title}
        </div>
        <Button variant="secondary" size="sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      {fill ? (
        <div className="flex min-h-0 flex-1 flex-col pt-2">{children}</div>
      ) : (
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pt-2 pb-4">{children}</div>
      )}
    </div>
  );
}
