"use client";

// PROTOTYPE (KAN-195), throwaway. E: the page is the editor, and editing is
// the default. Click a bullet and type; click an entry's heading and type in
// its title, place or dates. A small toolbar under the line hides, moves and
// switches wording. The assistant is a button; opened, it docks beside the
// page and never covers it. Look follows the intake screen (KAN-193, G).
// The model is scripted: a shorter version keeps the same facts.

import { ArrowDown, ArrowUp, Check, EyeOff, Send, Sparkles, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

import {
  bulletText,
  fit,
  fitSuggestion,
  orderedBullets,
  unusedEntries,
  useRendered,
  type Block,
  type Bullet,
  type Editor,
  type Entry,
} from "./model";
import { fitLabel, Paper } from "./paper";

export const NAME = "Page plus assistant";

const PURPLE = "text-[#6d3fd8]";
const FILL = "bg-linear-to-br from-[#7c4dff] to-[#6d3fd8] text-white";
const CHIP =
  "text-label rounded-full bg-white px-3 py-1.5 text-[#6d3fd8] ring-1 ring-[#e4dcff] transition-colors hover:bg-[#f3efff]";
// A field that looks like the page it sits on. Weight is left to the
// caller: the font shorthand would reset a bold title to normal.
const ON_PAGE =
  "w-full min-w-0 resize-none bg-transparent p-0 font-normal outline-none [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit]";

// Scripted: same facts, fewer words (the truth rule).
const SHORTER: Record<string, string> = {
  acme1:
    "Built a TypeScript and Postgres intake service that cut check-in time from 9 to 4 minutes",
  acme2: "Wrote 120 Playwright integration tests, raising end-to-end coverage from 40% to 75%",
  acme3: "Moved a nightly batch job to an event queue, removing a 2-hour reporting delay",
  lab1: "Improved mean IoU by 6 points training PyTorch segmentation models on 40,000 images",
  lab2: "Built a Python pipeline that flags mislabeled images, saving the lab 5 hours a week",
  workit1: "Building a Next.js, FastAPI and Postgres job platform in a team of six",
  eats1: "Built a React Native app showing crowd-sourced dining-hall wait times in 24 hours",
  wics1: "Managed a $6,000 budget and raised $2,500 in hackathon sponsorship",
};

type Sel = { kind: "entry"; entry: Entry } | { kind: "bullet"; entry: Entry; bullet: Bullet };
type Card = { kind: "suggest"; bullet: string; before: string; after: string } | { kind: "fit" };
type Msg = { from: "workit" | "student"; text: string; card?: Card };

function Mark() {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-[#7c4dff] to-[#b388ff] text-white shadow-[0_4px_12px_rgb(124_77_255/0.35)]">
      <Sparkles className="size-3.5" />
    </span>
  );
}

export function VariantE({ editor }: { editor: Editor }) {
  const { state, dispatch, canUndo } = editor;
  const { rendering } = useRendered(state);
  const [sel, setSel] = useState<Sel | null>(null);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Set<number>>(new Set()); // cards acted on
  const [typing, setTyping] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      from: "workit",
      text: "Need a hand? I can fit your resume to one page, or tighten a line you pick.",
    },
  ]);

  const f = fit(state);
  const label = fitLabel(f.lines);
  const selId = sel ? (sel.kind === "entry" ? sel.entry.id : sel.bullet.id) : null;

  function say(reply: Msg, effect?: () => void) {
    setTyping(true);
    setTimeout(() => {
      effect?.();
      setTyping(false);
      setMsgs((m) => [...m, reply]);
    }, 650);
  }

  function send(text: string) {
    if (!text.trim()) return;
    setMsgs((m) => [...m, { from: "student", text }]);
    const t = text.toLowerCase();
    const bl = sel?.kind === "bullet" ? sel.bullet : null;

    if (t.includes("one page") || t.includes("fit")) {
      const ids = fitSuggestion(state);
      if (!ids.length) return say({ from: "workit", text: "It already fits on one page 🎉" });
      return say(
        {
          from: "workit",
          text: `I hid ${ids.length} bullets from your oldest entries. It fits on one page now.`,
          card: { kind: "fit" },
        },
        () => dispatch({ type: "hideMany", ids }),
      );
    }
    if (!bl)
      return say({
        from: "workit",
        text: "Click a line on the page first, then tell me what to change.",
      });
    if (t.includes("hide") || t.includes("remove"))
      return say(
        { from: "workit", text: "Hidden. It waits under the page if you want it back." },
        () => {
          dispatch({ type: "toggleBullet", id: bl.id });
          setSel(null);
        },
      );
    if (t.includes("up") || t.includes("down")) {
      const by = t.includes("up") ? -1 : 1;
      return say({ from: "workit", text: `Moved it ${by < 0 ? "up" : "down"}.` }, () =>
        dispatch({ type: "moveBullet", entry: sel!.entry.id, id: bl.id, by }),
      );
    }
    if (t.includes("short") || t.includes("concise")) {
      const after = SHORTER[bl.id];
      if (!after) return say({ from: "workit", text: "That one is already tight. I'd leave it." });
      return say({
        from: "workit",
        text: "Here's a shorter version with the same facts:",
        card: { kind: "suggest", bullet: bl.id, before: bulletText(state, bl), after },
      });
    }
    say({
      from: "workit",
      text: "I can make a line shorter, hide it or move it, or fit the resume to one page. To change words yourself, just type on the page.",
    });
  }

  function decorate(block: Block, node: ReactNode) {
    if (block.kind !== "entry" && block.kind !== "bullet") return node;
    const id = block.kind === "entry" ? block.entry.id : block.bullet.id;
    const on = selId === id;
    const pick = (): Sel =>
      block.kind === "entry"
        ? { kind: "entry", entry: block.entry }
        : { kind: "bullet", entry: block.entry, bullet: block.bullet };
    return (
      <div
        className={cn(
          "relative cursor-text rounded-[0.4cqw] transition-colors hover:bg-[#f3efff]",
          on && "bg-[#f6f2ff] outline outline-[0.25cqw] outline-[#9b7bff] hover:bg-[#f6f2ff]",
        )}
        onClick={(ev) => {
          ev.stopPropagation();
          if (!on) setSel(pick());
        }}
      >
        {!on ? (
          node
        ) : block.kind === "bullet" ? (
          // Keyed on the wording too, so picking a version refills the field.
          <BulletField
            key={`${id}:${bulletText(state, block.bullet)}`}
            editor={editor}
            bullet={block.bullet}
          />
        ) : (
          <EntryFields key={id} editor={editor} entry={block.entry} />
        )}
      </div>
    );
  }

  const hiddenBullets = state.bank.flatMap((e) =>
    state.built.order[e.section].includes(e.id)
      ? orderedBullets(state, e)
          .filter((b) => state.built.hidden.includes(b.id))
          .map((b) => ({ e, b }))
      : [],
  );

  const quick =
    sel?.kind === "bullet"
      ? ["Make it shorter", "Hide it", "Move it up"]
      : f.over > 0
        ? ["Fit to one page"]
        : [];

  return (
    <div
      className={cn(
        "grid items-start gap-5",
        open ? "@4xl/main:grid-cols-[minmax(0,1fr)_22rem]" : "mx-auto max-w-3xl",
      )}
      onClick={() => setSel(null)}
    >
      <div className="flex min-w-0 flex-col gap-4">
        {/* Sticky above the page, so the actions for a line never cover
            the lines around it. */}
        <div
          className="sticky top-2 z-20 flex min-h-12 flex-wrap items-center gap-2 rounded-2xl bg-white/95 p-1.5 pl-2 shadow-[0_8px_30px_-12px_rgb(80_50_160/0.3)] ring-1 ring-[#ece6ff] backdrop-blur"
          onClick={(e) => e.stopPropagation()}
        >
          {sel ? (
            <>
              <span className="text-note max-w-[12rem] truncate font-semibold text-[#8a80a8]">
                {sel.kind === "bullet" ? "Bullet" : sel.entry.title}
              </span>
              <Toolbar
                editor={editor}
                sel={sel}
                onHidden={() => setSel(null)}
                onAsk={() => {
                  setOpen(true);
                  setTimeout(() => composer.current?.focus(), 50);
                }}
              />
              <button className={cn(CHIP, "py-1")} onClick={() => setSel(null)}>
                Done
              </button>
            </>
          ) : (
            <>
              <span
                className={cn(
                  "text-label flex items-center gap-1.5 rounded-full px-3 py-1.5",
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
                  className={CHIP}
                  onClick={() => dispatch({ type: "hideMany", ids: fitSuggestion(state) })}
                >
                  Fit to One Page
                </button>
              )}
            </>
          )}
          <div className="ml-auto flex gap-2">
            <button
              disabled={!canUndo}
              aria-label="Undo"
              title="Undo"
              onClick={() => dispatch({ type: "undo" })}
              className={cn(CHIP, "flex items-center gap-1.5 disabled:opacity-40")}
            >
              <Undo2 className="size-3.5" />
            </button>
            {!open && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(true);
                }}
                className={cn(CHIP, "flex items-center gap-1.5")}
              >
                <Sparkles className="size-3.5" /> Ask WorkIt
              </button>
            )}
            <button
              className={cn(
                "text-label rounded-full px-4 py-1.5 shadow-[0_4px_12px_-4px_rgb(109_63_216/0.6)]",
                FILL,
              )}
            >
              Download PDF
            </button>
          </div>
        </div>

        <Paper state={state} rendering={rendering} decorate={decorate} />

        {(hiddenBullets.length > 0 || unusedEntries(state).length > 0) && (
          <section className="mt-6 rounded-3xl bg-[#f7f4ff] p-4 ring-1 ring-[#ece6ff]">
            <h2 className={cn("text-label mb-2 font-semibold", PURPLE)}>Not on This Resume</h2>
            <div className="flex flex-wrap gap-2">
              {unusedEntries(state).map((e) => (
                <button
                  key={e.id}
                  onClick={() => dispatch({ type: "toggleEntry", id: e.id })}
                  className={CHIP}
                >
                  + {e.title}
                </button>
              ))}
              {hiddenBullets.map(({ e, b }) => (
                <button
                  key={b.id}
                  onClick={() => dispatch({ type: "toggleBullet", id: b.id })}
                  className={cn(CHIP, "max-w-full truncate text-left")}
                >
                  + <span className="text-[#8a80a8]">{e.title}:</span> {b.text.slice(0, 60)}…
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {open && (
        <aside
          className="animate-rise flex h-[min(40rem,calc(100dvh-8rem))] min-h-[24rem] flex-col overflow-hidden rounded-3xl bg-linear-to-b from-[#f7f4ff] to-[#fbfaff] ring-1 ring-[#ece6ff] @4xl/main:sticky @4xl/main:top-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 border-b border-[#ece6ff] px-4 py-3">
            <Mark />
            <span className="text-label text-ink font-semibold">WorkIt Assistant</span>
            <button
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="ml-auto rounded-full p-1.5 text-[#8a80a8] hover:bg-[#f3efff] hover:text-[#6d3fd8]"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-4 pb-3">
            {msgs.map((m, i) => (
              <Bubble
                key={i}
                m={m}
                follows={msgs[i - 1]?.from === m.from}
                used={done.has(i)}
                editor={editor}
                onAct={(reply) => {
                  setDone((d) => new Set(d).add(i));
                  if (reply) say({ from: "workit", text: reply });
                }}
              />
            ))}
            {typing && (
              <div className="flex items-end gap-2">
                <Mark />
                <span className="flex h-9 items-center gap-1 rounded-2xl rounded-bl-md bg-white px-4 shadow-[0_1px_3px_rgb(80_50_160/0.08)]">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="animate-typing size-1.5 rounded-full bg-[#b9a6f0]"
                      style={{ animationDelay: `${d * 160}ms` }}
                    />
                  ))}
                </span>
              </div>
            )}
            {!typing && quick.length > 0 && (
              <div className="flex flex-wrap gap-2 pl-9">
                {quick.map((q) => (
                  <button key={q} onClick={() => send(q)} className={CHIP}>
                    {q}
                  </button>
                ))}
              </div>
            )}
            <ScrollEnd dep={msgs.length + (typing ? 1 : 0)} />
          </div>
          <Composer
            inputRef={composer}
            sel={sel}
            text={(s) => (s.kind === "bullet" ? bulletText(state, s.bullet) : s.entry.title)}
            onClear={() => setSel(null)}
            onSend={send}
            disabled={typing}
          />
        </aside>
      )}
    </div>
  );
}

