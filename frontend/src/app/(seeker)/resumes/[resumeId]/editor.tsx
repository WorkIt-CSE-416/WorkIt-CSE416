"use client";

import {
  ArrowDownIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  ArrowUpIcon,
  CloudSlashIcon,
  CursorClickIcon,
  EyeSlashIcon,
  ScissorsIcon,
  WarningIcon,
} from "@phosphor-icons/react/ssr";
import localFont from "next/font/local";
import { Suspense, use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ChevronDownIcon, SparkleIcon } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { Skeleton } from "@/components/shadcn/skeleton";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedToggle } from "@/components/ui/segmented-control";
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
import { updateProfile } from "@/lib/profile-actions";

import {
  DownloadMenu,
  DownloadNotes,
  useResumeDownload,
  type ResumeDownload,
} from "../download-menu";
import { Assistant } from "./assistant";
import { FitNotice, FitToast } from "./fit-notice";
import {
  ENTRY_CODECS,
  HEADER_CODECS,
  LINK_FIELDS,
  lineOf,
  move,
  pageLabel,
  typed,
  wording,
  type Header,
  type HeaderField,
  type Line,
} from "./model";
import { keepFitUndo, readFitUndo } from "./fit-undo";
import { boxKey, kindLabel, loadPdfjs, PageSkeleton, PdfPages } from "./pdf-pages";
import { PhoneEditor, usePhone } from "./phone";
import {
  cardsOf,
  editKey,
  linesOf,
  marksOf,
  reverted,
  revertAll,
  revertOf,
  type RevertTarget,
  type SuggestionsApi,
  untouched,
  useTailorReview,
} from "./tailor-review";
import { Tray } from "./tray";

/**
 * The desktop editor (KAN-218): the built resume's own PDF, edited on the
 * page. Click a line and type: the field over it shows the text at once and
 * saves after a pause (SAVE_AFTER_MS) or on blur, then the PDF renders
 * again. A bullet's typing becomes this resume's local variant; an entry's
 * typed fields (`ENTRY_CODECS`) change the bank, and the header's
 * (`HEADER_CODECS`) change the profile. The field is set in Latin Modern,
 * the PDF's own font, at the line's size and weight, and opens with the
 * caret where the click landed, so typing starts where the student
 * pointed and wraps where the PDF does. The sticky bar holds the
 * selected line's actions, or the page-count chip and Fit to One Page. Every
 * save bumps one request counter, and a response older than the latest
 * request is dropped, so a slow render never paints over a newer edit.
 * On a phone-width screen the same state is laid out by `PhoneEditor`
 * (KAN-219, ./phone.tsx). The assistant (KAN-221, ./assistant.tsx) docks
 * beside the page, or opens in a sheet on a phone, and acts through the same
 * saves. On Tailor's page (`suggestions`), each change the run made is
 * tinted and has a card in the Suggestions panel beside the page, in the
 * assistant's column, to accept or reject; an edit of a changed item
 * through `apply` drops that change.
 *
 * THE FIRST PDF STREAMS IN (KAN-368). The page starts the render and hands
 * it over unawaited (`initial`), since the LaTeX compile is the slowest read
 * in the app (0.7 to 1s): the bar, the title and Back draw at once, and the
 * page area alone waits, over a page-shaped skeleton (FirstRenderPane, in a
 * <Suspense>, reads it). Until it lands there is nothing to click (the click
 * targets are the render's boxes, KAN-209), Ask Scout and Not on This
 * Resume wait too, and a render that fails shows its own error in the page
 * area. pdf.js starts downloading as the editor mounts, so it is ready when
 * the PDF is. An edit's render never loses to the first one: the first is
 * taken only while there is no other.
 */

// The attribute on the parts of the editor a press may land on without
// clearing the selected line
const KEEPS_SELECTION = "data-keeps-selection";

const SAVE_AFTER_MS = 700;
// Letter is 612 pt wide and Jake's text ends at 576 pt; field type is set in
// cqw of the page so it matches the PDF's at any width.
const PAGE_WIDTH = 612;
const RIGHT_EDGE = 576;
const pt = (points: number) => `${(points / PAGE_WIDTH) * 100}cqw`;

// Latin Modern Roman, the face Tectonic sets Jake's Resume in (GUST Font
// License), subset to Latin; loaded on the editor page only
const latinModern = localFont({
  src: [
    { path: "./fonts/lmroman10-regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/lmroman10-bold.woff2", weight: "700", style: "normal" },
    { path: "./fonts/lmroman10-italic.woff2", weight: "400", style: "italic" },
  ],
  display: "swap",
});

/** Jake's type for each kind of line: its size in points, and whether it is
 *  bold or italic. Body text is 11 pt, \small 10 pt, the name \Huge. */
function typeOf(kind: string, section: string | null) {
  const twoRow = section === "education" || section === "experience" || section === "leadership";
  // \scshape has no bold small capitals in Latin Modern, so the name prints bold
  if (kind === "full_name") return { size: 24.88, bold: true, italic: false };
  if (kind === "title") return { size: twoRow ? 11 : 10, bold: true, italic: false };
  if (kind === "organization") return { size: 10, bold: false, italic: true };
  // Education's location is the heading's right slot, upright at 11 pt
  if (kind === "location")
    return {
      size: section === "education" ? 11 : 10,
      bold: false,
      italic: section !== "education",
    };
  return { size: 10, bold: false, italic: false };
}

