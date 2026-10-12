"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PlusIcon, TrashIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SegmentedToggle } from "@/components/ui/segmented-control";
import { FIELD_CONTROL } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";
import {
  latexFields,
  saveLatex,
  type LatexDoc,
  type LatexField,
  type LatexOp,
} from "@/lib/latex-actions";

import { bulletHints } from "../../hints";
import { usePreview } from "./use-preview";

/**
 * The LaTeX resume editor (KAN-176): the applicant's own LaTeX, edited by
 * its words, beside the PDF it compiles to.
 *
 * WORDS is the default: every line of the resume in document order, as plain
 * text in fields, its LaTeX hidden. A section's header lines sit side by
 * side, its bullets stack with add and remove, and **double stars** make
 * bold. The API finds the fields (backend services/latex_source), and an
 * edit replaces only that field's words, so the layout is exactly what was
 * pasted. SOURCE is the LaTeX itself, for anything the Words view can't
 * reach.
 *
 * Edits are held here as `edits` against `doc`, the last source the API
 * read, and sent with it: the preview compiles them about a second after
 * typing stops, and Save writes them. Adding or removing a bullet, or
 * leaving the Source tab, asks the API for the new source and its fields at
 * once, since those change which fields there are.
 */

// CodeMirror measures the DOM and is only needed once Source is opened
const SourceEditor = dynamic(() => import("./source-editor"), {
  ssr: false,
  loading: () => <div className="bg-well rounded-control h-[32rem] animate-pulse" />,
});

type Tab = "words" | "source";
const TABS = [
  { value: "words", label: "Words" },
  { value: "source", label: "Source" },
];
// What a new bullet says until it is typed over
const NEW_BULLET = "Describe what you did and what came of it";

type Block = { kind: "row" | "bullets"; fields: LatexField[] };

/** A section's fields as the Words view lays them out: header lines in
 *  rows, bullets in lists. */
function blocks(fields: LatexField[]): Block[] {
  const out: Block[] = [];
  for (const field of fields) {
    if (field.kind === "heading") continue;
    const kind = field.kind === "bullet" ? "bullets" : "row";
    const last = out.at(-1);
    if (last?.kind === kind) last.fields.push(field);
    else out.push({ kind, fields: [field] });
  }
  return out;
}

/** "Line 12: Undefined control sequence" → 12 */
function lineOf(error: string | null) {
  const match = error?.match(/^Line (\d+):/);
  return match ? Number(match[1]) : null;
}

