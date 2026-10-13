"use client";

// PROTOTYPE (KAN-195), throwaway. E: B's page-as-editor, focused on the
// resume's content. Click a line for a floating toolbar: Edit in place,
// hide, move, pick the wording, and settle an "original changed" variant.
// The assistant is a button in the corner that opens a small chat in the
// intake screen's look (KAN-193, variant G), with the selected line attached
// as context. The model is scripted: rewrites keep the same facts.

import { ArrowDown, ArrowUp, Check, EyeOff, Pencil, Send, Sparkles, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

import {
  bulletText,
  changedVariants,
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

// Scripted rewrites: same facts, new wording (the truth rule).
const REWRITE: Record<string, { shorter?: string; stronger?: string }> = {
  acme1: {
    shorter:
      "Built a TypeScript and Postgres intake service that cut check-in time from 9 to 4 minutes",
  },
  acme2: {
    shorter: "Wrote 120 Playwright integration tests, raising end-to-end coverage from 40% to 75%",
  },
  acme3: {
    shorter: "Moved a nightly batch job to an event queue, removing a 2-hour reporting delay",
    stronger:
      "Moved a nightly batch job to an event queue with two senior engineers, removing a 2-hour reporting delay",
  },
  lab1: {
    shorter: "Improved mean IoU by 6 points training PyTorch segmentation models on 40,000 images",
  },
  lab2: {
    shorter: "Built a Python pipeline that flags mislabeled images, saving the lab 5 hours a week",
  },
  lab3: {
    stronger: "Presented research results to 80 attendees at the department's spring showcase",
  },
  workit1: { shorter: "Building a Next.js, FastAPI and Postgres job platform in a team of six" },
  workit2: {
    stronger: "Designed the experience bank schema and the LaTeX resume renderer built on it",
  },
  eats1: {
    shorter: "Built a React Native app showing crowd-sourced dining-hall wait times in 24 hours",
  },
  wics1: { shorter: "Managed a $6,000 budget and raised $2,500 in hackathon sponsorship" },
  doit1: {
    stronger: "Resolved about 25 account, Wi-Fi and printing tickets a week for students and staff",
  },
};

type Sel = { kind: "entry"; entry: Entry } | { kind: "bullet"; entry: Entry; bullet: Bullet };
type Card =
  | { kind: "suggest"; bullet: string; before: string; after: string }
  | { kind: "review"; bullet: string; variant: string }
  | { kind: "fit"; count: number };
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
  const [editing, setEditing] = useState<string | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set()); // cards acted on
  const [typing, setTyping] = useState(false);
  const [open, setOpen] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const changed = changedVariants(state);
  const [msgs, setMsgs] = useState<Msg[]>(() => [
    {
      from: "workit",
      text: "Need a hand? I can fit your resume to one page, check changed bullets, or tighten a line you pick.",
    },
    ...(changed.length
      ? [
          {
            from: "workit" as const,
            text: `Heads up: you edited ${changed.length} bullets after a variant was written from them. Want to check them?`,
          },
        ]
      : []),
  ]);

  const f = fit(state);
  const label = fitLabel(f.lines);
  const selId = sel ? (sel.kind === "entry" ? sel.entry.id : sel.bullet.id) : null;

  function say(reply: Msg | Msg[], effect?: () => void) {
    setTyping(true);
    setTimeout(() => {
      effect?.();
      setTyping(false);
      setMsgs((m) => [...m, ...(Array.isArray(reply) ? reply : [reply])]);
    }, 650);
  }

  function reviewNext(skip?: string) {
    const next = changedVariants(state).find((c) => c.variant.id !== skip);
    if (!next)
      return say({ from: "workit", text: "All checked. Every variant matches its bullet again ✓" });
    say({
      from: "workit",
      text: "Your original changed after this variant was written:",
      card: { kind: "review", bullet: next.bullet.id, variant: next.variant.id },
    });
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
          card: { kind: "fit", count: ids.length },
        },
        () => dispatch({ type: "hideMany", ids }),
      );
    }
    if (t.includes("review") || t.includes("check")) return reviewNext();
    if (!bl)
      return say({
        from: "workit",
        text: "Click a line on the page first, then tell me what to change. I can shorten it, reword it, hide it or move it.",
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
    const kind =
      t.includes("short") || t.includes("concise")
        ? "shorter"
        : t.includes("strong") || t.includes("verb") || t.includes("reword")
          ? "stronger"
          : null;
    if (kind) {
      const after = REWRITE[bl.id]?.[kind];
      if (!after)
        return say({
          from: "workit",
          text:
            kind === "shorter"
              ? "That one is already tight. I'd leave it."
              : "That one already opens with a strong verb.",
        });
      return say({
        from: "workit",
        text: "Here's a version with the same facts:",
        card: { kind: "suggest", bullet: bl.id, before: bulletText(state, bl), after },
      });
    }
    if (/\d/.test(t) || t.includes("add"))
      return say({
        from: "workit",
        text: "I only use facts already in your bank. Tell me the number or tool and I'll put it in the bullet, then you approve it.",
      });
    say({
      from: "workit",
      text: "I can make it shorter, give it a stronger verb, hide it or move it. Or ask me to fit the resume to one page.",
    });
  }

  function decorate(block: Block, node: ReactNode) {
    if (block.kind !== "entry" && block.kind !== "bullet") return node;
    const id = block.kind === "entry" ? block.entry.id : block.bullet.id;
    const on = selId === id;
    const flag =
      block.kind === "bullet" &&
      block.bullet.variants.some(
        (v) => v.originalChanged && state.built.pick[block.bullet.id] === v.id,
      );
    if (block.kind === "bullet" && editing === id)
      return <InlineEdit editor={editor} bullet={block.bullet} onClose={() => setEditing(null)} />;
    return (
      <div
        className={cn(
          "relative cursor-pointer rounded-[0.4cqw] transition-colors hover:bg-[#f3efff]",
          on && "bg-[#efe9ff] outline outline-[0.25cqw] outline-[#9b7bff]",
        )}
        onClick={(ev) => {
          ev.stopPropagation();
          setSel(
            on
              ? null
              : block.kind === "entry"
                ? { kind: "entry", entry: block.entry }
                : { kind: "bullet", entry: block.entry, bullet: block.bullet },
          );
        }}
      >
        {flag && (
          <span
            className="absolute top-[0.6cqw] -left-[3cqw] size-[1.4cqw] rounded-full bg-amber-500"
            title="Original changed"
          />
        )}
        {node}
        {on && (
          <Toolbar
            editor={editor}
            sel={
              block.kind === "entry"
                ? { kind: "entry", entry: block.entry }
                : { kind: "bullet", entry: block.entry, bullet: block.bullet }
            }
            onEdit={() => setEditing(id)}
            onAsk={() => {
              setOpen(true);
              setTimeout(() => composer.current?.focus(), 50);
            }}
            onHidden={() => setSel(null)}
            onEntryEdit={() =>
              say({
                from: "workit",
                text: `${block.entry.title}'s title, place and dates live in your experience bank. This would open the entry editor there.`,
              })
            }
          />
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
      ? ["Hide it", "Move it up", "Make it shorter"]
      : [
          ...(changed.length ? ["Review changed bullets"] : []),
          ...(f.over > 0 ? ["Fit to one page"] : []),
        ];

  return (
    <div className="mx-auto max-w-3xl" onClick={() => setSel(null)}>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
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
          <div className="ml-auto flex gap-2">
            <button
              disabled={!canUndo}
              onClick={() => dispatch({ type: "undo" })}
              className={cn(CHIP, "flex items-center gap-1.5 disabled:opacity-40")}
            >
              <Undo2 className="size-3.5" /> Undo
            </button>
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

      {!open && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          className={cn(
            "text-label fixed right-5 bottom-16 z-30 flex items-center gap-2 rounded-full py-2.5 pr-4 pl-3 shadow-[0_8px_24px_-6px_rgb(109_63_216/0.6)] transition-transform hover:scale-105",
            FILL,
          )}
        >
          <Sparkles className="size-4" /> Ask WorkIt
          {changed.length > 0 && (
            <span className="text-note flex size-5 items-center justify-center rounded-full bg-amber-400 font-semibold text-[#3b2a00]">
              {changed.length}
            </span>
          )}
        </button>
      )}

      <aside
        className={cn(
          "animate-rise fixed right-5 bottom-16 z-30 flex h-[min(34rem,calc(100dvh-8rem))] w-[min(23rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-3xl bg-linear-to-b from-[#f7f4ff] to-[#fbfaff] shadow-[0_20px_50px_-12px_rgb(80_50_160/0.45)] ring-1 ring-[#ece6ff]",
          !open && "hidden",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[#ece6ff] px-4 py-3">
          <Mark />
          <span className="text-label text-ink font-semibold">WorkIt Assistant</span>
          <button
            aria-label="Minimize"
            onClick={() => setOpen(false)}
            className="ml-auto rounded-full p-1.5 text-[#8a80a8] hover:bg-[#f3efff] hover:text-[#6d3fd8]"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-5 pb-3">
          {msgs.map((m, i) => (
            <Bubble
              key={i}
              m={m}
              follows={msgs[i - 1]?.from === m.from}
              used={done.has(i)}
              editor={editor}
              onAct={(reply) => {
                setDone((d) => new Set(d).add(i));
                if (m.card?.kind === "review") reviewNext(m.card.variant);
                else if (reply) say({ from: "workit", text: reply });
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
          onClear={() => setSel(null)}
          onSend={send}
          disabled={typing}
        />
      </aside>
    </div>
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
  const { state, dispatch } = editor;
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
            <span className="text-note text-[#8a80a8]">
              Same facts, new wording. Saved as a variant, so the original stays in your bank.
            </span>
            {!used && (
              <div className="flex gap-2">
                <button
                  className={cn("text-label rounded-full px-3 py-1", FILL)}
                  onClick={() => {
                    dispatch({ type: "addVariant", bullet: c.bullet, text: c.after });
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
        {c?.kind === "review" &&
          (() => {
            const bl = state.bank.flatMap((e) => e.bullets).find((b) => b.id === c.bullet);
            const v = bl?.variants.find((x) => x.id === c.variant);
            return (
              <>
                <span className="text-meta">
                  <span className="text-note block font-semibold text-[#8a80a8]">Original Now</span>
                  {bl?.text}
                </span>
                <span className="text-meta rounded-lg bg-[#f3efff] p-2">
                  <span className="text-note block font-semibold text-[#8a80a8]">
                    Variant on This Resume
                  </span>
                  {v?.text ?? "(deleted)"}
                </span>
                {!used && v && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={CHIP}
                      onClick={() => (dispatch({ type: "keepVariant", variant: v.id }), onAct())}
                    >
                      Keep Variant
                    </button>
                    <button
                      className={CHIP}
                      onClick={() => (
                        dispatch({ type: "pick", bullet: c.bullet, variant: null }),
                        dispatch({ type: "keepVariant", variant: v.id }),
                        onAct()
                      )}
                    >
                      Use Original
                    </button>
                    <button
                      className={CHIP}
                      onClick={() => (dispatch({ type: "deleteVariant", variant: v.id }), onAct())}
                    >
                      Delete Variant
                    </button>
                  </div>
                )}
              </>
            );
          })()}
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
  onClear,
  onSend,
  disabled,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  sel: Sel | null;
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
          <span className="max-w-[15rem] truncate">
            {sel.kind === "bullet" ? sel.bullet.text : sel.entry.title}
          </span>
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

/** The floating toolbar over a selected line, in the intake screen's look. */
function Toolbar({
  editor,
  sel,
  onEdit,
  onAsk,
  onHidden,
  onEntryEdit,
}: {
  editor: Editor;
  sel: Sel;
  onEdit: () => void;
  onAsk: () => void;
  onHidden: () => void;
  onEntryEdit: () => void;
}) {
  const { state, dispatch } = editor;
  const btn =
    "text-note flex items-center gap-1 rounded-full px-2.5 py-1 text-[#4a3a7a] hover:bg-[#f3efff] disabled:opacity-30";
  const go = (f: () => void) => (e: React.MouseEvent) => (e.stopPropagation(), f());
  const entry = sel.entry;
  const flagged =
    sel.kind === "bullet"
      ? sel.bullet.variants.find(
          (v) => v.originalChanged && state.built.pick[sel.bullet.id] === v.id,
        )
      : undefined;

  return (
    <div
      className={cn(
        "absolute top-full left-0 z-10 mt-1.5 flex max-w-[34rem] flex-wrap items-center gap-0.5 bg-white p-1 font-sans shadow-[0_8px_30px_-8px_rgb(80_50_160/0.35)] ring-1 ring-[#e4dcff]",
        flagged ? "rounded-2xl" : "rounded-full",
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {sel.kind === "bullet" ? (
        <>
          <button className={cn(btn, "font-semibold text-[#6d3fd8]")} onClick={go(onEdit)}>
            <Pencil className="size-3.5" /> Edit
          </button>
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
          {sel.bullet.variants.length > 0 && (
            <>
              <span className="mx-1 h-4 w-px bg-[#e4dcff]" />
              {[null, ...sel.bullet.variants].map((v, i) => {
                const on = (state.built.pick[sel.bullet.id] ?? null) === (v?.id ?? null);
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
          <span className="mx-1 h-4 w-px bg-[#e4dcff]" />
          <button
            className={cn(btn, "text-[#6d3fd8]")}
            title="Ask WorkIt"
            aria-label="Ask WorkIt"
            onClick={go(onAsk)}
          >
            <Sparkles className="size-3.5" />
          </button>
          {flagged && (
            <div className="text-note mt-1 flex w-full flex-col gap-1.5 rounded-xl bg-amber-50 p-2.5 text-[#5c4a1a]">
              <span className="font-semibold">
                You changed the original after this version was written.
              </span>
              <span>
                <span className="text-[#8a7a50]">Original now: </span>
                {sel.bullet.text}
              </span>
              <div className="flex flex-wrap gap-1">
                <button
                  className={btn}
                  onClick={go(() => dispatch({ type: "keepVariant", variant: flagged.id }))}
                >
                  Keep This Version
                </button>
                <button
                  className={btn}
                  onClick={go(() => {
                    dispatch({ type: "pick", bullet: sel.bullet.id, variant: null });
                    dispatch({ type: "keepVariant", variant: flagged.id });
                  })}
                >
                  Use Original
                </button>
                <button
                  className={btn}
                  onClick={go(() => dispatch({ type: "deleteVariant", variant: flagged.id }))}
                >
                  Delete Version
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <button className={btn} onClick={go(onEntryEdit)}>
            <Pencil className="size-3.5" /> Edit Entry
          </button>
          <button
            className={btn}
            onClick={go(() => (dispatch({ type: "toggleEntry", id: entry.id }), onHidden()))}
          >
            <EyeOff className="size-3.5" /> Hide Entry
          </button>
          <button
            className={btn}
            aria-label="Move up"
            disabled={state.built.order[entry.section][0] === entry.id}
            onClick={go(() => dispatch({ type: "moveEntry", id: entry.id, by: -1 }))}
          >
            <ArrowUp className="size-3.5" />
          </button>
          <button
            className={btn}
            aria-label="Move down"
            disabled={state.built.order[entry.section].at(-1) === entry.id}
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
    </div>
  );
}

/** Edit a bullet in place. The student picks where the new words go. */
function InlineEdit({
  editor,
  bullet,
  onClose,
}: {
  editor: Editor;
  bullet: Bullet;
  onClose: () => void;
}) {
  const { state, dispatch } = editor;
  const [text, setText] = useState(bulletText(state, bullet));
  const usedBy = 2; // fixture: how many built resumes show this bullet
  return (
    <div
      className="relative z-10 my-[0.5cqw] flex flex-col gap-2 rounded-2xl bg-white p-3 font-sans shadow-[0_8px_30px_-8px_rgb(80_50_160/0.35)] ring-2 ring-[#b9a6f0]"
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="text-body text-ink field-sizing-content w-full resize-none rounded-xl bg-[#f8f6ff] px-3 py-2 outline-none focus:bg-white"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={cn("text-label rounded-full px-3 py-1", FILL)}
          onClick={() => (dispatch({ type: "addVariant", bullet: bullet.id, text }), onClose())}
        >
          Use on This Resume Only
        </button>
        <button
          className={CHIP}
          onClick={() => (dispatch({ type: "editBullet", bullet: bullet.id, text }), onClose())}
        >
          Update Everywhere
        </button>
        <button className="text-label px-2 text-[#8a80a8] hover:text-[#6d3fd8]" onClick={onClose}>
          Cancel
        </button>
      </div>
      <span className="text-note text-[#8a80a8]">
        &ldquo;This resume only&rdquo; saves a new version beside the original.
        &ldquo;Everywhere&rdquo; changes your experience bank and the {usedBy} resumes that show
        this bullet.
      </span>
    </div>
  );
}