// Where a field's first baseline sits below its top, in ems: Latin Modern's
// ascent (1.127) less half the leading a 1.2 line height takes from its
// 1.417 em content area. A box's top is its first baseline less ASCENT (the
// API's resume_render), more for the name.
const LINE_HEIGHT = 1.2;
const FIELD_BASELINE = 1.127 - (1.417 - LINE_HEIGHT) / 2;
const boxAscent = (kind: string) => (kind === "full_name" ? 21 : 8);

/** Lines that wrap: typed in a textarea as wide as the text column. */
const WRAPS = new Set(["bullet", "coursework", "honors"]);

type Draft = { key: string; text: string };

/** The page's render of the PDF, as renderResumePdf answers it. It never
 *  rejects: a failure is its `error`. */
type FirstRender = ReturnType<typeof renderResumePdf>;

function splitKey(key: string) {
  const dot = key.lastIndexOf(".");
  return { item_id: key.slice(0, dot), kind: key.slice(dot + 1) };
}

export function Editor({
  resumeId,
  initial,
  initialBank,
  initialChoices,
  initialHeader,
  phoneBar,
  suggestions,
  compact = false,
  heading,
  original,
}: {
  resumeId: string;
  /** The first render, started by the page and not awaited. */
  initial: FirstRender;
  initialBank: Bank;
  initialChoices: Choices;
  initialHeader: Header;
  /** Tailor's Suggestions panel, drawn from the run's record and the
   *  editor's state (./tailor-review.tsx). Only Tailor's page passes it, so
   *  only there are changes tinted: a mark with no card to act on would
   *  mean nothing. */
  suggestions?: (api: SuggestionsApi) => ReactNode;
  /** The slim toolbar (Tailor's review), over the page, with the column
   *  beside it starting level: Undo and Redo, the page count as a warning
   *  chip that offers Fit to One Page, and the Suggestions or Original
   *  switch (`SlimBar`). The editor's own page keeps the full bar. */
  compact?: boolean;
  /** A title over the page (Tailor's `ResumeTitle`); over the page and the
   *  column beside it when `compact`. */
  heading?: ReactNode;
  /** The resume Tailor started from, read-only, which the toolbar's View
   *  Original sets beside the page in place of the Suggestions panel. */
  original?: ReactNode;
  /** A row the phone layout's header shows under its buttons: the page's
   *  own controls, which the full-screen phone editor would cover. */
  phoneBar?: ReactNode;
}) {
  // Null until the first render lands (FirstRenderPane hands it over).
  const [rendered, setRendered] = useState<RenderedPdf | null>(null);
  const adopt = useCallback((first: RenderedPdf) => setRendered((current) => current ?? first), []);
  // The first render failed: the page area says so, and the bar stops
  // offering "Click a line", since there is no line to click.
  const [firstFailed, setFirstFailed] = useState(false);
  const fail = useCallback(() => setFirstFailed(true), []);
  // pdf.js downloads while the server compiles, not after.
  useEffect(() => {
    void loadPdfjs().catch(() => {});
  }, []);
  const [bank, setBank] = useState(initialBank);
  const [header, setHeader] = useState(initialHeader);
  const [choices, setChoices] = useState(initialChoices);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [fitUndo, setFitUndo] = useState<ChoicesUpdate | null>(null);
  // The resume's PDF and Word downloads, here since KAN-258 (../download-menu.tsx)
  const download = useResumeDownload(resumeId);
  // Tailor's changes awaiting review; `apply` reads the newest through a ref
  const [review, setReview] = useTailorReview(resumeId);
  const latestReview = useRef(review);
  useEffect(() => {
    latestReview.current = review;
  });
  // Over one page, a toast says so when the editor opens and again when an
  // edit pushes the resume over (./fit-notice.tsx, KAN-258). The last count
  // is kept in state, so the change is caught while rendering, not after.
  const over = (rendered?.page_count ?? 1) > 1;
  const [toast, setToast] = useState(over);
  const [wasOver, setWasOver] = useState(over);
  if (over !== wasOver) {
    setWasOver(over);
    setToast(over);
  }
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(false), 10_000);
    return () => clearTimeout(timer);
  }, [toast]);
  const latest = useRef(0);
  const started = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Draft | null>(null);
  // Where the last press on the pages landed, from their top left (the bar
  // can change height as the line is selected), to put the caret there
  const pages = useRef<HTMLDivElement>(null);
  const pressed = useRef<{ x: number; y: number } | null>(null);
  const placed = useRef<string | null>(null);
  const phone = usePhone();
  const [asking, setAsking] = useState(false);
  // The Suggestions card in focus (its lines outlined), the card of the
  // marked line last clicked, and the phone's Suggestions sheet
  const [focused, setFocused] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  // What Tailor's review sets beside the page, picked on the toolbar: the
  // Suggestions panel, the original resume, or nothing, when the page
  // takes the room
  const [side, setSide] = useState<"suggestions" | "original" | null>("suggestions");

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
    async (changes: ChoicesUpdate, revertedTarget?: RevertTarget) => {
      // A wording picked from the bar or the assistant replaces what was
      // typed, so the field shows the picked wording, not the old draft
      if (changes.bullets?.some((b) => "variant_id" in b)) {
        if (timer.current) clearTimeout(timer.current);
        pending.current = null;
        setDraft(null);
      }
      const current = begin();
      const { data, error } = await updateChoices(resumeId, changes);
      if (!current()) return;
      if (!data) {
        setSaving(false);
        return setError(error);
      }
      setChoices(data);
      // A change to an item Tailor changed (a revert included) drops its mark
      const waiting = latestReview.current;
      if (waiting) {
        setReview({
          ...waiting,
          edits: revertedTarget
            ? reverted(waiting.edits, revertedTarget, data)
            : untouched(waiting.edits, changes),
        });
      }
      await renderAgain(current);
    },
    [begin, resumeId, renderAgain, setReview],
  );

  /** Changes the profile fields the header prints, then renders again. */
  const saveHeader = useCallback(
    async (changes: Partial<Header>) => {
      setHeader((h) => ({ ...h, ...changes }));
      const current = begin();
      const { profile, error } = await updateProfile(changes);
      if (!current()) return;
      if (!profile) {
        setSaving(false);
        return setError(error);
      }
      setHeader(profile);
      await renderAgain(current);
    },
    [begin, renderAgain],
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
      if (line?.kind === "entry") {
        const codec = ENTRY_CODECS[line.field];
        const changes = codec && text !== codec.read(line.entry) ? codec.write(text) : null;
        if (!changes) return;
        // The bank changes here at once, so a dropped response cannot lose it
        setBank((b) => ({
          ...b,
          entries: b.entries.map((e) => (e.id === line.entry.id ? { ...e, ...changes } : e)),
        }));
        const current = begin();
        const { error } = await updateEntry(line.entry.id, changes);
        if (!current()) return;
        if (error) {
          setSaving(false);
          return setError(error);
        }
        return renderAgain(current);
      }
      if (line?.kind === "header") {
        const codec = HEADER_CODECS[line.field];
        const changes = codec && text !== codec.read(header) ? codec.write(text) : null;
        if (!changes) return;
        await saveHeader(changes);
      }
    },
    [apply, bank, begin, choices, header, renderAgain, saveHeader],
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
      placed.current = null;
      setSelected(key);
    },
    [flush],
  );

  useEffect(() => {
    const clear = (event: KeyboardEvent) => event.key === "Escape" && select(null);
    window.addEventListener("keydown", clear);
    return () => window.removeEventListener("keydown", clear);
  }, [select]);

  // On a desktop, a press outside the page, the bar and the assistant (each
  // marked KEEPS_SELECTION) saves the line and clears the selection. The
  // assistant keeps it: it acts on the selected line. The phone editor
  // covers the screen and closes its own sheet.
  useEffect(() => {
    if (!selected || phone) return;
    const away = (event: PointerEvent) => {
      if (!(event.target as Element).closest?.(`[${KEEPS_SELECTION}]`)) select(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [selected, phone, select]);

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
    rememberFitUndo(data.undo.bullets?.length || data.undo.entries?.length ? data.undo : null);
    const fresh = await getChoices(resumeId);
    if (!current()) return;
    setSaving(false);
    if (fresh.data) setChoices(fresh.data);
  }

  function rememberFitUndo(undo: ChoicesUpdate | null) {
    setFitUndo(undo);
    keepFitUndo(resumeId, undo);
  }

  // A Fit's Undo from before a reload comes back after mount, never in the
  // first render, which must match the server's (it has no sessionStorage).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a one-time restore from storage
    setFitUndo(readFitUndo(resumeId));
  }, [resumeId]);

  function undoFit() {
    if (!fitUndo) return;
    void apply(fitUndo);
    rememberFitUndo(null);
  }

  const box = rendered?.boxes.find((b) => boxKey(b) === selected);
  const line = box ? lineOf(bank, box) : null;

  function startText(line: Line) {
    if (line.kind === "bullet") return wording(choices, line.bullet);
    if (line.kind === "entry") return ENTRY_CODECS[line.field]?.read(line.entry) ?? null;
    if (line.kind === "header") return HEADER_CODECS[line.field]?.read(header) ?? null;
    return null;
  }

  /** Focuses a field once per selection, with the caret where the press
   *  landed on the PDF (the field's text sits over the same glyphs), or at
   *  the end. */
  function focusAt(key: string, element: HTMLInputElement | HTMLTextAreaElement | null) {
    if (!element || placed.current === key) return;
    placed.current = key;
    element.focus({ preventScroll: true });
    const at = pressed.current;
    const origin = pages.current?.getBoundingClientRect();
    const caret =
      at && origin && document.caretPositionFromPoint?.(origin.left + at.x, origin.top + at.y);
    const offset = caret && caret.offsetNode === element ? caret.offset : element.value.length;
    element.setSelectionRange(offset, offset);
  }

  function field(target: RenderBox) {
    const start = line && startText(line);
    if (start == null || !line) return null;
    const key = boxKey(target);
    const look = typeOf(
      target.kind,
      line.kind === "entry" || line.kind === "bullet" ? line.entry.section : null,
    );
    const common = {
      ref: (element: HTMLInputElement | HTMLTextAreaElement | null) => focusAt(key, element),
      value: draft?.key === key ? draft.text : start,
      "aria-label": kindLabel(target.kind),
      onBlur: flush,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        type(key, e.target.value),
      // Enter saves the line and clears the selection, back to the page
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        select(null);
      },
      className: cn(
        latinModern.className,
        // A negative margin puts the side padding outside the text, so the
        // text lands on the PDF's own glyphs. The ring alone outlines it: a
        // shadow read as a soft second edge under the line. 1.5px: at 2px
        // the user found it too thick over the page's fine type.
        "bg-panel text-ink ring-brand -mx-[0.4cqw] block resize-none overflow-hidden rounded-[2px] px-[0.4cqw] ring-[1.5px] outline-none",
        "field-sizing-content",
        look.bold && "font-bold",
        look.italic && "italic",
      ),
    };
    const size = {
      fontSize: pt(look.size),
      lineHeight: pt(look.size * LINE_HEIGHT),
      // Puts the field's baseline on the PDF's
      marginTop: pt(boxAscent(target.kind) - FIELD_BASELINE * look.size),
    };
    return WRAPS.has(target.kind) ? (
      <textarea
        {...common}
        rows={1}
        style={{ ...size, width: `calc(${pt(RIGHT_EDGE - target.x0)} + 0.8cqw)` }}
      />
    ) : (
      <input {...common} style={{ ...size, minWidth: pt(40) }} />
    );
  }

  const drawn = () => {
    if (started.current == null) return;
    setElapsed(Math.round(performance.now() - started.current));
    started.current = null;
  };

  const hide = (changes: ChoicesUpdate) => {
    apply(changes);
    select(null);
  };
  const assistant = (onClose?: () => void, className?: string) => (
    <Assistant
      resumeId={resumeId}
      bank={bank}
      choices={choices}
      line={line?.kind === "header" ? null : line}
      pageCount={rendered?.page_count ?? 1}
      onApply={apply}
      onHide={hide}
      onFit={fit}
      onClose={onClose}
      className={className}
    />
  );

  // A phone shows it only with no line's sheet open, which it would cover.
  const fitToast = toast && rendered && !(phone && selected) && (
    <FitToast
      pages={rendered.page_count}
      linesOver={rendered.lines_over}
      disabled={saving}
      onFit={() => {
        setToast(false);
        fit();
      }}
      onClose={() => setToast(false)}
      className={phone ? "inset-x-4 bottom-24" : "right-6 bottom-6 w-[22rem]"}
    />
  );

  /** The page area: `draw`n from the PDF in hand, or, until the first
   *  render lands, its skeleton and then FirstRenderPane's error if it
   *  failed. Both layouts draw their pages through it. */
  const pdfPane = (draw: (pdf: RenderedPdf) => ReactNode) =>
    rendered ? (
      draw(rendered)
    ) : (
      <Suspense fallback={<PageSkeleton />}>
        <FirstRenderPane initial={initial} onLoad={adopt} onFail={fail} resumeId={resumeId} />
      </Suspense>
    );
  // Tailor's review, on Tailor's page only (`suggestions`)
  const reviewing = suggestions && review ? review : null;
  const cards = reviewing ? cardsOf(reviewing.edits, choices) : undefined;
  // Every changed line has a dot; only the lines of the card in focus or
  // open are tinted
  const allMarks = reviewing ? marksOf(reviewing.edits, choices) : undefined;
  const litEdits = reviewing?.edits.filter((edit) => [focused, active].includes(editKey(edit)));
  const lit = new Set(litEdits?.flatMap((edit) => linesOf(edit, choices)));
  const marks = allMarks && new Map([...allMarks].filter(([line]) => lit.has(line)));
  const dots =
    allMarks &&
    new Map([...allMarks].map(([line, mark]) => [line, { mark, lit: lit.has(line) }] as const));
  const focusedEdit = reviewing?.edits.find((edit) => editKey(edit) === focused);
  const focus = focusedEdit ? linesOf(focusedEdit, choices) : undefined;
  /** A click on a line selects it, and a changed one also opens its card. */
  const onLine = (key: string) => {
    select(selected === key ? null : key);
    const card = cards?.get(key);
    if (card) setActive(card);
  };
  /** A click on a margin dot opens its card (on a phone, in the sheet). */
  const onDot = (key: string) => {
    const card = cards?.get(key);
    if (!card) return;
    setActive(card);
    setSuggestionsOpen(true);
  };
  const panel =
    reviewing &&
    suggestions?.({
      record: reviewing,
      bank,
      choices,
      saving,
      // Accept keeps the saved change and drops it from the record
      accept: (edit) =>
        setReview({ ...reviewing, edits: reviewing.edits.filter((e) => e !== edit) }),
      reject: (edit) => void apply(revertOf({ edit }, choices), { edit }),
      acceptAll: () => setReview({ ...reviewing, edits: [] }),
      rejectAll: () => void apply(revertAll(reviewing.edits, choices)),
      focused,
      focus: setFocused,
      show: (key) => {
        setFocused(key);
        setSuggestionsOpen(false);
      },
      active,
      open: setActive,
    });
  // Beside the page, the toolbar's Suggestions shows and hides the panel;
  // the phone opens it as a sheet from its own button
  const shownPanel = side === "suggestions" && panel;
  const shownOriginal = side === "original" && original;
  /** The toolbar's switch: the panel, the original, or nothing beside the
   *  page. A hidden panel leaves no line highlighted for a card out of
   *  sight. */
  const showSide = (to: "suggestions" | "original" | null) => {
    if (side === "suggestions" && to !== "suggestions") {
      setActive(null);
      setFocused(null);
    }
    setSide(to);
  };

  if (phone) {
    const start = line && startText(line);
    return (
      <>
        <PhoneEditor
          rendered={rendered}
          hint={!(firstFailed && !rendered)}
          pages={pdfPane((pdf) => (
            <PdfPages
              pdf={pdf.pdf}
              boxes={pdf.boxes}
              selected={selected}
              onSelect={onLine}
              onDrawn={drawn}
              placeholder={<PageSkeleton />}
              marks={marks}
              focus={focus}
              dots={dots}
              onDot={onDot}
            />
          ))}
          bank={bank}
          choices={choices}
          selected={selected}
          line={line}
          box={box}
          text={start == null ? null : draft?.key === selected ? draft.text : start}
          saving={saving}
          elapsed={elapsed}
          error={error}
          fitUndo={fitUndo}
          download={download}
          bar={phoneBar}
          suggestions={
            reviewing && {
              count: reviewing.edits.length,
              panel,
              open: suggestionsOpen,
              onOpenChange: setSuggestionsOpen,
            }
          }
          actions={
            line && (
              <LineActions
                line={line}
                choices={choices}
                header={header}
                onApply={apply}
                onSaveHeader={saveHeader}
                onHide={hide}
                up={move(bank, choices, line, -1)}
                down={move(bank, choices, line, 1)}
              />
            )
          }
          assistant={assistant(undefined, "h-full rounded-none ring-0")}
          onSelect={select}
          onType={(text) => selected && type(selected, text)}
          onFlush={flush}
          onApply={apply}
          onFit={fit}
          onUndoFit={undoFit}
        />
        {fitToast}
      </>
    );
  }

  const bar = (
    <Bar
      compact={compact}
      line={line}
      box={box}
      bank={bank}
      choices={choices}
      header={header}
      rendered={rendered}
      hint={!(firstFailed && !rendered)}
      saving={saving}
      elapsed={elapsed}
      fitUndo={fitUndo}
      download={download}
      onApply={apply}
      onSaveHeader={saveHeader}
      onClose={() => select(null)}
      onFit={fit}
      onUndoFit={undoFit}
      onAsk={asking ? undefined : () => setAsking(true)}
      review={
        reviewing && {
          count: reviewing.edits.length,
          side,
          onSide: showSide,
          hasOriginal: Boolean(original),
        }
      }
    />
  );
  // The column beside the page sticks level with the toolbar over the page
  const sideColumn =
    "overflow-y-auto overscroll-contain @4xl/main:sticky @4xl/main:top-2 @4xl/main:max-h-[calc(100dvh-8rem)]";

  const grid = (
    <div
      className={cn(
        "grid items-start gap-5",
        !compact && "mt-4",
        asking && "@4xl/main:grid-cols-[minmax(0,1fr)_22rem]",
        shownPanel && !asking && "@4xl/main:grid-cols-[minmax(0,1fr)_22.5rem]",
        // The two resumes at one width, so a line reads against its twin
        shownOriginal && !asking && "@4xl/main:grid-cols-2",
      )}
    >
      <div className={cn("flex min-w-0 flex-col", compact ? "gap-2" : "gap-4")}>
        {!compact && heading}
        {bar}
        {error && (
          <p role="alert" className="text-note text-danger">
            {error}
          </p>
        )}
        <DownloadNotes download={download} />
        <div
          ref={pages}
          data-keeps-selection
          onPointerDownCapture={(e) => {
            const origin = e.currentTarget.getBoundingClientRect();
            pressed.current = { x: e.clientX - origin.left, y: e.clientY - origin.top };
          }}
        >
          {pdfPane((pdf) => (
            <PdfPages
              pdf={pdf.pdf}
              boxes={pdf.boxes}
              selected={selected}
              onSelect={onLine}
              field={field}
              onDrawn={drawn}
              placeholder={<PageSkeleton />}
              marks={marks}
              focus={focus}
              dots={dots}
              onDot={onDot}
            />
          ))}
        </div>
        {/* Putting an item back renders again, so it waits for the first. */}
        {rendered && <Tray bank={bank} choices={choices} onPutBack={apply} />}
      </div>
      {/* Kept mounted while closed, so the chat survives closing it */}
      <div
        data-keeps-selection
        className={cn(
          "h-[min(40rem,calc(100dvh-8rem))] min-h-[24rem] @4xl/main:sticky @4xl/main:top-4",
          !asking && "hidden",
        )}
      >
        {assistant(() => setAsking(false), "animate-rise h-full")}
      </div>
      {/* Tailor's suggestions share the assistant's column and give way to
          it while it is open. Above the page on a narrow screen. */}
      {shownPanel && !asking && (
        <div
          data-keeps-selection
          className={cn(sideColumn, "max-h-scroll-box -order-1 @4xl/main:order-none")}
        >
          {shownPanel}
        </div>
      )}
      {/* The original beside the page; under it on a narrow screen */}
      {shownOriginal && !asking && <div className={sideColumn}>{shownOriginal}</div>}
      {fitToast}
    </div>
  );
  if (!compact) return grid;
  // The title spans the page and the column beside it, so the column starts
  // level with the toolbar. The toolbar spanned both too for a day, which
  // put the panel under it, apart from the page it reviews
  return (
    <div className="mt-4 flex flex-col gap-3">
      {heading}
      {grid}
    </div>
  );
}

