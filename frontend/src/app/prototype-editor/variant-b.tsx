"use client";

// PROTOTYPE (KAN-195), throwaway. B: the page is the editor. Click an entry
// or bullet on the sheet for a small toolbar (hide, move, wording). What is
// hidden waits in a tray under the page. Risk this layout carries: the real
// preview is a PDF, so every click target must be laid over it from
// positions the renderer reports.

import { ArrowDown, ArrowUp, EyeOff, Undo2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import {
  fit,
  fitSuggestion,
  orderedBullets,
  unusedEntries,
  useRendered,
  type Block,
  type Editor,
} from "./model";
import { fitLabel, Paper } from "./paper";

export const NAME = "Edit on the page";

export function VariantB({ editor }: { editor: Editor }) {
  const { state, dispatch, canUndo } = editor;
  const { rendering } = useRendered(state);
  const [selected, setSelected] = useState<string | null>(null);
  const f = fit(state);
  const label = fitLabel(f.lines);

  const hiddenBullets = state.bank.flatMap((e) =>
    state.built.order[e.section].includes(e.id)
      ? orderedBullets(state, e)
          .filter((bl) => state.built.hidden.includes(bl.id))
          .map((bl) => ({ e, bl }))
      : [],
  );
  const unused = unusedEntries(state);

  function decorate(block: Block, node: ReactNode) {
    if (block.kind !== "entry" && block.kind !== "bullet") return node;
    const id = block.kind === "entry" ? block.entry.id : block.bullet.id;
    const isSel = selected === id;
    const changed = block.kind === "bullet" && block.bullet.variants.some((v) => v.originalChanged);
    return (
      <div
        className={cn(
          "relative cursor-pointer rounded-[0.4cqw] outline-offset-[0.3cqw] hover:outline hover:outline-[0.25cqw] hover:outline-violet-300",
          isSel && "outline outline-[0.3cqw] outline-violet-500",
        )}
        onClick={(ev) => {
          ev.stopPropagation();
          setSelected(isSel ? null : id);
        }}
      >
        {changed && (
          <span
            className="absolute top-[0.6cqw] -left-[3cqw] size-[1.4cqw] rounded-full bg-amber-500"
            title="Original changed"
          />
        )}
        {node}
        {isSel && <Toolbar editor={editor} block={block} onDone={() => setSelected(null)} />}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" onClick={() => setSelected(null)}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={label.tone}>{label.text}</Badge>
        {f.over > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => dispatch({ type: "hideMany", ids: fitSuggestion(state) })}
          >
            Fit to One Page
          </Button>
        )}
        <span className="text-meta text-ink-meta">Click anything on the page to change it.</span>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!canUndo}
            onClick={() => dispatch({ type: "undo" })}
          >
            <Undo2 /> Undo
          </Button>
          <Button size="sm">Download PDF</Button>
        </div>
      </div>

      <Paper state={state} rendering={rendering} decorate={decorate} />

      <section className="bg-panel shadow-card rounded-card mt-6 p-4">
        <h2 className="text-label text-ink-muted mb-2">Not on This Resume</h2>
        {!hiddenBullets.length && !unused.length && (
          <p className="text-meta text-ink-meta">Everything in your bank is showing.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {unused.map((e) => (
            <button
              key={e.id}
              onClick={() => dispatch({ type: "toggleEntry", id: e.id })}
              className="text-meta border-border-subtle hover:bg-hover rounded-lg border border-dashed px-2.5 py-1.5 text-left"
            >
              + {e.title} <span className="text-ink-meta">· {e.section}</span>
            </button>
          ))}
          {hiddenBullets.map(({ e, bl }) => (
            <button
              key={bl.id}
              onClick={() => dispatch({ type: "toggleBullet", id: bl.id })}
              className="text-meta border-border-subtle hover:bg-hover max-w-full rounded-lg border border-dashed px-2.5 py-1.5 text-left"
            >
              + <span className="text-ink-meta">{e.title}:</span> {bl.text.slice(0, 70)}…
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function Toolbar({ editor, block, onDone }: { editor: Editor; block: Block; onDone: () => void }) {
  const { state, dispatch } = editor;
  const stop = (f: () => void) => (ev: React.MouseEvent) => {
    ev.stopPropagation();
    f();
  };
  const bar =
    "absolute left-0 top-full z-10 mt-1 flex flex-wrap items-center gap-1 rounded-lg bg-neutral-900 p-1 text-white shadow-lg font-sans";
  const btn = "text-note flex items-center gap-1 rounded-md px-2 py-1 hover:bg-white/15";

  if (block.kind === "entry") {
    const e = block.entry;
    const list = state.built.order[e.section];
    return (
      <div className={bar} onClick={(ev) => ev.stopPropagation()}>
        <button
          className={btn}
          onClick={stop(() => (dispatch({ type: "toggleEntry", id: e.id }), onDone()))}
        >
          <EyeOff className="size-3.5" /> Hide Entry
        </button>
        <button
          className={btn}
          disabled={list[0] === e.id}
          onClick={stop(() => dispatch({ type: "moveEntry", id: e.id, by: -1 }))}
        >
          <ArrowUp className="size-3.5" /> Up
        </button>
        <button
          className={btn}
          disabled={list.at(-1) === e.id}
          onClick={stop(() => dispatch({ type: "moveEntry", id: e.id, by: 1 }))}
        >
          <ArrowDown className="size-3.5" /> Down
        </button>
        {e.section === "Education" && (
          <>
            <button className={btn} onClick={stop(() => dispatch({ type: "toggleGpa" }))}>
              {state.built.showGpa ? "Hide" : "Show"} GPA
            </button>
            <button className={btn} onClick={stop(() => dispatch({ type: "toggleCoursework" }))}>
              {state.built.showCoursework ? "Hide" : "Show"} Coursework
            </button>
          </>
        )}
      </div>
    );
  }
  if (block.kind !== "bullet") return null;
  const { bullet: bl, entry } = block;
  const order = state.built.bulletOrder[entry.id];
  const changed = bl.variants.filter((v) => v.originalChanged);
  return (
    <div className={cn(bar, "max-w-[36rem]")} onClick={(ev) => ev.stopPropagation()}>
      <button
        className={btn}
        onClick={stop(() => (dispatch({ type: "toggleBullet", id: bl.id }), onDone()))}
      >
        <EyeOff className="size-3.5" /> Hide
      </button>
      <button
        className={btn}
        disabled={order[0] === bl.id}
        onClick={stop(() => dispatch({ type: "moveBullet", entry: entry.id, id: bl.id, by: -1 }))}
      >
        <ArrowUp className="size-3.5" />
      </button>
      <button
        className={btn}
        disabled={order.at(-1) === bl.id}
        onClick={stop(() => dispatch({ type: "moveBullet", entry: entry.id, id: bl.id, by: 1 }))}
      >
        <ArrowDown className="size-3.5" />
      </button>
      {bl.variants.length > 0 && (
        <>
          <span className="mx-1 h-4 w-px bg-white/30" />
          <button
            className={cn(btn, !state.built.pick[bl.id] && "bg-white/20")}
            onClick={stop(() => dispatch({ type: "pick", bullet: bl.id, variant: null }))}
          >
            Original
          </button>
          {bl.variants.map((v, i) => (
            <button
              key={v.id}
              className={cn(btn, state.built.pick[bl.id] === v.id && "bg-white/20")}
              onClick={stop(() => dispatch({ type: "pick", bullet: bl.id, variant: v.id }))}
              title={v.posting}
            >
              Variant {i + 1}
            </button>
          ))}
        </>
      )}
      {changed.map((v) => (
        <div key={v.id} className="text-note mt-1 w-full rounded-md bg-amber-500/20 p-2">
          <div className="font-medium text-amber-200">
            Original changed since this variant was written
          </div>
          <div className="mt-1 opacity-80">Original: {bl.text}</div>
          <div className="mt-0.5 opacity-80">Variant: {v.text}</div>
          <div className="mt-1.5 flex gap-1">
            <button
              className={btn}
              onClick={stop(() => dispatch({ type: "keepVariant", variant: v.id }))}
            >
              Keep Variant
            </button>
            <button
              className={btn}
              onClick={stop(() => dispatch({ type: "deleteVariant", variant: v.id }))}
            >
              Delete Variant
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