export function LatexEditor({
  resumeId,
  name,
  initial,
}: {
  resumeId: string;
  name: string;
  initial: LatexDoc;
}) {
  const [doc, setDoc] = useState(initial);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>("words");
  const [draft, setDraft] = useState(initial.source);
  const [savedSource, setSavedSource] = useState(initial.source);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [jumpTo, setJumpTo] = useState<{ line: number; at: number } | null>(null);
  const focusField = useRef<string | null>(null);

  const original = useMemo(() => new Map(doc.fields.map((f) => [f.id, f.text])), [doc]);
  const ops = useMemo<LatexOp[]>(
    () =>
      Object.entries(edits)
        .filter(([id, text]) => text.trim() && text !== original.get(id))
        .map(([id, text]) => ({ edit: id, text })),
    [edits, original],
  );
  const current = tab === "source" ? { source: draft, ops: [] } : { source: doc.source, ops };
  const dirty =
    tab === "source" ? draft !== savedSource : doc.source !== savedSource || ops.length > 0;
  const preview = usePreview(current);

  // A bullet just added takes the focus, its placeholder words selected so
  // typing replaces them
  useEffect(() => {
    if (!focusField.current) return;
    const el = document.getElementById(`field-${focusField.current}`);
    focusField.current = null;
    if (el instanceof HTMLTextAreaElement) {
      el.focus();
      el.select();
    }
  }, [doc]);

  // Leaving with unsaved changes asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** The API applies `extra` (and the pending edits) and the view moves to
   *  the source and fields it returns. */
  async function restructure(source: string, extra: LatexOp[]) {
    setBusy(true);
    setError(null);
    const { data, error: err } = await latexFields(source, extra);
    setBusy(false);
    if (err != null) {
      setError(err);
      return null;
    }
    setDoc(data);
    setEdits({});
    setDraft(data.source);
    return data;
  }

  async function addBullet(after: LatexField) {
    const index = doc.fields.findIndex((f) => f.id === after.id);
    const data = await restructure(doc.source, [...ops, { after: after.id, text: NEW_BULLET }]);
    if (data) focusField.current = data.fields[index + 1]?.id ?? null;
  }

  async function removeBullet(field: LatexField) {
    await restructure(doc.source, [...ops, { delete: field.id }]);
  }

  async function switchTab(next: string) {
    if (next === tab) return;
    if (next === "source") {
      if (ops.length && !(await restructure(doc.source, ops))) return;
      setDraft((d) => (ops.length ? d : doc.source));
    } else if (draft !== doc.source && !(await restructure(draft, []))) {
      return;
    }
    setTab(next as Tab);
  }

  async function showLine(line: number) {
    if (tab !== "source") await switchTab("source");
    setJumpTo((j) => ({ line, at: (j?.at ?? 0) + 1 }));
  }

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setStatus(null);
    const { data, error: err } = await saveLatex(resumeId, current.source, current.ops);
    setSaving(false);
    if (err != null) {
      setError(err);
      return;
    }
    setDoc({ source: data.source, fields: data.fields });
    setEdits({});
    setDraft(data.source);
    setSavedSource(data.source);
    setStatus(data.pages > 1 ? `Saved. It runs to ${data.pages} pages.` : "Saved.");
  }, [resumeId, current.source, current.ops]);

  // Cmd/Ctrl+S saves, as it does in every editor
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !saving) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, saving, save]);

  const shownError = error ?? preview.error;
  const errorLine = lineOf(shownError);
  const sections = useMemo(() => {
    const out = new Map<number, LatexField[]>();
    for (const f of doc.fields) out.set(f.section, [...(out.get(f.section) ?? []), f]);
    return [...out.entries()];
  }, [doc]);

  function field(f: LatexField, className?: string) {
    const value = edits[f.id] ?? f.text;
    if (!f.editable) {
      return (
        <div key={f.id} className={cn("flex min-w-0 flex-col gap-1", className)}>
          <code className="bg-well rounded-control text-note text-ink-muted block px-3 py-2 break-words">
            {f.text}
          </code>
          <Button
            variant="section"
            size="section"
            className="self-start"
            onClick={() => showLine(f.line)}
          >
            Edit in Source
          </Button>
        </div>
      );
    }
    const props = {
      id: `field-${f.id}`,
      value,
      maxLength: 1000,
      "aria-label":
        f.kind === "heading" ? "Section title" : f.kind === "bullet" ? "Bullet" : "Line",
      onChange: (e: { target: { value: string } }) => {
        setError(null);
        setEdits((s) => ({ ...s, [f.id]: e.target.value.replace(/\n/g, " ") }));
      },
    };
    if (f.kind === "bullet") {
      return (
        <textarea
          key={f.id}
          rows={1}
          {...props}
          className={cn(
            FIELD_CONTROL,
            "field-sizing-content min-h-10 resize-none px-3 py-2",
            className,
          )}
        />
      );
    }
    return (
      <input
        key={f.id}
        type="text"
        {...props}
        className={cn(
          FIELD_CONTROL,
          "h-10 px-3",
          f.kind === "heading" && "text-subtitle font-semibold",
          className,
        )}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedToggle label="Editor" options={TABS} value={tab} onValueChange={switchTab} />
        <p role="status" className="text-meta text-ink-meta">
          {busy
            ? "Updating…"
            : saving
              ? "Saving…"
              : dirty
                ? "Unsaved changes"
                : (status ?? "All changes saved")}
        </p>
        <Button className="ml-auto" onClick={save} disabled={!dirty || saving || busy}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {shownError && (
        <div
          role="alert"
          className="bg-danger-tint text-danger rounded-control flex flex-wrap items-center gap-3 p-3"
        >
          <p className="text-label">{shownError}</p>
          {errorLine && (
            <Button size="xs" variant="secondary" onClick={() => showLine(errorLine)}>
              Show Line {errorLine}
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-6 @4xl/main:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          {tab === "source" ? (
            <SourceEditor
              value={draft}
              onChange={(next) => {
                setError(null);
                setDraft(next);
              }}
              jumpTo={jumpTo}
            />
          ) : (
            <div className={cn("flex flex-col gap-6", busy && "pointer-events-none opacity-70")}>
              <p className="text-meta text-ink-meta">
                Change any words below; the layout stays exactly as your LaTeX has it. Wrap words in
                **double stars** for bold, *single stars* for italic.
              </p>
              {sections.map(([section, fields]) => {
                const heading = fields.find((f) => f.kind === "heading");
                return (
                  <section
                    key={section}
                    className="flex flex-col gap-3"
                    aria-label={heading?.text ?? "Header"}
                  >
                    {heading ? (
                      field(heading)
                    ) : (
                      <h2 className="text-caption text-ink-meta uppercase">Header</h2>
                    )}
                    {blocks(fields).map((block) =>
                      block.kind === "row" ? (
                        <div key={block.fields[0].id} className="flex flex-wrap gap-2">
                          {block.fields.map((f) => field(f, "min-w-40 flex-1"))}
                        </div>
                      ) : (
                        <ul key={block.fields[0].id} className="flex flex-col gap-2 pl-1">
                          {block.fields.map((f) => {
                            const hints = f.editable
                              ? bulletHints(edits[f.id] ?? f.text, false)
                              : [];
                            return (
                              <li key={f.id} className="group flex gap-2">
                                <span aria-hidden className="text-ink-meta mt-2.5 select-none">
                                  •
                                </span>
                                <div className="flex min-w-0 flex-1 flex-col gap-1">
                                  {field(f)}
                                  {hints.map((h) => (
                                    <p key={h} className="text-note text-warning">
                                      {h}
                                    </p>
                                  ))}
                                </div>
                                <div className="flex shrink-0 flex-col items-center gap-2 pt-2.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
                                  <IconButton
                                    label="Add a bullet below"
                                    onClick={() => addBullet(f)}
                                  >
                                    <PlusIcon className="size-4" />
                                  </IconButton>
                                  {block.fields.length > 1 && (
                                    <IconButton
                                      label="Remove this bullet"
                                      onClick={() => removeBullet(f)}
                                    >
                                      <TrashIcon className="size-4" />
                                    </IconButton>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                          <li>
                            <Button
                              variant="section"
                              size="section"
                              onClick={() => addBullet(block.fields[block.fields.length - 1])}
                            >
                              <PlusIcon className="size-3.5" />
                              Add Bullet
                            </Button>
                          </li>
                        </ul>
                      ),
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-2 @4xl/main:sticky @4xl/main:top-6 @4xl/main:self-start">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-label text-ink-muted">Preview</h2>
            <span className="text-note text-ink-meta" aria-live="polite">
              {preview.compiling
                ? "Compiling…"
                : preview.url
                  ? `${preview.pages} page${preview.pages === 1 ? "" : "s"}`
                  : ""}
            </span>
          </div>
          {preview.pages > 1 && (
            <p
              role="status"
              className="bg-warning-tint text-warning rounded-control text-label p-3"
            >
              This runs to {preview.pages} pages. Shorten a few bullets to fit it on one.
            </p>
          )}
          {preview.url ? (
            <iframe
              title={`${name} preview`}
              src={`${preview.url}#toolbar=0&navpanes=0`}
              className={cn(
                "border-border-subtle rounded-control aspect-[8.5/11] w-full border bg-white transition-opacity",
                preview.compiling && "opacity-70",
              )}
            />
          ) : (
            <div className="bg-well rounded-control text-meta text-ink-meta flex aspect-[8.5/11] w-full items-center justify-center">
              {preview.error ? "Fix the error above to see the preview." : "Compiling…"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