/** The sticky bar's box, shared with EditorSkeleton. The brand tint, not the
 *  surface: a secondary button is filled with the surface colour, so on a
 *  surface bar Download and Done showed only as outlines (KAN-258). */
const BAR =
  "bg-brand-tint/95 ring-brand-pale sticky top-2 z-20 flex min-h-12 flex-wrap items-center gap-2 rounded-2xl p-1.5 pl-3 shadow-sm ring-1 backdrop-blur";

/** The sticky bar above the page: the selected line's actions, or the
 *  page-count chip and Fit to One Page, then Download and Ask Scout at its
 *  end. Sticky, so a line's actions never cover the lines around it (user
 *  story 63), and Download stays in reach down a two-page resume. */
function Bar({
  compact,
  line,
  box,
  bank,
  choices,
  header,
  rendered,
  hint,
  saving,
  elapsed,
  fitUndo,
  download,
  onApply,
  onSaveHeader,
  onClose,
  onFit,
  onUndoFit,
  onAsk,
  review,
}: {
  /** The slim row (Tailor's review), see `Editor`'s `compact`. */
  compact: boolean;
  line: Line | null;
  box: RenderBox | undefined;
  bank: Bank;
  choices: Choices;
  header: Header;
  /** Null until the first render lands. */
  rendered: RenderedPdf | null;
  /** Shows "Click a line to edit it."; off once the first render failed. */
  hint: boolean;
  saving: boolean;
  elapsed: number | null;
  fitUndo: ChoicesUpdate | null;
  download: ResumeDownload;
  onApply: (changes: ChoicesUpdate) => void;
  onSaveHeader: (changes: Partial<Header>) => void;
  onClose: () => void;
  onFit: () => void;
  onUndoFit: () => void;
  /** Opens the assistant; absent while it is open. */
  onAsk?: () => void;
  /** Tailor's review tools on the slim bar: Suggestions and View Original. */
  review?: ReviewTools | null;
}) {
  if (compact) {
    return (
      <SlimBar
        rendered={rendered}
        saving={saving}
        elapsed={elapsed}
        fitUndo={fitUndo}
        onFit={onFit}
        onUndoFit={onUndoFit}
        review={review}
        editing={
          line &&
          box && (
            <>
              <span className="text-note text-ink-meta font-semibold">{kindLabel(box.kind)}</span>
              <LineActions
                movesFirst
                line={line}
                choices={choices}
                header={header}
                onApply={onApply}
                onSaveHeader={onSaveHeader}
                onHide={(changes) => {
                  onApply(changes);
                  onClose();
                }}
                up={move(bank, choices, line, -1)}
                down={move(bank, choices, line, 1)}
              />
            </>
          )
        }
      />
    );
  }
  return (
    <div
      data-keeps-selection
      className={BAR}
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
            header={header}
            onApply={onApply}
            onSaveHeader={onSaveHeader}
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
          {/* The way in, first and in ink with a brand glyph: as a grey note
              after the page count it read as fine print (KAN-258). */}
          {hint && (
            <span className="text-label text-ink flex items-center gap-1.5 font-medium">
              <CursorClickIcon aria-hidden className="text-brand size-4 shrink-0" />
              Click a line to edit it.
            </span>
          )}
          {/* The page count only when it is a problem, joined to its fix. A
              green "1 page" said what the page itself shows, and stood
              apart from everything else in the bar (KAN-258). */}
          {rendered && rendered.page_count > 1 && (
            <FitNotice
              label={pageLabel(rendered.page_count, rendered.lines_over)}
              onFit={onFit}
              disabled={saving}
            />
          )}
          {fitUndo && (
            <Button variant="secondary" size="sm" onClick={onUndoFit} disabled={saving}>
              <ArrowUUpLeftIcon aria-hidden /> Undo
            </Button>
          )}
        </>
      )}
      {/* The bar's end wraps as one, so on a narrow page Download and Ask
          Scout stay together at the right rather than Ask Scout alone. */}
      <div className="ml-auto flex items-center gap-2">
        <span className="text-note text-ink-meta pr-2" aria-live="polite">
          {saving ? "Saving…" : elapsed != null ? `Saved, ${elapsed} ms` : ""}
        </span>
        <DownloadMenu download={download} />
        {/* The editor's primary action, so the brand fill: it was an outline,
            as quiet as Fit to One Page (KAN-258). */}
        {/* Off until the first render lands: the assistant reads its
            page count and acts through renders. */}
        {onAsk && (
          <Button size="sm" onClick={onAsk} disabled={!rendered}>
            <SparkleIcon /> Ask Scout
          </Button>
        )}
      </div>
    </div>
  );
}

