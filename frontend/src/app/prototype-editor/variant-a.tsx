"use client";

// PROTOTYPE (KAN-195), throwaway. A: an outline of the whole bank with a
// checkbox on every entry and bullet, beside a sticky PDF. Reorder with
// arrows; the variant picker and "original changed" sit under each bullet.

import { ArrowDown, ArrowUp, Undo2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import {
  bulletText,
  entryById,
  fit,
  fitSuggestion,
  orderedBullets,
  SECTIONS,
  unusedEntries,
  useRendered,
  type Bullet,
  type Editor,
  type Entry,
} from "./model";
import { fitLabel, Paper } from "./paper";

export const NAME = "Outline beside the PDF";

export function VariantA({ editor }: { editor: Editor }) {
  const { state, dispatch, canUndo } = editor;
  const { rendered, rendering } = useRendered(state);
  const f = fit(rendered);
  const label = fitLabel(f.lines);
  const [tab, setTab] = useState<"edit" | "preview">("edit");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={label.tone}>{rendering ? "Rendering…" : label.text}</Badge>
        {f.over > 0 && !rendering && (
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

      {/* Phone: one pane at a time. */}
      <div className="flex gap-1 @3xl/main:hidden">
        {(["edit", "preview"] as const).map((t) => (
          <Button
            key={t}
            size="sm"
            variant={tab === t ? "default" : "secondary"}
            onClick={() => setTab(t)}
          >
            {t === "edit" ? "Edit" : "Preview"}
          </Button>
        ))}
      </div>

      <div className="grid gap-6 @3xl/main:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className={cn("flex flex-col gap-5", tab === "preview" && "hidden @3xl/main:flex")}>
          {SECTIONS.map((section) => {
            if (section === "Skills")
              return (
                <Group key={section} title="Skills">
                  <p className="text-meta text-ink-meta">
                    Every skill in the bank shows, one line per group.
                  </p>
                </Group>
              );
            const shown = state.built.order[section].map((id) => entryById(state, id));
            const unused = unusedEntries(state).filter((e) => e.section === section);
            if (!shown.length && !unused.length) return null;
            return (
              <Group key={section} title={section}>
                {shown.map((e, i) => (
                  <EntryRow
                    key={e.id}
                    editor={editor}
                    entry={e}
                    first={i === 0}
                    last={i === shown.length - 1}
                  />
                ))}
                {unused.map((e) => (
                  <label
                    key={e.id}
                    className="text-body text-ink-meta flex items-center gap-2 px-2 py-1"
                  >
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => dispatch({ type: "toggleEntry", id: e.id })}
                    />
                    {e.title} {e.org && <span>· {e.org}</span>}
                  </label>
                ))}
                {section === "Education" && (
                  <div className="text-meta text-ink-muted flex gap-4 px-2">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={state.built.showGpa}
                        onChange={() => dispatch({ type: "toggleGpa" })}
                      />{" "}
                      Show GPA
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={state.built.showCoursework}
                        onChange={() => dispatch({ type: "toggleCoursework" })}
                      />{" "}
                      Show Coursework
                    </label>
                  </div>
                )}
              </Group>
            );
          })}
        </div>

        <div className={cn("@3xl/main:block", tab === "edit" && "hidden")}>
          <div className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto pb-8">
            <Paper state={rendered} rendering={rendering} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-panel shadow-card rounded-card flex flex-col gap-1 p-3">
      <h2 className="text-label text-ink-muted mb-1 px-2">{title}</h2>
      {children}
    </section>
  );
}

function EntryRow({
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
  const bullets = orderedBullets(state, entry);
  return (
    <div className="hover:bg-hover rounded-lg px-2 py-1.5">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked
          onChange={() => dispatch({ type: "toggleEntry", id: entry.id })}
        />
        <span className="text-body text-ink font-medium">{entry.title}</span>
        <span className="text-meta text-ink-meta truncate">{entry.org}</span>
        <Arrows
          up={!first ? () => dispatch({ type: "moveEntry", id: entry.id, by: -1 }) : undefined}
          down={!last ? () => dispatch({ type: "moveEntry", id: entry.id, by: 1 }) : undefined}
        />
      </div>
      <div className="mt-1 flex flex-col gap-1 pl-6">
        {bullets.map((bl, i) => (
          <BulletRow
            key={bl.id}
            editor={editor}
            entry={entry}
            bullet={bl}
            up={
              i > 0
                ? () => dispatch({ type: "moveBullet", entry: entry.id, id: bl.id, by: -1 })
                : undefined
            }
            down={
              i < bullets.length - 1
                ? () => dispatch({ type: "moveBullet", entry: entry.id, id: bl.id, by: 1 })
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

function BulletRow({
  editor,
  bullet,
  up,
  down,
}: {
  editor: Editor;
  entry: Entry;
  bullet: Bullet;
  up?: () => void;
  down?: () => void;
}) {
  const { state, dispatch } = editor;
  const hidden = state.built.hidden.includes(bullet.id);
  const picked = bullet.variants.find((v) => v.id === state.built.pick[bullet.id]);
  const changed = bullet.variants.filter((v) => v.originalChanged);
  return (
    <div>
      <div className="flex items-start gap-2">
        <input
          className="mt-1"
          type="checkbox"
          checked={!hidden}
          onChange={() => dispatch({ type: "toggleBullet", id: bullet.id })}
        />
        <span
          className={cn(
            "text-meta flex-1",
            hidden ? "text-ink-faint line-through" : "text-ink-muted",
          )}
        >
          {bulletText(state, bullet)}
        </span>
        <Arrows up={up} down={down} />
      </div>
      {bullet.variants.length > 0 && !hidden && (
        <div className="mt-1 ml-5 flex flex-wrap items-center gap-2">
          <select
            className="text-note text-ink-muted bg-app rounded-md px-1.5 py-0.5"
            value={picked?.id ?? ""}
            onChange={(e) =>
              dispatch({ type: "pick", bullet: bullet.id, variant: e.target.value || null })
            }
          >
            <option value="">Original wording</option>
            {bullet.variants.map((v) => (
              <option key={v.id} value={v.id}>
                Variant{v.posting ? ` · ${v.posting}` : ""}
              </option>
            ))}
          </select>
          {changed.map((v) => (
            <span key={v.id} className="flex items-center gap-1.5">
              <Badge tone="warning">Original Changed</Badge>
              <Button
                size="inline"
                variant="ghost"
                onClick={() => dispatch({ type: "keepVariant", variant: v.id })}
              >
                Keep Variant
              </Button>
              <Button
                size="inline"
                variant="ghost"
                onClick={() => dispatch({ type: "deleteVariant", variant: v.id })}
              >
                Delete
              </Button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Arrows({ up, down }: { up?: () => void; down?: () => void }) {
  return (
    <span className="ml-auto flex flex-none">
      <Button size="icon-xs" variant="section" aria-label="Move up" disabled={!up} onClick={up}>
        <ArrowUp />
      </Button>
      <Button
        size="icon-xs"
        variant="section"
        aria-label="Move down"
        disabled={!down}
        onClick={down}
      >
        <ArrowDown />
      </Button>
    </span>
  );
}