/** A bullet you type into, in the page's own type. Saves when you leave it. */
function BulletField({ editor, bullet }: { editor: Editor; bullet: Bullet }) {
  const { state, dispatch } = editor;
  const [text, setText] = useState(bulletText(state, bullet));
  const save = () =>
    text.trim() && dispatch({ type: "setWording", bullet: bullet.id, text: text.trim() });
  return (
    <div className="flex" style={{ paddingLeft: "3.5cqw", fontSize: "1.55cqw" }}>
      <span style={{ width: "2cqw", flex: "none" }}>•</span>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        onFocus={(e) => e.currentTarget.setSelectionRange(text.length, text.length)}
        className={cn(ON_PAGE, "field-sizing-content")}
      />
    </div>
  );
}

/** An entry's heading as fields laid out like the page. Saves to the bank. */
function EntryFields({ editor, entry }: { editor: Editor; entry: Entry }) {
  const { state, dispatch } = editor;
  const edu = entry.section === "Education";
  const one = entry.section === "Awards" || entry.section === "Certifications";
  const field = (
    key: "title" | "org" | "location" | "dates",
    placeholder: string,
    cls?: string,
    auto?: boolean,
  ) => (
    <Field
      key={key}
      autoFocus={auto}
      initial={entry[key] ?? ""}
      placeholder={placeholder}
      className={cls}
      onSave={(v) => dispatch({ type: "editEntry", id: entry.id, patch: { [key]: v } })}
    />
  );
  if (one)
    return (
      <div className="flex justify-between gap-[2cqw]" style={{ paddingLeft: "1.5cqw" }}>
        <span className="flex flex-1 gap-[0.5cqw]">
          {field("title", "Title", "font-bold", true)}
          {field("org", "Organization")}
        </span>
        {field("dates", "Date", "text-right max-w-[22cqw]")}
      </div>
    );
  return (
    <div style={{ paddingLeft: "1.5cqw" }}>
      <div className="flex justify-between gap-[2cqw]">
        {edu
          ? field("org", "School", "font-bold", true)
          : field("title", "Title", "font-bold", true)}
        {field("dates", "Dates", "text-right max-w-[26cqw]")}
      </div>
      <div className="flex justify-between gap-[2cqw] italic" style={{ fontSize: "1.55cqw" }}>
        {edu ? (
          // Everything the page shows stays visible while editing.
          <span className="flex flex-1 items-baseline gap-[0.6cqw]">
            {field("title", "Degree", "w-auto field-sizing-content")}
            {state.built.showGpa && (
              <>
                <span className="flex-none">· GPA</span>
                <Field
                  initial={entry.gpa ?? ""}
                  placeholder="3.7 / 4.0"
                  className="max-w-[14cqw]"
                  onSave={(v) => dispatch({ type: "editEntry", id: entry.id, patch: { gpa: v } })}
                />
              </>
            )}
          </span>
        ) : (
          field("org", "Organization")
        )}
        {field("location", "Location", "text-right max-w-[26cqw]")}
      </div>
      {edu && state.built.showCoursework && (
        <div className="flex gap-[0.6cqw]" style={{ fontSize: "1.55cqw" }}>
          <b className="flex-none">Relevant Coursework:</b>
          <Field
            initial={(entry.coursework ?? []).join(", ")}
            placeholder="Courses, separated by commas"
            onSave={(v) =>
              dispatch({
                type: "editEntry",
                id: entry.id,
                patch: {
                  coursework: v
                    .split(",")
                    .map((c) => c.trim())
                    .filter(Boolean),
                },
              })
            }
          />
        </div>
      )}
    </div>
  );
}