/** The slim bar's review tools: the changes left, and which column shows
 *  beside the page. */
type ReviewTools = {
  count: number;
  side: "suggestions" | "original" | null;
  onSide: (side: "suggestions" | "original" | null) => void;
  /** False when the run's record names no source resume. */
  hasOriginal: boolean;
};

/** The slim bar's box: a quiet white row, not the brand-tinted bar. */
const SLIM_BAR =
  "bg-panel/95 ring-border-subtle sticky top-2 z-20 flex min-h-10 flex-wrap items-center gap-2 rounded-xl px-2 py-1 ring-1 backdrop-blur";

/**
 * Undo and Redo, first on the slim bar in both its states. UI only for now
 * (2026-10-26): the editor keeps no history yet, so both stay disabled
 * until it does. Undo Fit stays its own button after a fit.
 */
function History() {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button variant="ghost" size="icon-sm" aria-label="Undo" title="Undo" disabled>
        <ArrowUUpLeftIcon aria-hidden />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Redo" title="Redo" disabled>
        <ArrowUUpRightIcon aria-hidden />
      </Button>
      <span aria-hidden className="bg-border-subtle mx-1 h-5 w-px" />
    </div>
  );
}

/**
 * The slim bar (Tailor's review), over the page with the column beside it
 * starting level, its tools grouped by what they act on. At the left, the
 * page: Undo and Redo (`History`), then, idle, the page count as a chip
 * that offers Fit to One Page (over one page only) and Undo Fit after a
 * fit. No "Click a line to edit it." hint: the pointer's own highlight on
 * a line says so, and the hint was one more thing in a full row. At the
 * right, what sits beside the page:
 * one switch, Suggestions (with its count) or Original, and pressing the
 * chosen one again leaves the page alone; they were two buttons, which
 * read as two separate actions though only one can show. Editing a line
 * (`editing`): its kind, its moves first, then Hide and the line's own
 * choices, and "Esc when done" in place of a Done button, since Escape or
 * a click off the page already saves and closes.
 *
 * Download and Finish are the review's ways out, so they sit in the page's
 * top row (`TailorReviewBar`), not here; with Download, View Original and
 * Suggestions all here the bar wrapped to two rows beside the panel. No
 * Ask Scout here: the panel holds the column the assistant would open in,
 * and a second AI entry beside it split the page's attention. The bar
 * spanned the page and the panel for a day, which put the panel under it,
 * apart from the page; the panel folded to a rail of its own (») until the
 * user found it dated.
 */
