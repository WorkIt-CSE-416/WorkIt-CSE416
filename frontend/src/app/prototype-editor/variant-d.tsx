"use client";

// PROTOTYPE (KAN-195), throwaway. D: one running list of everything, in
// resume order, with a "Page 1 ends here" line dropped where the PDF breaks.
// Hidden rows stay in place, greyed. A queue at the top walks through
// "original changed" variants one at a time. The PDF is a thumbnail.

import { ArrowDown, ArrowUp, Eye, EyeOff, Maximize2, Plus, Undo2, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import {
  bulletText,
  changedVariants,
  entryById,
  fit,
  fitSuggestion,
  orderedBullets,
  paginate,
  SECTIONS,
  unusedEntries,
  useRendered,
  type Editor,
} from "./model";
import { fitLabel, Paper } from "./paper";

export const NAME = "One list with the page line";

type Row = { key: string; page: number; node: ReactNode };

export function VariantD({ editor }: { editor: Editor }) {
  const { state, dispatch, canUndo } = editor;
  const { rendered, rendering } = useRendered(state);
  const [big, setBig] = useState(false);
  const [qi, setQi] = useState(0);
  const f = fit(state);
  const label = fitLabel(f.lines);

  // Which page each shown entry and bullet lands on.
  const pageOf = new Map<string, number>();
  paginate(state).forEach((page, p) =>
    page.forEach((bl) => {
      if (bl.kind === "entry") pageOf.set(bl.entry.id, p);
      if (bl.kind === "bullet") pageOf.set(bl.bullet.id, p);
      if (bl.kind === "section") pageOf.set(`s:${bl.section}`, p);
    }),
  );

  const rows: Row[] = [];
  let lastPage = 0;
  for (const section of SECTIONS) {
    if (section === "Skills") {
      rows.push({
        key: "skills",
        page: pageOf.get("s:Skills") ?? lastPage,
        node: <SectionRow title="Skills" note={`${state.skills.length} lines`} />,
      });
      continue;
    }
    const ids = state.built.order[section];
    const unused = unusedEntries(state).filter((e) => e.section === section);
    if (!ids.length && !unused.length) continue;
    const sp = pageOf.get(`s:${section}`) ?? lastPage;
    rows.push({ key: section, page: sp, node: <SectionRow title={section} /> });
    lastPage = sp;
    ids.forEach((id, i) => {
      const e = entryById(state, id);
      const ep = pageOf.get(id) ?? lastPage;
      lastPage = ep;
      rows.push({
        key: id,
        page: ep,
        node: (
          <Line
            indent={0}
            text={<b className="font-medium">{e.title}</b>}
            meta={e.org}
            hidden={false}
            onToggle={() => dispatch({ type: "toggleEntry", id })}
            onUp={i > 0 ? () => dispatch({ type: "moveEntry", id, by: -1 }) : undefined}
            onDown={
              i < ids.length - 1 ? () => dispatch({ type: "moveEntry", id, by: 1 }) : undefined
            }
          />
        ),
      });
      orderedBullets(state, e).forEach((bl) => {
        const hidden = state.built.hidden.includes(bl.id);
        const bp = hidden ? lastPage : (pageOf.get(bl.id) ?? lastPage);
        lastPage = bp;
        const changed = bl.variants.some(
          (v) => v.originalChanged && state.built.pick[bl.id] === v.id,
        );
        rows.push({
          key: bl.id,
          page: bp,
          node: (
            <Line
              indent={1}
              text={bulletText(state, bl)}
              hidden={hidden}
              flag={changed}
              wording={
                bl.variants.length > 0 && !hidden ? (
                  <button
                    className="text-note text-brand hover:underline"
                    onClick={() => {
                      const opts = [null, ...bl.variants.map((v) => v.id)];
                      const cur = opts.indexOf(state.built.pick[bl.id] ?? null);
                      dispatch({
                        type: "pick",
                        bullet: bl.id,
                        variant: opts[(cur + 1) % opts.length],
                      });
                    }}
                  >
                    {state.built.pick[bl.id]
                      ? `Variant ${bl.variants.findIndex((v) => v.id === state.built.pick[bl.id]) + 1}`
                      : "Original"}{" "}
                    · Switch
                  </button>
                ) : undefined
              }
              onToggle={() => dispatch({ type: "toggleBullet", id: bl.id })}
              onUp={() => dispatch({ type: "moveBullet", entry: e.id, id: bl.id, by: -1 })}
              onDown={() => dispatch({ type: "moveBullet", entry: e.id, id: bl.id, by: 1 })}
            />
          ),
        });
      });
      if (e.section === "Education")
        rows.push({
          key: "edu-opts",
          page: ep,
          node: (
            <div className="text-meta text-ink-muted flex gap-4 py-1 pl-8">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={state.built.showGpa}
                  onChange={() => dispatch({ type: "toggleGpa" })}
                />{" "}
                GPA
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={state.built.showCoursework}
                  onChange={() => dispatch({ type: "toggleCoursework" })}
                />{" "}
                Coursework
              </label>
            </div>
          ),
        });
    });
    unused.forEach((e) =>
      rows.push({
        key: e.id,
        page: lastPage,
        node: (
          <button
            onClick={() => dispatch({ type: "toggleEntry", id: e.id })}
            className="text-meta text-ink-meta hover:text-brand flex items-center gap-1.5 py-1 pl-2"
          >
            <Plus className="size-3.5" /> Add {e.title} from your bank
          </button>
        ),
      }),
    );
  }

  const queue = changedVariants(state).filter(
    (c) => state.built.pick[c.bullet.id] === c.variant.id,
  );
  const cur = queue[Math.min(qi, queue.length - 1)];

  return (
    <div className="grid gap-6 @3xl/main:grid-cols-[minmax(0,1fr)_220px]">
      <div className="flex min-w-0 flex-col gap-3">
        {cur && (
          <div className="rounded-card border border-amber-300 bg-amber-50 p-3">
            <div className="flex items-center gap-2">
              <span className="text-label text-ink">
                Check {queue.length === 1 ? "1 bullet" : `${queue.length} bullets`}: you changed the
                original after this variant was written
              </span>
              <span className="text-note text-ink-meta ml-auto">
                {Math.min(qi, queue.length - 1) + 1} of {queue.length}
              </span>
            </div>
            <div className="mt-2 grid gap-2 @xl/main:grid-cols-2">
              <div className="text-meta rounded-md bg-white p-2">
                <div className="text-note text-ink-meta">Original Now</div>
                {cur.bullet.text}
              </div>
              <div className="text-meta rounded-md bg-white p-2">
                <div className="text-note text-ink-meta">
                  Variant on This Resume{cur.variant.posting && ` · for ${cur.variant.posting}`}
                </div>
                {cur.variant.text}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => dispatch({ type: "keepVariant", variant: cur.variant.id })}
              >
                Keep Variant
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => dispatch({ type: "pick", bullet: cur.bullet.id, variant: null })}
              >
                Use Original
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => dispatch({ type: "deleteVariant", variant: cur.variant.id })}
              >
                Delete Variant
              </Button>
              {queue.length > 1 && (
                <Button size="sm" variant="ghost" onClick={() => setQi((qi + 1) % queue.length)}>
                  Later
                </Button>
              )}
            </div>
          </div>
        )}

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

        <div className="bg-panel shadow-card rounded-card p-2">
          {rows.map((r, i) => (
            <div key={r.key}>
              {i > 0 && r.page > rows[i - 1].page && (
                <div className="my-1 flex items-center gap-2 px-2">
                  <span className="h-0 flex-1 border-t-2 border-dashed border-red-400" />
                  <span className="text-caption text-red-500 uppercase">
                    Page {r.page} ends here
                  </span>
                  <span className="h-0 flex-1 border-t-2 border-dashed border-red-400" />
                </div>
              )}
              <div className={cn(r.page > 0 && "opacity-55")}>{r.node}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="hidden @3xl/main:block">
        <div className="sticky top-4">
          <button className="group relative block w-full" onClick={() => setBig(true)}>
            <Paper state={rendered} rendering={rendering} />
            <span className="absolute top-2 right-2 rounded-md bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100">
              <Maximize2 className="size-4" />
            </span>
          </button>
          <p className="text-note text-ink-meta mt-6">
            {rendering ? "Rendering…" : "Click to enlarge."}
          </p>
        </div>
      </div>
      <Button className="@3xl/main:hidden" variant="secondary" onClick={() => setBig(true)}>
        Preview PDF
      </Button>

      {big && (
        <div
          className="fixed inset-0 z-40 overflow-y-auto bg-black/50 p-4"
          onClick={() => setBig(false)}
        >
          <div className="relative mx-auto max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <Button
              className="absolute -top-1 -right-1 z-10"
              size="icon-sm"
              variant="secondary"
              aria-label="Close"
              onClick={() => setBig(false)}
            >
              <X />
            </Button>
            <Paper state={rendered} rendering={rendering} />
          </div>
        </div>
      )}
    </div>
  );
}

function SectionRow({ title, note }: { title: string; note?: string }) {
  return (
    <div className="text-caption text-ink-meta flex px-2 pt-3 pb-1 uppercase">
      {title}
      {note && <span className="ml-auto normal-case">{note}</span>}
    </div>
  );
}

function Line({
  indent,
  text,
  meta,
  hidden,
  flag,
  wording,
  onToggle,
  onUp,
  onDown,
}: {
  indent: number;
  text: ReactNode;
  meta?: string;
  hidden: boolean;
  flag?: boolean;
  wording?: ReactNode;
  onToggle: () => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  return (
    <div
      className={cn(
        "group hover:bg-hover flex items-start gap-1 rounded-md px-2 py-1",
        indent && "pl-8",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className={cn("text-meta", hidden ? "text-ink-faint line-through" : "text-ink")}>
          {flag && <span className="mr-1.5 inline-block size-2 rounded-full bg-amber-500" />}
          {text}
          {meta && <span className="text-ink-meta"> · {meta}</span>}
        </div>
        {wording}
      </div>
      <span className="flex flex-none opacity-40 group-hover:opacity-100">
        <Button
          size="icon-xs"
          variant="section"
          aria-label={hidden ? "Show" : "Hide"}
          onClick={onToggle}
        >
          {hidden ? <EyeOff /> : <Eye />}
        </Button>
        <Button
          size="icon-xs"
          variant="section"
          aria-label="Move up"
          disabled={!onUp || hidden}
          onClick={onUp}
        >
          <ArrowUp />
        </Button>
        <Button
          size="icon-xs"
          variant="section"
          aria-label="Move down"
          disabled={!onDown || hidden}
          onClick={onDown}
        >
          <ArrowDown />
        </Button>
      </span>
    </div>
  );
}