function Field({
  initial,
  placeholder,
  className,
  autoFocus,
  onSave,
}: {
  initial: string;
  placeholder: string;
  className?: string;
  autoFocus?: boolean;
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <input
      autoFocus={autoFocus}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== initial && onSave(v)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={cn(
        ON_PAGE,
        "rounded-[0.3cqw] placeholder:text-[#b4b0c4] focus:bg-white focus:shadow-[0_0_0_0.3cqw_#e4dcff]",
        className,
      )}
    />
  );
}

function ScrollEnd({ dep }: { dep: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [dep]);
  return <div ref={ref} />;
}

function Bubble({
  m,
  follows,
  used,
  editor,
  onAct,
}: {
  m: Msg;
  follows: boolean;
  used: boolean;
  editor: Editor;
  onAct: (reply?: string) => void;
}) {
  const { dispatch } = editor;
  if (m.from === "student")
    return (
      <p
        className={cn(
          "animate-rise text-body max-w-[85%] self-end rounded-2xl rounded-br-md px-3.5 py-2",
          FILL,
        )}
      >
        {m.text}
      </p>
    );
  const c = m.card;
  return (
    <div className={cn("animate-rise flex items-end gap-2", follows && "-mt-1.5")}>
      {follows ? <span className="w-7 shrink-0" /> : <Mark />}
      <div className="text-body text-ink flex max-w-[88%] flex-col gap-2 rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 shadow-[0_1px_3px_rgb(80_50_160/0.08)]">
        <span>{m.text}</span>
        {c?.kind === "suggest" && (
          <>
            <span className="text-meta text-[#8a80a8] line-through">{c.before}</span>
            <span className="text-meta rounded-lg bg-[#f3efff] p-2">{c.after}</span>
            {!used && (
              <div className="flex gap-2">
                <button
                  className={cn("text-label rounded-full px-3 py-1", FILL)}
                  onClick={() => {
                    dispatch({ type: "setWording", bullet: c.bullet, text: c.after });
                    onAct("Done! It's on the page now.");
                  }}
                >
                  Use This
                </button>
                <button className={CHIP} onClick={() => onAct("No problem, I kept your wording.")}>
                  Keep Mine
                </button>
              </div>
            )}
          </>
        )}
        {c?.kind === "fit" && !used && (
          <button
            className={cn(CHIP, "self-start")}
            onClick={() => (dispatch({ type: "undo" }), onAct("Undone. Everything is back."))}
          >
            Undo
          </button>
        )}
      </div>
    </div>
  );
}