function SlimBar({
  rendered,
  saving,
  elapsed,
  fitUndo,
  onFit,
  onUndoFit,
  review,
  editing,
}: {
  rendered: RenderedPdf | null;
  saving: boolean;
  elapsed: number | null;
  fitUndo: ChoicesUpdate | null;
  onFit: () => void;
  onUndoFit: () => void;
  review?: ReviewTools | null;
  /** The open line's label and actions, or nothing while idle. */
  editing: ReactNode;
}) {
  const status = (
    <span className="text-note text-ink-meta pr-1" aria-live="polite">
      {saving ? "Saving…" : elapsed != null ? `Saved, ${elapsed} ms` : ""}
    </span>
  );
  if (editing) {
    return (
      <div
        data-keeps-selection
        className={SLIM_BAR}
        // A press on a button keeps focus in the field, so it does not blur and save first
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) e.preventDefault();
        }}
      >
        <History />
        {editing}
        <div className="ml-auto flex items-center gap-2">
          {status}
          <span className="text-note text-ink-meta">
            <kbd className="bg-ink/5 rounded-xs px-1 font-sans">Esc</kbd> when done
          </span>
        </div>
      </div>
    );
  }
  return (
    <div data-keeps-selection className={SLIM_BAR}>
      <History />
      {rendered && rendered.page_count > 1 && (
        <PagesChip
          pages={rendered.page_count}
          linesOver={rendered.lines_over}
          disabled={saving}
          onFit={onFit}
        />
      )}
      {fitUndo && (
        <Button variant="ghost" size="xs" onClick={onUndoFit} disabled={saving}>
          <ArrowUUpLeftIcon aria-hidden /> Undo Fit
        </Button>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {status}
        {review && (
          <SegmentedToggle
            label="Beside the resume"
            value={review.side}
            onValueChange={(to) => review.onSide(to as "suggestions" | "original")}
            onClear={() => review.onSide(null)}
            options={[
              {
                value: "suggestions",
                ariaLabel: `Suggestions, ${review.count}`,
                label: (
                  <>
                    Suggestions
                    <span className="bg-brand text-on-brand flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums">
                      {review.count}
                    </span>
                  </>
                ),
              },
              ...(review.hasOriginal ? [{ value: "original", label: "Original" }] : []),
            ]}
          />
        )}
      </div>
    </div>
  );
}

/** The page count as a small amber chip with a warning sign and a caret,
 *  so it reads as a problem to open; its click offers Fit to One Page. As
 *  bare text ("2 pages") nobody took it for a button. */
function PagesChip({
  pages,
  linesOver,
  disabled,
  onFit,
}: {
  pages: number;
  linesOver: number;
  disabled: boolean;
  onFit: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="bg-warning-tint text-warning text-note focus-visible:ring-brand-ring hover:ring-warning-fill flex items-center gap-1.5 rounded-full py-1 pr-2 pl-2 font-medium transition-shadow hover:ring-1 focus-visible:ring-2 focus-visible:outline-none">
        <WarningIcon aria-hidden weight="fill" className="text-warning-strong size-4 shrink-0" />
        {pages} pages
        <ChevronDownIcon className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-72 flex-col gap-3">
        <p className="text-note text-ink-muted">
          {linesOver > 0
            ? `About ${linesOver} ${linesOver === 1 ? "line runs" : "lines run"} onto page 2.`
            : `It runs to ${pages} pages.`}{" "}
          Fit to One Page hides the least useful lines until it fits.
        </p>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => {
            setOpen(false);
            onFit();
          }}
        >
          <ScissorsIcon aria-hidden /> Fit to One Page
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function LineActions({
  movesFirst = false,
  line,
  choices,
  header,
  onApply,
  onSaveHeader,
  onHide,
  up,
  down,
}: {
  /** Up and down lead, before Hide (the slim bar's order). */
  movesFirst?: boolean;
  line: Line;
  choices: Choices;
  header: Header;
  onApply: (changes: ChoicesUpdate) => void;
  onSaveHeader: (changes: Partial<Header>) => void;
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
        <ArrowUpIcon aria-hidden />
      </Button>
      <Button
        variant="secondary"
        size="sm"
        aria-label="Move Down"
        disabled={!down}
        onClick={() => down && onApply(down)}
      >
        <ArrowDownIcon aria-hidden />
      </Button>
    </>
  );

  if (line.kind === "header") {
    // A contact the profile lacks has no line to click, so it is added
    // here: the phone, and the next link, keeping the bar one row
    const link = LINK_FIELDS.find((f) => !header[f]);
    const missing = [
      ...(header.phone_number ? [] : (["phone_number"] as const)),
      ...(link ? [link] : []),
    ];
    return (
      <>
        {line.field === "email" && (
          <span className="text-note text-ink-meta">
            This is your sign-in email, so it changes with your account.
          </span>
        )}
        {missing.map((f) => (
          <AddContact key={f} field={f} onSave={onSaveHeader} />
        ))}
      </>
    );
  }

  if (line.kind === "skill") {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onHide({ skills: [{ skill_id: line.skill.id, shown: false }] })}
      >
        <EyeSlashIcon aria-hidden /> Hide
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
        {movesFirst && moves}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onHide({ bullets: [{ bullet_id: id, shown: false }] })}
        >
          <EyeSlashIcon aria-hidden /> Hide
        </Button>
        {!movesFirst && moves}
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
      {movesFirst && moves}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onHide({ entries: [{ entry_id: entry.id, shown: false }] })}
      >
        <EyeSlashIcon aria-hidden /> Hide Entry
      </Button>
      {!movesFirst && moves}
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
      {!typed(line) && (
        <span className="text-note text-ink-meta">
          Change this in <TextLink href="/bank">Experiences</TextLink>.
        </span>
      )}
    </>
  );
}

