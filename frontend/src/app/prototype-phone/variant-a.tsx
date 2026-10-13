"use client";

// PROTOTYPE (KAN-201), throwaway. A: the page stays the editor. The fitted
// page fills the width; tap a line and a sheet slides up with that line in a
// 16 px field, its actions at 44 pt, and previous / next line arrows, so a
// mis-tap on a 7 px line costs one arrow press. "Zoom" doubles the page.
// The sheet has no scrim: the page above it still scrolls and takes taps.

import { ChevronLeft, ChevronRight, Sparkles, ZoomIn, ZoomOut } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

import {
  blocks,
  bulletText,
  useRendered,
  type Block,
  type Editor,
} from "../prototype-editor/model";
import { Paper } from "../prototype-editor/paper";
import {
  Assistant,
  CHIP,
  FIELD,
  Header,
  hiddenItems,
  LineActions,
  NotOnResume,
  PhoneFrame,
  Sheet,
  TAP,
  useCenter,
  type Sel,
} from "./phone";

export const NAME = "Page plus sheet";

const selOf = (bl: Block): Sel | null =>
  bl.kind === "entry"
    ? { kind: "entry", entry: bl.entry }
    : bl.kind === "bullet"
      ? { kind: "bullet", entry: bl.entry, bullet: bl.bullet }
      : null;
const idOf = (s: Sel) => (s.kind === "entry" ? s.entry.id : s.bullet.id);

export function VariantA({ editor }: { editor: Editor }) {
  const { state } = editor;
  const { rendering } = useRendered(state);
  const [sel, setSel] = useState<Sel | null>(null);
  const [zoom, setZoom] = useState(false);
  const [panel, setPanel] = useState<"tray" | "ask" | null>(null);

  // Every line you can tap, in page order, for the arrows.
  const lines = blocks(state)
    .map(selOf)
    .filter((x): x is Sel => x !== null);
  const at = sel ? lines.findIndex((l) => idOf(l) === idOf(sel)) : -1;
  const step = (d: number) => setSel(lines[Math.min(lines.length - 1, Math.max(0, at + d))]);

  function decorate(block: Block, node: ReactNode) {
    const s = selOf(block);
    if (!s) return node;
    return (
      <Tappable on={sel !== null && idOf(sel) === idOf(s)} onTap={() => setSel(s)} node={node} />
    );
  }

  const { count } = hiddenItems(editor);
  return (
    <PhoneFrame>
      <Header
        editor={editor}
        extra={
          <button
            className={cn(CHIP, "text-note ml-auto flex items-center gap-1 py-1")}
            onClick={() => setZoom(!zoom)}
          >
            {zoom ? <ZoomOut className="size-3.5" /> : <ZoomIn className="size-3.5" />}
            {zoom ? "Fit Width" : "Zoom"}
          </button>
        }
      />
      <div className={cn("min-h-0 flex-1 overflow-auto px-4 pt-4", sel ? "pb-[60%]" : "pb-24")}>
        <div className={zoom ? "w-[200%]" : "w-full"}>
          <Paper state={state} rendering={rendering} decorate={decorate} />
        </div>
      </div>

      {!sel && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex gap-2 border-t border-[#ece6ff] bg-white/95 px-4 pt-2 pb-6 backdrop-blur">
          <button
            className={cn(TAP, "flex-1 ring-1 ring-[#e4dcff]")}
            onClick={() => setPanel("tray")}
          >
            Not on This Resume {count > 0 && <span className="text-ink-meta">({count})</span>}
          </button>
          <button
            className={cn(TAP, "flex-1 text-[#6d3fd8] ring-1 ring-[#e4dcff]")}
            onClick={() => setPanel("ask")}
          >
            <Sparkles className="size-4" /> Ask WorkIt
          </button>
        </div>
      )}

      <Sheet
        open={sel !== null}
        scrim={false}
        onClose={() => setSel(null)}
        title={
          <div className="flex items-center gap-1">
            <button
              aria-label="Previous line"
              className={TAP}
              disabled={at <= 0}
              onClick={() => step(-1)}
            >
              <ChevronLeft className="size-5" />
            </button>
            <span className="truncate">
              {sel?.kind === "entry" ? sel.entry.title : `Bullet · ${sel?.entry.title}`}
            </span>
            <button
              aria-label="Next line"
              className={TAP}
              disabled={at >= lines.length - 1}
              onClick={() => step(1)}
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
        }
      >
        {sel && (
          <>
            {sel.kind === "bullet" ? (
              <BulletField
                key={`${sel.bullet.id}:${bulletText(state, sel.bullet)}`}
                editor={editor}
                sel={sel}
              />
            ) : (
              <EntryFields key={sel.entry.id} editor={editor} sel={sel} />
            )}
            <LineActions editor={editor} sel={sel} onHidden={() => setSel(null)} />
            {sel.kind === "bullet" && (
              <button
                className={cn(TAP, "text-[#6d3fd8] ring-1 ring-[#e4dcff]")}
                onClick={() => setPanel("ask")}
              >
                <Sparkles className="size-4" /> Ask WorkIt About This Line
              </button>
            )}
          </>
        )}
      </Sheet>
      <Sheet open={panel === "tray"} onClose={() => setPanel(null)} title="Not on This Resume">
        <NotOnResume editor={editor} />
      </Sheet>
      <Sheet open={panel === "ask"} onClose={() => setPanel(null)} title="WorkIt Assistant">
        <Assistant editor={editor} sel={sel} />
      </Sheet>
    </PhoneFrame>
  );
}