function Composer({
  inputRef,
  sel,
  text: selText,
  onClear,
  onSend,
  disabled,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  sel: Sel | null;
  text: (s: Sel) => string;
  onClear: () => void;
  onSend: (t: string) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  return (
    <form
      className="m-3 mt-0 flex flex-col gap-1.5 rounded-2xl bg-white p-2 shadow-[0_4px_20px_-6px_rgb(80_50_160/0.2)] ring-1 ring-[#ece6ff] focus-within:ring-2 focus-within:ring-[#b9a6f0]"
      onSubmit={(e) => {
        e.preventDefault();
        onSend(text);
        setText("");
      }}
    >
      {sel && (
        <span className="text-note flex items-center gap-1.5 self-start rounded-lg bg-[#f3efff] py-1 pr-1 pl-2 text-[#6d3fd8]">
          <span className="max-w-[15rem] truncate">{selText(sel)}</span>
          <button
            type="button"
            aria-label="Clear selection"
            onClick={onClear}
            className="rounded p-0.5 hover:bg-white"
          >
            <X className="size-3" />
          </button>
        </span>
      )}
      <div className="flex items-end gap-2 pl-2">
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={sel ? "What should change?" : "Ask WorkIt, or click a line…"}
          className="text-body text-ink placeholder:text-ink-meta field-sizing-content max-h-28 min-h-8 w-full resize-none bg-transparent py-1.5 outline-none"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={disabled || !text.trim()}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-xl disabled:opacity-35",
            FILL,
          )}
        >
          <Send className="size-4" />
        </button>
      </div>
    </form>
  );
}

