"use client";

import { ArrowDown, ArrowUp, Check, EyeOff, Scissors, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/ui/text-link";
import { updateEntry, type Bank } from "@/lib/bank-actions";
import {
  fitToOnePage,
  getChoices,
  renderResumePdf,
  updateChoices,
  type Choices,
  type ChoicesUpdate,
  type RenderBox,
  type RenderedPdf,
} from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";

import { lineOf, move, pageLabel, TYPED_FIELDS, wording, type Line } from "./model";
import { boxKey, kindLabel, PdfPages } from "./pdf-pages";
import { PhoneEditor, usePhone } from "./phone";
import { Tray } from "./tray";

/**
 * The desktop editor (KAN-218): the built resume's own PDF, edited on the
 * page. Click a line and type: the field over it shows the text at once and
 * saves after a pause (SAVE_AFTER_MS) or on blur, then the PDF renders
 * again. A bullet's typing becomes this resume's local variant; an entry's
 * title, organization and location change the bank. The sticky bar holds the
 * selected line's actions, or the page-count chip and Fit to One Page. Every
 * save bumps one request counter, and a response older than the latest
 * request is dropped, so a slow render never paints over a newer edit.
 * On a phone-width screen the same state is laid out by `PhoneEditor`
 * (KAN-219, ./phone.tsx).
 */

const SAVE_AFTER_MS = 700;
// Letter is 612 pt wide and Jake's text ends at 576 pt; field type is set in
// cqw of the page so it matches the PDF's at any width.
const PAGE_WIDTH = 612;
const RIGHT_EDGE = 576;
const pt = (points: number) => `${(points / PAGE_WIDTH) * 100}cqw`;

type Draft = { key: string; text: string };
type TypedField = "title" | "organization" | "location";

function splitKey(key: string) {
  const dot = key.lastIndexOf(".");
  return { item_id: key.slice(0, dot), kind: key.slice(dot + 1) };
}

export function Editor({
  resumeId,
  initial,
  initialBank,
  initialChoices,
}: {
  resumeId: string;
  initial: RenderedPdf;
  initialBank: Bank;
  initialChoices: Choices;
}) {
  const [rendered, setRendered] = useState(initial);
  const [bank, setBank] = useState(initialBank);
  const [choices, setChoices] = useState(initialChoices);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [fitHidden, setFitHidden] = useState<string[] | null>(null);
  const latest = useRef(0);
  const started = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Draft | null>(null);
  const phone = usePhone();

  /** Starts a request; the returned check stays true while it is the latest. */
  const begin = useCallback(() => {
    const request = ++latest.current;
    setSaving(true);
    setError(null);
    return () => request === latest.current;
  }, []);

  const renderAgain = useCallback(
    async (current: () => boolean) => {
      started.current = performance.now();
      const { data, error } = await renderResumePdf(resumeId);
      if (!current()) return; // a newer request owns the page
      setSaving(false);
      if (!data) return setError(error);
      setRendered(data);
    },
    [resumeId],
  );

  const apply = useCallback(
    async (changes: ChoicesUpdate) => {
      const current = begin();
      const { data, error } = await updateChoices(resumeId, changes);
      if (!current()) return;
      if (!data) {
        setSaving(false);
        return setError(error);
      }
      setChoices(data);
      await renderAgain(current);
    },
    [begin, resumeId, renderAgain],
  );

  /** Saves typed text when it differs from what the resume shows. */
  const save = useCallback(
    async (typed: Draft) => {
      const line = lineOf(bank, splitKey(typed.key));
      const text = typed.text.trim();
      if (line?.kind === "bullet") {
        if (!text || text === wording(choices, line.bullet)) return;
        return apply({ bullets: [{ bullet_id: line.bullet.id, text }] });
      }
      if (line?.kind !== "entry" || !TYPED_FIELDS.has(line.field)) return;
      const field = line.field as TypedField;
      if (text === (line.entry[field] ?? "") || (field === "title" && !text)) return;
      // The bank changes here at once, so a dropped response cannot lose it
      setBank((b) => ({
        ...b,
        entries: b.entries.map((e) =>
          e.id === line.entry.id ? { ...e, [field]: text || null } : e,
        ),
      }));
      const current = begin();
      const { error } = await updateEntry(line.entry.id, { [field]: text || null });
      if (!current()) return;
      if (error) {
        setSaving(false);
        return setError(error);
      }
      await renderAgain(current);
    },
    [apply, bank, begin, choices, renderAgain],
  );

  /** Saves a waiting draft now, instead of after the pause. */
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const waiting = pending.current;
    pending.current = null;
    if (waiting) void save(waiting);
  }, [save]);

  const select = useCallback(
    (key: string | null) => {
      flush();
      setDraft(null);
      setSelected(key);
    },
    [flush],
  );

  useEffect(() => {
    const clear = (event: KeyboardEvent) => event.key === "Escape" && select(null);
    window.addEventListener("keydown", clear);
    return () => window.removeEventListener("keydown", clear);
  }, [select]);

  // The pause timer calls the newest flush, which sees the newest bank
  const latestFlush = useRef(flush);
  useEffect(() => {
    latestFlush.current = flush;
  });

  function type(key: string, text: string) {
    setDraft({ key, text });
    pending.current = { key, text };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => latestFlush.current(), SAVE_AFTER_MS);
  }

  async function fit() {
    select(null);
    const current = begin();
    started.current = performance.now();
    const { data, error } = await fitToOnePage(resumeId);
    if (!current()) return;
    if (!data) {
      setSaving(false);
      return setError(error);
    }
    setRendered(data.render);
    setFitHidden(data.hidden.length ? data.hidden : null);
    const fresh = await getChoices(resumeId);
    if (!current()) return;
    setSaving(false);
    if (fresh.data) setChoices(fresh.data);
  }

  function undoFit() {
    if (!fitHidden) return;
    void apply({ bullets: fitHidden.map((bullet_id) => ({ bullet_id, shown: true })) });
    setFitHidden(null);
  }

  const box = rendered.boxes.find((b) => boxKey(b) === selected);
  const line = box ? lineOf(bank, box) : null;

  function startText(line: Line) {
    if (line.kind === "bullet") return wording(choices, line.bullet);
    if (line.kind === "entry" && TYPED_FIELDS.has(line.field))
      return line.entry[line.field as TypedField] ?? "";
    return null;
  }

  function field(target: RenderBox) {
    const start = line && startText(line);
    if (start == null) return null;
    const key = boxKey(target);
    const common = {
      autoFocus: true,
      value: draft?.key === key ? draft.text : start,
      "aria-label": kindLabel(target.kind),
      onBlur: flush,
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.currentTarget.blur();
      },
      className: cn(
        "bg-panel text-ink ring-brand block resize-none rounded-[2px] px-[0.3cqw] font-serif ring-2 outline-none",
        "field-sizing-content",
      ),
    };
    return line?.kind === "bullet" ? (
      <textarea
        {...common}
        rows={1}
        onChange={(e) => type(key, e.target.value)}
        style={{ width: pt(RIGHT_EDGE - target.x0), fontSize: pt(10), lineHeight: pt(12) }}
      />
    ) : (
      <input
        {...common}
        onChange={(e) => type(key, e.target.value)}
        style={{ fontSize: pt(11), minWidth: pt(40), lineHeight: pt(13) }}
      />
    );
  }

  const drawn = () => {
    if (started.current == null) return;
    setElapsed(Math.round(performance.now() - started.current));
    started.current = null;
  };

  if (phone) {
    const start = line && startText(line);
    return (
      <PhoneEditor
        rendered={rendered}
        bank={bank}
        choices={choices}
        selected={selected}
        line={line}
        box={box}
        text={start == null ? null : draft?.key === selected ? draft.text : start}
        saving={saving}
        elapsed={elapsed}
        error={error}
        fitHidden={fitHidden}
        actions={
          line && (
            <LineActions
              line={line}
              choices={choices}
              onApply={apply}
              onHide={(changes) => {
                apply(changes);
                select(null);
              }}
              up={move(bank, choices, line, -1)}
              down={move(bank, choices, line, 1)}
            />
          )
        }
        onSelect={select}
        onType={(text) => selected && type(selected, text)}
        onFlush={flush}
        onApply={apply}
        onFit={fit}
        onUndoFit={undoFit}
        onDrawn={drawn}
      />
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <Bar
        line={line}
        box={box}
        bank={bank}
        choices={choices}
        rendered={rendered}
        saving={saving}
        elapsed={elapsed}
        fitHidden={fitHidden}
        onApply={apply}
        onClose={() => select(null)}
        onFit={fit}
        onUndoFit={undoFit}
      />
      {error && (
        <p role="alert" className="text-note text-danger">
          {error}
        </p>
      )}
      <PdfPages
        pdf={rendered.pdf}
        boxes={rendered.boxes}
        selected={selected}
        onSelect={(key) => select(selected === key ? null : key)}
        field={field}
        onDrawn={drawn}
      />
      <Tray bank={bank} choices={choices} onPutBack={apply} />
    </div>
  );
}