function Tappable({ on, onTap, node }: { on: boolean; onTap: () => void; node: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useCenter(ref, on);
  return (
    <div
      ref={ref}
      onClick={onTap}
      className={cn(
        "cursor-pointer rounded-[0.4cqw] active:bg-[#f3efff]",
        on && "bg-[#f6f2ff] outline outline-[0.35cqw] outline-[#9b7bff]",
      )}
    >
      {node}
    </div>
  );
}

/** Typed wording stays on this resume (a local variant, KAN-195). Saves on a pause. */
function BulletField({ editor, sel }: { editor: Editor; sel: Extract<Sel, { kind: "bullet" }> }) {
  const { state, dispatch } = editor;
  const [text, setText] = useState(bulletText(state, sel.bullet));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const save = (t: string) =>
    t.trim() && dispatch({ type: "setWording", bullet: sel.bullet.id, text: t.trim() });
  return (
    <textarea
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        clearTimeout(timer.current);
        const t = e.target.value;
        timer.current = setTimeout(() => save(t), 800);
      }}
      onBlur={() => (clearTimeout(timer.current), save(text))}
      className={cn(FIELD, "field-sizing-content min-h-24")}
    />
  );
}

/** Title, organization, place and dates change the bank (KAN-185). */
function EntryFields({ editor, sel }: { editor: Editor; sel: Extract<Sel, { kind: "entry" }> }) {
  const { dispatch } = editor;
  const e = sel.entry;
  const edu = e.section === "Education";
  const fields = [
    ["title", edu ? "Degree" : "Title"],
    ["org", edu ? "School" : "Organization"],
    ["location", "Location"],
    ["dates", "Dates"],
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-2">
      {fields.map(([k, label]) => (
        <label
          key={k}
          className={cn("flex flex-col gap-1", (k === "title" || k === "org") && "col-span-2")}
        >
          <span className="text-note text-ink-meta">{label}</span>
          <input
            defaultValue={e[k] ?? ""}
            onBlur={(ev) =>
              ev.target.value !== (e[k] ?? "") &&
              dispatch({ type: "editEntry", id: e.id, patch: { [k]: ev.target.value } })
            }
            className={FIELD}
          />
        </label>
      ))}
    </div>
  );
}