/** The small toolbar under a selected line: hide, move, wording, assistant. */
function Toolbar({
  editor,
  sel,
  onHidden,
  onAsk,
}: {
  editor: Editor;
  sel: Sel;
  onHidden: () => void;
  onAsk: () => void;
}) {
  const { state, dispatch } = editor;
  const btn =
    "text-note flex items-center gap-1 rounded-full px-2.5 py-1 text-[#4a3a7a] hover:bg-[#f3efff] disabled:opacity-30";
  const go = (f: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    f();
  };
  const entry = sel.entry;
  const list = state.built.order[entry.section];
  // Tailor's versions only; wording typed on the page is not a choice here.
  const versions = sel.kind === "bullet" ? sel.bullet.variants.filter((v) => !v.local) : [];
  const current = sel.kind === "bullet" ? state.built.pick[sel.bullet.id] : undefined;

  return (
    <div
      className="flex flex-wrap items-center gap-0.5 rounded-full bg-[#f7f4ff] p-0.5"
      // Keeps focus in the field, so a click here does not save and re-render first.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      {sel.kind === "bullet" ? (
        <>
          <button
            className={btn}
            onClick={go(() => (dispatch({ type: "toggleBullet", id: sel.bullet.id }), onHidden()))}
          >
            <EyeOff className="size-3.5" /> Hide
          </button>
          <button
            className={btn}
            aria-label="Move up"
            onClick={go(() =>
              dispatch({ type: "moveBullet", entry: entry.id, id: sel.bullet.id, by: -1 }),
            )}
          >
            <ArrowUp className="size-3.5" />
          </button>
          <button
            className={btn}
            aria-label="Move down"
            onClick={go(() =>
              dispatch({ type: "moveBullet", entry: entry.id, id: sel.bullet.id, by: 1 }),
            )}
          >
            <ArrowDown className="size-3.5" />
          </button>
          {versions.length > 0 && (
            <>
              <span className="mx-1 h-4 w-px bg-[#e4dcff]" />
              {[null, ...versions].map((v, i) => {
                const on = (current ?? null) === (v?.id ?? null);
                return (
                  <button
                    key={v?.id ?? "orig"}
                    title={v?.posting}
                    className={cn(btn, on && "bg-[#efe9ff] font-semibold text-[#6d3fd8]")}
                    onClick={go(() =>
                      dispatch({ type: "pick", bullet: sel.bullet.id, variant: v?.id ?? null }),
                    )}
                  >
                    {v ? `Version ${i}` : "Original"}
                  </button>
                );
              })}
            </>
          )}
        </>
      ) : (
        <>
          <button
            className={btn}
            onClick={go(() => (dispatch({ type: "toggleEntry", id: entry.id }), onHidden()))}
          >
            <EyeOff className="size-3.5" /> Hide Entry
          </button>
          <button
            className={btn}
            aria-label="Move up"
            disabled={list[0] === entry.id}
            onClick={go(() => dispatch({ type: "moveEntry", id: entry.id, by: -1 }))}
          >
            <ArrowUp className="size-3.5" />
          </button>
          <button
            className={btn}
            aria-label="Move down"
            disabled={list.at(-1) === entry.id}
            onClick={go(() => dispatch({ type: "moveEntry", id: entry.id, by: 1 }))}
          >
            <ArrowDown className="size-3.5" />
          </button>
          {entry.section === "Education" && (
            <>
              <button className={btn} onClick={go(() => dispatch({ type: "toggleGpa" }))}>
                {state.built.showGpa ? "Hide" : "Show"} GPA
              </button>
              <button className={btn} onClick={go(() => dispatch({ type: "toggleCoursework" }))}>
                {state.built.showCoursework ? "Hide" : "Show"} Coursework
              </button>
            </>
          )}
        </>
      )}
      <span className="mx-1 h-4 w-px bg-[#e4dcff]" />
      <button
        className={cn(btn, "text-[#6d3fd8]")}
        title="Ask WorkIt"
        aria-label="Ask WorkIt"
        onClick={go(onAsk)}
      >
        <Sparkles className="size-3.5" />
      </button>
    </div>
  );
}