/** The sticky bar above the page: the selected line's actions, or the
 *  page-count chip and Fit to One Page. Sticky, so a line's actions never
 *  cover the lines around it (user story 63). */
function Bar({
  line,
  box,
  bank,
  choices,
  rendered,
  saving,
  elapsed,
  fitHidden,
  onApply,
  onClose,
  onFit,
  onUndoFit,
}: {
  line: Line | null;
  box: RenderBox | undefined;
  bank: Bank;
  choices: Choices;
  rendered: RenderedPdf;
  saving: boolean;
  elapsed: number | null;
  fitHidden: string[] | null;
  onApply: (changes: ChoicesUpdate) => void;
  onClose: () => void;
  onFit: () => void;
  onUndoFit: () => void;
}) {
  return (
    <div
      className="bg-surface/95 ring-border-subtle sticky top-2 z-20 flex min-h-12 flex-wrap items-center gap-2 rounded-2xl p-1.5 pl-3 shadow-sm ring-1 backdrop-blur"
      // A press on a button keeps focus in the field, so it does not blur and save first
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) e.preventDefault();
      }}
    >
      {line && box ? (
        <>
          <span className="text-note text-ink-meta font-semibold">{kindLabel(box.kind)}</span>
          <LineActions
            line={line}
            choices={choices}
            onApply={onApply}
            onHide={(changes) => {
              onApply(changes);
              onClose();
            }}
            up={move(bank, choices, line, -1)}
            down={move(bank, choices, line, 1)}
          />
          <Button variant="secondary" size="sm" onClick={onClose}>
            Done
          </Button>
        </>
      ) : (
        <>
          <Badge tone={rendered.page_count <= 1 ? "positive" : "warning"}>
            {rendered.page_count <= 1 && <Check className="mr-1 size-3" />}
            {pageLabel(rendered.page_count, rendered.lines_over)}
          </Badge>
          {rendered.page_count > 1 && (
            <Button variant="outline" size="sm" onClick={onFit} disabled={saving}>
              <Scissors /> Fit to One Page
            </Button>
          )}
          {fitHidden && (
            <Button variant="secondary" size="sm" onClick={onUndoFit} disabled={saving}>
              <Undo2 /> Undo
            </Button>
          )}
          <span className="text-note text-ink-meta">Click a line to edit it.</span>
        </>
      )}
      <span className="text-note text-ink-meta ml-auto pr-2" aria-live="polite">
        {saving ? "Saving…" : elapsed != null ? `Saved, ${elapsed} ms` : ""}
      </span>
    </div>
  );
}