/** A short field in the bar that adds a contact the header lacks; Enter or
 *  leaving it saves to the profile. */
function AddContact({
  field,
  onSave,
}: {
  field: Exclude<HeaderField, "full_name" | "email">;
  onSave: (changes: Partial<Header>) => void;
}) {
  const label = `Add ${kindLabel(field)}`;
  function save(element: HTMLInputElement) {
    const text = element.value.trim();
    if (!text) return;
    const changes = HEADER_CODECS[field]?.write(text);
    if (changes) onSave(changes);
    element.value = "";
  }
  return (
    <input
      aria-label={label}
      placeholder={label}
      onBlur={(e) => save(e.currentTarget)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className="text-note bg-panel text-ink ring-border-subtle focus:ring-brand h-9 w-36 rounded-lg px-2 ring-1 outline-none focus:ring-2"
    />
  );
}

/**
 * Where the first PDF is drawn, while the page's render is on its way: it
 * suspends on the render (the editor wraps it in a <Suspense> over a
 * PageSkeleton), then hands a PDF to the editor, which draws it from then
 * on, or shows why it did not come. The same skeleton stays up for the one
 * frame before the editor takes it.
 */
function FirstRenderPane({
  initial,
  onLoad,
  onFail,
  resumeId,
}: {
  initial: FirstRender;
  onLoad: (pdf: RenderedPdf) => void;
  onFail: () => void;
  resumeId: string;
}) {
  const { data, error } = use(initial);
  useEffect(() => {
    if (data) onLoad(data);
    else onFail();
  }, [data, onLoad, onFail]);

  if (data) return <PageSkeleton />;
  return (
    <EmptyState
      Icon={CloudSlashIcon}
      title="This Resume Isn't Loading Right Now"
      action={
        // A plain link: a full reload is what renders it again.
        <a
          href={`/resumes/${encodeURIComponent(resumeId)}`}
          className={buttonClasses({ variant: "secondary", size: "sm" })}
        >
          Try Again
        </a>
      }
    >
      {error}
    </EmptyState>
  );
}

/**
 * The desktop editor before anything has loaded, for ./loading.tsx: the
 * sticky bar's box with its way in and its end as bars, over a page's
 * skeleton, in the editor's own column, so the editor that replaces it
 * keeps every edge where it was.
 */
export function EditorSkeleton() {
  return (
    <div aria-hidden="true" className="mt-4 grid items-start gap-5">
      <div className="flex min-w-0 flex-col gap-4">
        <div className={BAR}>
          <Skeleton className="h-4 w-36" />
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>
        <PageSkeleton />
      </div>
    </div>
  );
}
