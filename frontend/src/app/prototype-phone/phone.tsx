"use client";

// PROTOTYPE (KAN-201), throwaway. What every phone layout shares: a 390 x 844
// device on a desktop screen (the whole screen on a real phone, sized to the
// visual viewport so a bar stays above the keyboard), a bottom sheet, the
// header, the line actions and a scripted assistant.

import { ArrowDown, ArrowUp, Check, EyeOff, Send, Sparkles, Undo2, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { cn } from "@/lib/cn";

import {
  bulletText,
  fit,
  fitSuggestion,
  orderedBullets,
  unusedEntries,
  type Bullet,
  type Editor,
  type Entry,
} from "../prototype-editor/model";
import { fitLabel } from "../prototype-editor/paper";
import { SHORTER } from "../prototype-editor/variant-e";

export const PURPLE = "text-[#6d3fd8]";
export const FILL = "bg-linear-to-br from-[#7c4dff] to-[#6d3fd8] text-white";
export const CHIP =
  "text-label rounded-full bg-white px-3 py-1.5 text-[#6d3fd8] ring-1 ring-[#e4dcff] transition-colors hover:bg-[#f3efff]";
/** 44 pt, Apple's touch target. */
export const TAP =
  "text-label flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-2xl px-3 text-[#4a3a7a] active:bg-[#efe9ff] disabled:opacity-30";
/** 16 px: below this, iOS Safari zooms the page when the field gets focus. */
export const FIELD =
  "w-full resize-none rounded-xl bg-white px-3 py-2.5 text-[16px] leading-6 text-ink outline-none ring-1 ring-[#e4dcff] focus:ring-2 focus:ring-[#9b7bff]";

export type Sel =
  { kind: "entry"; entry: Entry } | { kind: "bullet"; entry: Entry; bullet: Bullet };

// ---------------------------------------------------------------------------
// The device.

function subscribe(cb: () => void) {
  const vv = window.visualViewport;
  vv?.addEventListener("resize", cb);
  vv?.addEventListener("scroll", cb);
  window.addEventListener("resize", cb);
  return () => {
    vv?.removeEventListener("resize", cb);
    vv?.removeEventListener("scroll", cb);
    window.removeEventListener("resize", cb);
  };
}
const snapshot = () => {
  const vv = window.visualViewport;
  return `${window.innerWidth}|${vv?.height ?? window.innerHeight}|${vv?.offsetTop ?? 0}`;
};

export function PhoneFrame({ children }: { children: ReactNode }) {
  const snap = useSyncExternalStore(subscribe, snapshot, () => "1000|844|0");
  const [w, h, top] = snap.split("|").map(Number);
  const real = w < 500;
  return (
    <div className={cn(!real && "flex min-h-dvh items-center justify-center bg-[#e9e6f2] py-14")}>
      <div
        className={cn(
          "bg-app @container/main relative flex flex-col overflow-hidden",
          real
            ? "fixed inset-x-0 top-0"
            : "h-[844px] w-[390px] rounded-[2.75rem] shadow-[0_30px_80px_-20px_rgb(40_20_90/0.45)] ring-[10px] ring-black",
        )}
        style={real ? { height: h, transform: `translateY(${top}px)` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

/** A panel that slides up from the bottom edge of the device. */
export function Sheet({
  open,
  onClose,
  title,
  scrim = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Off for a sheet that leaves the page above it usable. */
  scrim?: boolean;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      {scrim && <div className="absolute inset-0 z-30 bg-black/25" onClick={onClose} />}
      <div className="animate-rise absolute inset-x-0 bottom-0 z-40 flex max-h-[78%] flex-col rounded-t-3xl bg-[#fbfaff] shadow-[0_-12px_40px_-12px_rgb(40_20_90/0.35)] ring-1 ring-[#ece6ff]">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-[#d9d2ee]" />
        <div className="flex items-center gap-2 px-4 pt-1">
          <div className="text-label min-w-0 flex-1 truncate font-semibold text-[#8a80a8]">
            {title}
          </div>
          <button aria-label="Close" onClick={onClose} className={TAP}>
            <X className="size-5" />
          </button>
        </div>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pb-4">{children}</div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The header: resume name, page fit, undo, download.

export function Header({ editor, extra }: { editor: Editor; extra?: ReactNode }) {
  const { state, dispatch, canUndo } = editor;
  const f = fit(state);
  const label = fitLabel(f.lines);
  return (
    <div className="z-20 flex flex-col gap-2 border-b border-[#ece6ff] bg-white/95 px-4 pt-12 pb-2 backdrop-blur">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <div className="text-subtitle text-ink truncate">Software Engineering</div>
          <div className="text-note text-ink-meta">Base Resume</div>
        </div>
        <button
          aria-label="Undo"
          disabled={!canUndo}
          onClick={() => dispatch({ type: "undo" })}
          className={TAP}
        >
          <Undo2 className="size-5" />
        </button>
        <button className={cn("text-label min-h-11 rounded-full px-4", FILL)}>Download</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "text-note flex items-center gap-1 rounded-full px-2.5 py-1",
            label.tone === "positive"
              ? "bg-[#e3f7f0] text-[#107a52]"
              : "bg-amber-50 text-amber-700",
          )}
        >
          {label.tone === "positive" && <Check className="size-3.5" />}
          {label.text}
        </span>
        {f.over > 0 && (
          <button
            className={cn(CHIP, "text-note py-1")}
            onClick={() => dispatch({ type: "hideMany", ids: fitSuggestion(state) })}
          >
            Fit to One Page
          </button>
        )}
        {extra}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Line actions at touch size: hide, move, Tailor's versions.

export function LineActions({
  editor,
  sel,
  onHidden,
}: {
  editor: Editor;
  sel: Sel;
  onHidden: () => void;
}) {
  const { state, dispatch } = editor;
  const entry = sel.entry;
  const list = state.built.order[entry.section];
  if (sel.kind === "entry")
    return (
      <div className="flex flex-wrap gap-1 rounded-2xl bg-[#f3efff] p-1">
        <button
          className={TAP}
          onClick={() => (dispatch({ type: "toggleEntry", id: entry.id }), onHidden())}
        >
          <EyeOff className="size-4" /> Hide Entry
        </button>
        <button
          className={TAP}
          aria-label="Move up"
          disabled={list[0] === entry.id}
          onClick={() => dispatch({ type: "moveEntry", id: entry.id, by: -1 })}
        >
          <ArrowUp className="size-5" />
        </button>
        <button
          className={TAP}
          aria-label="Move down"
          disabled={list.at(-1) === entry.id}
          onClick={() => dispatch({ type: "moveEntry", id: entry.id, by: 1 })}
        >
          <ArrowDown className="size-5" />
        </button>
        {entry.section === "Education" && (
          <>
            <button className={TAP} onClick={() => dispatch({ type: "toggleGpa" })}>
              {state.built.showGpa ? "Hide" : "Show"} GPA
            </button>
            <button className={TAP} onClick={() => dispatch({ type: "toggleCoursework" })}>
              {state.built.showCoursework ? "Hide" : "Show"} Coursework
            </button>
          </>
        )}
      </div>
    );

  const b = sel.bullet;
  const versions = b.variants.filter((v) => !v.local);
  const current = state.built.pick[b.id] ?? null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 rounded-2xl bg-[#f3efff] p-1">
        <button
          className={TAP}
          onClick={() => (dispatch({ type: "toggleBullet", id: b.id }), onHidden())}
        >
          <EyeOff className="size-4" /> Hide
        </button>
        <button
          className={TAP}
          aria-label="Move up"
          onClick={() => dispatch({ type: "moveBullet", entry: entry.id, id: b.id, by: -1 })}
        >
          <ArrowUp className="size-5" />
        </button>
        <button
          className={TAP}
          aria-label="Move down"
          onClick={() => dispatch({ type: "moveBullet", entry: entry.id, id: b.id, by: 1 })}
        >
          <ArrowDown className="size-5" />
        </button>
      </div>
      {versions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {[null, ...versions].map((v, i) => {
            const on = current === (v?.id ?? null);
            return (
              <button
                key={v?.id ?? "orig"}
                onClick={() => dispatch({ type: "pick", bullet: b.id, variant: v?.id ?? null })}
                className={cn(
                  TAP,
                  "ring-1 ring-[#e4dcff]",
                  on && "bg-[#efe9ff] font-semibold text-[#6d3fd8] ring-[#b9a6f0]",
                )}
              >
                {v ? `Version ${i}` : "Original"}
                {v?.posting && (
                  <span className="text-meta text-ink-meta font-normal">
                    {v.posting.split(" · ")[0]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Not on This Resume": hidden bullets and entries the resume does not show.

export function hiddenItems(editor: Editor) {
  const { state } = editor;
  const bullets = state.bank.flatMap((e) =>
    state.built.order[e.section].includes(e.id)
      ? orderedBullets(state, e)
          .filter((b) => state.built.hidden.includes(b.id))
          .map((b) => ({ e, b }))
      : [],
  );
  return {
    bullets,
    entries: unusedEntries(state),
    count: bullets.length + unusedEntries(state).length,
  };
}

export function NotOnResume({ editor }: { editor: Editor }) {
  const { dispatch } = editor;
  const { bullets, entries, count } = hiddenItems(editor);
  if (!count) return <p className="text-body text-ink-meta">Everything is on this resume.</p>;
  return (
    <div className="flex flex-col gap-1">
      {entries.map((e) => (
        <button
          key={e.id}
          onClick={() => dispatch({ type: "toggleEntry", id: e.id })}
          className={cn(TAP, "justify-start text-left ring-1 ring-[#ece6ff]")}
        >
          <span className={PURPLE}>+</span> {e.title}
          <span className="text-note text-ink-meta">{e.section}</span>
        </button>
      ))}
      {bullets.map(({ e, b }) => (
        <button
          key={b.id}
          onClick={() => dispatch({ type: "toggleBullet", id: b.id })}
          className={cn(TAP, "justify-start py-2 text-left ring-1 ring-[#ece6ff]")}
        >
          <span className={PURPLE}>+</span>
          <span className="line-clamp-2">
            <span className="text-ink-meta">{e.title}:</span> {b.text}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The assistant, scripted: fit, hide, move and one "Make it shorter".

type Msg = {
  from: "workit" | "student";
  text: string;
  suggest?: { bullet: string; after: string };
};

export function Assistant({ editor, sel }: { editor: Editor; sel: Sel | null }) {
  const { state, dispatch } = editor;
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      from: "workit",
      text: sel
        ? "What should change on this line?"
        : "Need a hand? I can fit your resume to one page, or tighten a line you pick.",
    },
  ]);
  const [text, setText] = useState("");
  const [used, setUsed] = useState<Set<number>>(new Set());
  const bl = sel?.kind === "bullet" ? sel.bullet : null;

  function send(t: string) {
    if (!t.trim()) return;
    const q = t.toLowerCase();
    const reply = (m: Msg) => setTimeout(() => setMsgs((xs) => [...xs, m]), 500);
    setMsgs((xs) => [...xs, { from: "student", text: t }]);
    if (q.includes("fit") || q.includes("one page")) {
      const ids = fitSuggestion(state);
      if (!ids.length) return reply({ from: "workit", text: "It already fits on one page 🎉" });
      dispatch({ type: "hideMany", ids });
      return reply({
        from: "workit",
        text: `I hid ${ids.length} bullets from your oldest entries.`,
      });
    }
    if (!bl) return reply({ from: "workit", text: "Tap a line on the resume first." });
    if (q.includes("short")) {
      const after = SHORTER[bl.id];
      return reply(
        after
          ? { from: "workit", text: "Same facts, fewer words:", suggest: { bullet: bl.id, after } }
          : { from: "workit", text: "That one is already tight. I'd leave it." },
      );
    }
    reply({ from: "workit", text: "I can make a line shorter, or fit the resume to one page." });
  }

  const quick = bl ? ["Make it shorter"] : fit(state).over > 0 ? ["Fit to one page"] : [];
  return (
    <div className="flex flex-col gap-3">
      {msgs.map((m, i) =>
        m.from === "student" ? (
          <p
            key={i}
            className={cn(
              "text-body max-w-[85%] self-end rounded-2xl rounded-br-md px-3.5 py-2",
              FILL,
            )}
          >
            {m.text}
          </p>
        ) : (
          <div
            key={i}
            className="text-body text-ink flex max-w-[92%] flex-col gap-2 rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 shadow-[0_1px_3px_rgb(80_50_160/0.08)]"
          >
            <span className="flex gap-2">
              <Sparkles className={cn("mt-0.5 size-4 shrink-0", PURPLE)} />
              {m.text}
            </span>
            {m.suggest && bl && (
              <>
                <span className="text-note text-[#8a80a8] line-through">
                  {bulletText(state, bl)}
                </span>
                <span className="text-note rounded-lg bg-[#f3efff] p-2">{m.suggest.after}</span>
                {!used.has(i) && (
                  <button
                    className={cn("text-label min-h-11 rounded-full px-4", FILL)}
                    onClick={() => {
                      dispatch({
                        type: "setWording",
                        bullet: m.suggest!.bullet,
                        text: m.suggest!.after,
                      });
                      setUsed((u) => new Set(u).add(i));
                    }}
                  >
                    Use This
                  </button>
                )}
              </>
            )}
          </div>
        ),
      )}
      {quick.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {quick.map((q) => (
            <button key={q} className={cn(CHIP, "min-h-11")} onClick={() => send(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
          setText("");
        }}
      >
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask WorkIt…"
          className={cn(FIELD, "field-sizing-content max-h-28")}
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!text.trim()}
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-35",
            FILL,
          )}
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}

/** Scrolls a node into the middle of its scroller when `on` turns true. */
export function useCenter(ref: React.RefObject<HTMLElement | null>, on: boolean) {
  useEffect(() => {
    if (on) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [on, ref]);
}