function LineActions({
  line,
  choices,
  onApply,
  onHide,
  up,
  down,
}: {
  line: Line;
  choices: Choices;
  onApply: (changes: ChoicesUpdate) => void;
  onHide: (changes: ChoicesUpdate) => void;
  up: ChoicesUpdate | null;
  down: ChoicesUpdate | null;
}) {
  const moves = (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-label="Move Up"
        disabled={!up}
        onClick={() => up && onApply(up)}
      >
        <ArrowUp />
      </Button>
      <Button
        variant="secondary"
        size="sm"
        aria-label="Move Down"
        disabled={!down}
        onClick={() => down && onApply(down)}
      >
        <ArrowDown />
      </Button>
    </>
  );

  if (line.kind === "skill") {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onHide({ skills: [{ skill_id: line.skill.id, shown: false }] })}
      >
        <EyeOff /> Hide
      </Button>
    );
  }

  if (line.kind === "bullet") {
    const id = line.bullet.id;
    const current = choices.bullets.find((c) => c.bullet_id === id)?.variant_id ?? null;
    const versions = choices.variants.filter((v) => v.bullet_id === id);
    let tailored = 0;
    return (
      <>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onHide({ bullets: [{ bullet_id: id, shown: false }] })}
        >
          <EyeOff /> Hide
        </Button>
        {moves}
        {versions.length > 0 &&
          [null, ...versions].map((v) => {
            const on = current === (v?.id ?? null);
            const label =
              v == null ? "Original" : v.local ? "This Resume's Wording" : `Tailored ${++tailored}`;
            return (
              <Button
                key={v?.id ?? "original"}
                variant={on ? "outline" : "secondary"}
                size="sm"
                aria-pressed={on}
                title={v?.text ?? line.bullet.text}
                onClick={() => onApply({ bullets: [{ bullet_id: id, variant_id: v?.id ?? null }] })}
              >
                {label}
              </Button>
            );
          })}
      </>
    );
  }

  const entry = line.entry;
  const choice = choices.entries.find((c) => c.entry_id === entry.id);
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onHide({ entries: [{ entry_id: entry.id, shown: false }] })}
      >
        <EyeOff /> Hide Entry
      </Button>
      {moves}
      {entry.section === "education" && choice && (
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              onApply({ entries: [{ entry_id: entry.id, show_gpa: !choice.show_gpa }] })
            }
          >
            {choice.show_gpa ? "Hide GPA" : "Show GPA"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              onApply({
                entries: [{ entry_id: entry.id, show_coursework: !choice.show_coursework }],
              })
            }
          >
            {choice.show_coursework ? "Hide Coursework" : "Show Coursework"}
          </Button>
        </>
      )}
      {!TYPED_FIELDS.has(line.field) && (
        <span className="text-note text-ink-meta">
          Change this in the <TextLink href="/bank">Experience Bank</TextLink>.
        </span>
      )}
    </>
  );
}
