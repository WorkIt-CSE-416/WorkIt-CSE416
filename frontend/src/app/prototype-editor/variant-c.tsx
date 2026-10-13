"use client";

// PROTOTYPE (KAN-195), throwaway. C: two shelves, "On This Resume" and "In
// Your Bank", with every item's line cost printed on it and a page budget bar
// on top. The PDF opens in a drawer on demand. "Original changed" variants
// are reviewed in one step before download, not inline.

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, FileText, Undo2, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import {
  blocks,
  bulletText,
  changedVariants,
  entryById,
  fitSuggestion,
  LINES_PER_PAGE,
  orderedBullets,
  SECTIONS,
  unusedEntries,
  useRendered,
  type Editor,
  type Entry,
} from "./model";
import { fitLabel, Paper } from "./paper";

export const NAME = "Shelves and a page budget";

const BULLET_CHARS = 108;
const cost = (text: string) => Math.ceil(text.length / BULLET_CHARS);

export function VariantC({ editor }: { editor: Editor }) {
  const { state, dispatch, canUndo } = editor;
  const { rendered, rendering } = useRendered(state);
  const [drawer, setDrawer] = useState(false);
  const [review, setReview] = useState(false);

  const all = blocks(state);
  const lines = all.reduce((n, x) => n + x.lines, 0);
  const label = fitLabel(lines);
  const toReview = changedVariants(state).filter(
    (c) =>
      state.built.pick[c.bullet.id] === c.variant.id && !state.built.hidden.includes(c.bullet.id),
  );

  // Section lines for the budget bar.
  const bySection = SECTIONS.map((s) => {
    let n = 0;
    let on = false;
    for (const bl of all) {
      if (bl.kind === "section") on = bl.section === s;
      if (on) n += bl.lines;
    }
    return { s, n };
  }).filter((x) => x.n > 0);
  const scale = Math.max(lines, LINES_PER_PAGE) * 1.05;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-panel shadow-card rounded-card sticky top-2 z-20 flex flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={label.tone}>{label.text}</Badge>
          {lines > LINES_PER_PAGE && (
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
            <Button size="sm" variant="secondary" onClick={() => setDrawer(true)}>
              <FileText /> Preview PDF
            </Button>
            <Button size="sm" onClick={() => setReview(true)}>
              Download PDF
            </Button>
          </div>
        </div>
        <div className="relative flex h-6 w-full overflow-hidden rounded-md bg-neutral-100">
          {bySection.map(({ s, n }, i) => (
            <div
              key={s}
              title={`${s}: ${n} lines`}
              className={cn(
                "text-note flex items-center overflow-hidden px-1 whitespace-nowrap text-white",
                i % 2 ? "bg-violet-400" : "bg-violet-600",
              )}
              style={{ width: `${(n / scale) * 100}%` }}
            >
              {s}
            </div>
          ))}
          <div
            className="absolute inset-y-0 border-l-2 border-dashed border-neutral-900"
            style={{ left: `${(LINES_PER_PAGE / scale) * 100}%` }}
          />
        </div>
        <div className="text-note text-ink-meta">
          The dashed line is the end of page 1. Each item shows how many lines it takes.
        </div>
      </div>

      <div className="grid gap-4 @3xl/main:grid-cols-2">
        <Shelf title="On This Resume">
          {SECTIONS.filter((s) => s !== "Skills").map((section) => {
            const ids = state.built.order[section];
            if (!ids.length) return null;
            return (
              <div key={section} className="flex flex-col gap-2">
                <h3 className="text-caption text-ink-meta uppercase">{section}</h3>
                {ids.map((id, i) => (
                  <OnCard
                    key={id}
                    editor={editor}
                    entry={entryById(state, id)}
                    first={i === 0}
                    last={i === ids.length - 1}
                  />
                ))}
                {section === "Education" && (
                  <div className="text-meta text-ink-muted flex gap-4">
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
                      Coursework · 1 line
                    </label>
                  </div>
                )}
              </div>
            );
          })}
          <h3 className="text-caption text-ink-meta uppercase">Skills</h3>
          <p className="text-meta text-ink-muted">
            {state.skills.length} groups · {state.skills.length} lines
          </p>
        </Shelf>

        <Shelf title="In Your Bank, Not Shown">
          {unusedEntries(state).map((e) => (
            <div
              key={e.id}
              className="border-border-subtle flex items-center gap-2 rounded-lg border border-dashed p-2"
            >
              <Button
                size="icon-sm"
                variant="secondary"
                aria-label="Add to resume"
                onClick={() => dispatch({ type: "toggleEntry", id: e.id })}
              >
                <ArrowLeft />
              </Button>
              <div className="min-w-0">
                <div className="text-body text-ink">{e.title}</div>
                <div className="text-note text-ink-meta">
                  {e.section} · {2 + e.bullets.reduce((n, bl) => n + cost(bl.text), 0)} lines
                </div>
              </div>
            </div>
          ))}
          {state.bank
            .filter((e) => state.built.order[e.section].includes(e.id))
            .flatMap((e) =>
              orderedBullets(state, e)
                .filter((bl) => state.built.hidden.includes(bl.id))
                .map((bl) => ({ e, bl })),
            )
            .map(({ e, bl }) => (
              <div
                key={bl.id}
                className="border-border-subtle flex items-start gap-2 rounded-lg border border-dashed p-2"
              >
                <Button
                  size="icon-sm"
                  variant="secondary"
                  aria-label="Show bullet"
                  onClick={() => dispatch({ type: "toggleBullet", id: bl.id })}
                >
                  <ArrowLeft />
                </Button>
                <div className="min-w-0">
                  <div className="text-meta text-ink-muted">{bl.text}</div>
                  <div className="text-note text-ink-meta">
                    Bullet of {e.title} · {cost(bl.text)} line{cost(bl.text) > 1 && "s"}
                  </div>
                </div>
              </div>
            ))}
        </Shelf>
      </div>

      {drawer && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/30"
          onClick={() => setDrawer(false)}
        >
          <div
            className="bg-app h-full w-full max-w-xl overflow-y-auto p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center">
              <span className="text-title text-ink">{rendering ? "Rendering…" : "Preview"}</span>
              <Button
                className="ml-auto"
                size="icon-sm"
                variant="section"
                aria-label="Close"
                onClick={() => setDrawer(false)}
              >
                <X />
              </Button>
            </div>
            <Paper state={rendered} rendering={rendering} />
          </div>
        </div>
      )}

      {review && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setReview(false)}
        >
          <div
            className="bg-panel rounded-card shadow-panel w-full max-w-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-title text-ink">Before You Download</h2>
            {!toReview.length ? (
              <p className="text-body text-ink-muted mt-2">
                Nothing to check.{" "}
                {lines > LINES_PER_PAGE &&
                  "Your resume runs past one page; that is fine if you meant it."}
              </p>
            ) : (
              <>
                <p className="text-body text-ink-muted mt-1">
                  You edited {toReview.length === 1 ? "a bullet" : `${toReview.length} bullets`}{" "}
                  after a variant was written from it. Check the wording this resume uses.
                </p>
                <div className="mt-3 flex flex-col gap-3">
                  {toReview.map(({ bullet, variant }) => (
                    <div key={variant.id} className="bg-app rounded-lg p-3">
                      <div className="grid gap-3 @xl/main:grid-cols-2">
                        <div>
                          <div className="text-caption text-ink-meta uppercase">
                            Original (Changed)
                          </div>
                          <div className="text-meta text-ink">{bullet.text}</div>
                        </div>
                        <div>
                          <div className="text-caption text-ink-meta uppercase">
                            Variant on This Resume
                          </div>
                          <div className="text-meta text-ink">{variant.text}</div>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => dispatch({ type: "keepVariant", variant: variant.id })}
                        >
                          Keep Variant
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            dispatch({ type: "pick", bullet: bullet.id, variant: null })
                          }
                        >
                          Use Original Here
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => dispatch({ type: "deleteVariant", variant: variant.id })}
                        >
                          Delete Variant
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setReview(false)}>
                Back
              </Button>
              <Button disabled={toReview.length > 0} onClick={() => setReview(false)}>
                Download PDF
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Shelf({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-panel shadow-card rounded-card flex flex-col gap-3 p-4">
      <h2 className="text-subtitle text-ink">{title}</h2>
      {children}
    </section>
  );
}

function OnCard({
  editor,
  entry,
  first,
  last,
}: {
  editor: Editor;
  entry: Entry;
  first: boolean;
  last: boolean;
}) {
  const { state, dispatch } = editor;
  const shown = orderedBullets(state, entry).filter((bl) => !state.built.hidden.includes(bl.id));
  return (
    <div className="border-border-subtle rounded-lg border p-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-body text-ink font-medium">{entry.title}</div>
          <div className="text-note text-ink-meta">
            {entry.org} · {entry.section === "Awards" || entry.section === "Certifications" ? 1 : 2}{" "}
            lines
          </div>
        </div>
        <Button
          size="icon-xs"
          variant="section"
          aria-label="Move up"
          disabled={first}
          onClick={() => dispatch({ type: "moveEntry", id: entry.id, by: -1 })}
        >
          <ArrowUp />
        </Button>
        <Button
          size="icon-xs"
          variant="section"
          aria-label="Move down"
          disabled={last}
          onClick={() => dispatch({ type: "moveEntry", id: entry.id, by: 1 })}
        >
          <ArrowDown />
        </Button>
        <Button
          size="icon-xs"
          variant="section"
          aria-label="Take off resume"
          onClick={() => dispatch({ type: "toggleEntry", id: entry.id })}
        >
          <ArrowRight />
        </Button>
      </div>
      {shown.map((bl, i) => (
        <div key={bl.id} className="mt-2 flex items-start gap-1.5 border-t border-neutral-100 pt-2">
          <div className="min-w-0 flex-1">
            <div className="text-meta text-ink-muted">{bulletText(state, bl)}</div>
            <div className="text-note text-ink-meta flex flex-wrap items-center gap-2">
              {cost(bulletText(state, bl))} line{cost(bulletText(state, bl)) > 1 && "s"}
              {bl.variants.length > 0 && (
                <select
                  className="bg-app rounded px-1"
                  value={state.built.pick[bl.id] ?? ""}
                  onChange={(e) =>
                    dispatch({ type: "pick", bullet: bl.id, variant: e.target.value || null })
                  }
                >
                  <option value="">Original Wording</option>
                  {bl.variants.map((v, j) => (
                    <option key={v.id} value={v.id}>
                      Variant {j + 1}
                      {v.originalChanged ? " (original changed)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <Button
            size="icon-xs"
            variant="section"
            aria-label="Move up"
            disabled={i === 0}
            onClick={() => dispatch({ type: "moveBullet", entry: entry.id, id: bl.id, by: -1 })}
          >
            <ArrowUp />
          </Button>
          <Button
            size="icon-xs"
            variant="section"
            aria-label="Move down"
            disabled={i === shown.length - 1}
            onClick={() => dispatch({ type: "moveBullet", entry: entry.id, id: bl.id, by: 1 })}
          >
            <ArrowDown />
          </Button>
          <Button
            size="icon-xs"
            variant="section"
            aria-label="Hide bullet"
            onClick={() => dispatch({ type: "toggleBullet", id: bl.id })}
          >
            <ArrowRight />
          </Button>
        </div>
      ))}
    </div>
  );
}
