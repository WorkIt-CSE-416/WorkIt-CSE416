"use client";

import {
  ArrowDownIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  ArrowUpIcon,
  CloudSlashIcon,
  EyeIcon,
  EyeSlashIcon,
  LightbulbIcon,
  ListDashesIcon,
  ScissorsIcon,
  SlidersHorizontalIcon,
  StackIcon,
  TextBIcon,
  TextItalicIcon,
} from "@phosphor-icons/react/ssr";
import localFont from "next/font/local";
import {
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";

import { CloseIcon, FileIcon, PlusIcon } from "@/components/icons";
import { setScoutOpen, useScout } from "@/components/scout/scout-store";
import { ScoutTakeover } from "@/components/scout/scout-takeover";
import { Skeleton } from "@/components/shadcn/skeleton";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { TextLink } from "@/components/ui/text-link";
import { addBullet, getBank, type Bank } from "@/lib/bank-actions";
import {
  fitToOnePage,
  getChoices,
  renderResumePdf,
  resumeChangedAt,
  saveLine,
  savePageSettings,
  updateChoices,
  type Choices,
  type ChoicesUpdate,
  type EditRendered,
  type PageSettings,
  type ResumeCopy,
  type RenderBox,
  type RenderedPdf,
} from "@/lib/built-resume-actions";
import type { Result } from "@/lib/applicant-call";
import { cn } from "@/lib/cn";
import { markResumesStale } from "@/lib/resumes-stale";

import {
  DownloadMenu,
  DownloadNotes,
  useResumeDownload,
  type ResumeDownload,
} from "../download-menu";
import { bulletPlaced, NEW_BULLET } from "./add-bullet";
import { Assistant } from "./assistant";
import { FitToast } from "./fit-notice";
import { Zoom, useZoom, zoomWidth } from "./zoom";
import { TitleHistoryContext, type ApplyName, type TitleHistory } from "./resume-title";
import {
  addCuts,
  cutLeft,
  HEADER,
  LINK_FIELDS,
  lineOf,
  NO_CUTS,
  mergeChoices,
  move,
  shownBullets,
  withWording,
  swapOf,
  typed,
  type Swap,
  type Header,
  type HeaderField,
  type Line,
} from "./model";
import { hideAgain, push, reverseChoices, reverseLine, type Edit, type Step } from "./history";
import {
  afterStrips,
  boxKey,
  kindLabel,
  loadPdfjs,
  PageSkeleton,
  PdfPages,
  type Strip,
} from "./pdf-pages";
import {
  DEFAULT_PAGE,
  FONTS,
  FormatOptions,
  ON,
  PanelButton,
  SidePanel,
  SizeStepper,
  sizeOf,
  TEXT_ROLES,
  textRoleOf,
  type TextRole,
} from "./page-format";
import { PhoneEditor, usePhone } from "./phone";
import { SectionsOutline } from "./sections-panel";
import { SLIM_BAR } from "./slim-bar";
import { readMarked, runs, showMarked, unmarked } from "./text-marks";
import {
  cardsOf,
  editKey,
  linesOf,
  marksOf,
  reverted,
  revertAll,
  revertOf,
  type RevertTarget,
  wordsBack,
  type SuggestionPopupApi,
  type SuggestionsApi,
  untouched,
  useTailorReview,
} from "./tailor-review";
import { CutPicker, ExperiencesPicker } from "./experiences-picker";
import { keepFitCuts, readFitCuts } from "./fit-cuts";

/**
 * The desktop editor (KAN-218): the built resume's own PDF, edited on the
 * page. Click a line and type: the field over it shows the text at once,
 * and leaving the line (a click away, Enter, Escape) sends it, only when it
 * differs from what the line prints. Each edit is two requests side by side
 * (KAN-391): `renderEdit` renders it from the editor's copy, reading no
 * database, and `saveLine` or `updateChoices` saves it, writing with no
 * read first. Neither waits for the other. The API reads the text, so a
 * bullet becomes this resume's local variant, an entry's typed field
 * changes the bank and the header's the profile, and the browser holds
 * none of those rules. A save that fails puts the saved resume back
 * (`reload`). The field opens on the box's own printed text. The field is set in Latin Modern,
 * the PDF's own font, at the line's size and weight, and opens with the
 * caret where the click landed, so typing starts where the student
 * pointed and wraps where the PDF does. The sticky bar holds the
 * selected line's actions, or the page-count chip and Fit to One Page. Every
 * save bumps one request counter, and a response older than the latest
 * request is dropped, so a slow render never paints over a newer edit.
 * On a phone-width screen the same state is laid out by `PhoneEditor`
 * (KAN-219, ./phone.tsx). The assistant (KAN-221, ./assistant.tsx) opens
 * in Scout's panel from the top bar's Scout (`ScoutTakeover`), or in a
 * sheet on a phone, and acts through the same saves. On Tailor's page
 * (`suggestions`), each change the run made is tinted and has a card in
 * the Suggestions panel beside the page, to undo; an edit of
 * a changed item through `apply` drops that change.
 *
 * THE FIRST PDF STREAMS IN (KAN-368). The page starts the render and hands
 * it over unawaited (`initial`), since the LaTeX compile is the slowest read
 * in the app (0.7 to 1s): the bar, the title and Back draw at once, and the
 * page area alone waits, over a page-shaped skeleton (FirstRenderPane, in a
 * <Suspense>, reads it). Until it lands there is nothing to click (the click
 * targets are the render's boxes, KAN-209), the assistant and Not on
 * This Resume wait too, and a render that fails shows its own error in the page
 * area. pdf.js starts downloading as the editor mounts, so it is ready when
 * the PDF is. An edit's render never loses to the first one: the first is
 * taken only while there is no other.
 */

// The attribute on the parts of the editor a press may land on without
// clearing the selected line
const KEEPS_SELECTION = "data-keeps-selection";

/** The panel's mark while it shows Cut From Resume: Fit's scissors, amber. */
const CUT_MARK = (
  <span className="bg-warning-tint text-warning flex size-8 shrink-0 items-center justify-center rounded-2xl">
    <ScissorsIcon aria-hidden className="size-4.5" weight="duotone" />
  </span>
);

/** The panel's mark while it shows the Experiences picker: the toolbar
 *  button's glyph, so what opened it is what it wears, and not Scout's. */
const EXPERIENCES_MARK = (
  <span className="bg-brand-tint text-brand flex size-8 shrink-0 items-center justify-center rounded-2xl">
    <StackIcon aria-hidden className="size-4.5" weight="duotone" />
  </span>
);

// Letter is 612 pt wide; field type is set in cqw of the page so it matches
// the PDF's at any width.
const PAGE_WIDTH = 612;
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

/** Jake's type for each kind of line on this page: its size in points, and
 *  whether it is bold or italic. */
function typeOf(kind: string, section: string | null, page: PageSettings) {
  const size = sizeOf(textRoleOf(kind, section), page);
  // \scshape has no bold small capitals in Latin Modern, so the name prints bold
  if (kind === "full_name") return { size, bold: true, italic: false };
  if (kind === "title") return { size, bold: true, italic: false };
  if (kind === "organization") return { size, bold: false, italic: true };
  // Education's location is the heading's right slot, upright
  if (kind === "location") return { size, bold: false, italic: section !== "education" };
  return { size, bold: false, italic: false };
}

// Where a field's first baseline sits below its top, in ems: Latin Modern's
// ascent (1.127) less half the leading its line height takes from its 1.417
// em content area. A box's top is its first baseline less ASCENT (the API's
// resume_render), more for the name.
const LINE_HEIGHT = 1.2;
// A box's height for one line (`boxAscent`'s 8 pt over a baseline and the
// API's 3 pt under it), and how far left of a bullet's text its dot sits
const BOX_HEIGHT = 11;
const DOT_GAP = 8.5;
const fieldBaseline = (lineHeight: number) => 1.127 - (1.417 - lineHeight) / 2;
const boxAscent = (kind: string) => (kind === "full_name" ? 21 : 8);

/** The open line's field: a bullet's is a rich one, the others plain. */
type LineField = HTMLInputElement | HTMLTextAreaElement | HTMLDivElement;

/** How the open line's field is outlined. The ring alone: a shadow read as a
 *  soft second edge under the line. 1.5px: at 2px the user found it too thick
 *  over the page's fine type. */
const FIELD_RING =
  "ring-brand resize-none overflow-hidden rounded-[2px] ring-[1.5px] outline-none field-sizing-content";

/** A bullet being added (`startBullet`): which entry it joins, the shown
 *  bullet it follows (none: it goes last), the box it is drawn under, and
 *  where its text starts. `sent` once it left the field; `id` once saved. */
type Adding = {
  entry: string;
  after: string | null;
  anchor: string;
  x0: number;
  text: string;
  sent: boolean;
  id: string | null;
};

/** Lines that wrap: typed in a field as wide as the text column. */
const WRAPS = new Set(["bullet", "coursework", "honors"]);

const DEFAULT_WRAPPED_LINE = 12;

// A box reaches 8 pt above its first baseline and 3 pt below its last, and
// wrapped lines sit `wrappedLine` pt apart (the API's resume_render ASCENT,
// DESCENT and the render's `wrapped_line`): how many lines a box covers, as
// its `box_lines` counts them
const boxLines = (box: RenderBox, wrappedLine: number) =>
  1 + Math.max(0, Math.round((box.y1 - box.y0 - 11) / wrappedLine));

type Draft = { key: string; text: string };

/** The page's render of the PDF, as renderResumePdf answers it. It never
 *  rejects: a failure is its `error`. */
type FirstRender = ReturnType<typeof renderResumePdf>;

/** The API refused the edit (a resume or item not found, a line it cannot
 *  read): sent again it answers the same. */
const refused = (status: number | null) => status === 404 || status === 422;

/** A save that failed leaves the page unlike the database, unless the
 *  render refused the edit too. Only a 422 is sure to: both read the line
 *  the same way. A 404 can be the save's alone, since the render reads the
 *  editor's copy and the save the database: an entry deleted in another
 *  tab still renders here. */
const unsaved = (status: number | null) => status !== 422;

/** How long a failed render waits before it is sent once more. */
const RETRY_AFTER_MS = 500;

/** How long a tab stays hidden before its return asks whether the resume
 *  changed elsewhere (`resumeChangedAt`): a quick switch reads nothing. */
const CHECK_AFTER_MS = 5 * 60_000;

/** The editor tabs' channel: each save that lands is announced on it, so
 *  another tab showing the resume reads it again. Only a signal: each tab's
 *  copy stays in its memory and comes from the database. */
const RESUME_CHANNEL = "workit:resume-edits";

/** The bar's line after a save or a render failed and `reload` ran. */
const lostChange = (why: string | null, failed: "saved" | "shown") =>
  `Your last change could not be ${failed}${why ? ` (${why})` : ""}. The page shows your saved resume.`;

/** An edit's render (`renderEdit`, KAN-391) through `/api/resume-edit`, a
 *  route handler: as a server action it waited behind the edit's save,
 *  since Next runs one client's actions one at a time. A failure that is
 *  not a refusal (the network, a compile timed out) is sent once more:
 *  the render writes nothing and reads no database, so the same copy
 *  renders the same page. */
async function renderEdit(
  resumeId: string,
  edit:
    | { line: { item_id: string; kind: string; text: string } }
    | { changes: ChoicesUpdate }
    | { page: PageSettings },
  source?: ResumeCopy,
): Promise<Result<EditRendered>> {
  const body = JSON.stringify({ resumeId, edit, source });
  const send = async (): Promise<Result<EditRendered>> => {
    try {
      const res = await fetch("/api/resume-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      return (await res.json()) as Result<EditRendered>;
    } catch {
      return { data: null, error: "Could not reach the server.", status: null };
    }
  };
  const first = await send();
  if (first.data || refused(first.status)) return first;
  await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
  return send();
}

/** What the last PDF printed beside the resume's own content: its header,
 *  its template and its file name, sent back in every copy, so the API
 *  renders an edit without reading the resume (KAN-391). */
type Printed = Pick<ResumeCopy, "identity" | "template" | "file_name">;

/** What a request's copy is built from: the bank, the choices and what the
 *  last PDF printed (KAN-391). An Undo step keeps one on each side. */
type Held = { bank: Bank; choices: Choices; printed: Printed | null };

function printedBy(pdf: RenderedPdf): Printed | null {
  return pdf.identity
    ? { identity: pdf.identity, template: pdf.template, file_name: pdf.file_name }
    : null;
}

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
  suggestionPopup,
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
  suggestions?: ComponentType<SuggestionsApi>;
  /** The small card beside a changed line while it is open, as Docs shows a
   *  suggestion beside its text (KAN-499). */
  suggestionPopup?: ComponentType<SuggestionPopupApi>;
  /** The title row (`ResumeTitle`, renamed in place), over the page and the
   *  column beside it; on Tailor's review the step's row with the name in
   *  it (`TailorReviewBar`). */
  heading: ReactNode;
  /** The resume Tailor started from, read-only, which the toolbar's View
   *  Original sets beside the page in place of the Suggestions panel. */
  original?: ReactNode;
  /** A row the phone layout's header shows under its buttons: the page's
   *  own controls, which the full-screen phone editor would cover. */
  phoneBar?: ReactNode;
}) {
  // Null until the first render lands (FirstRenderPane hands it over).
  const [rendered, setRendered] = useState<RenderedPdf | null>(null);
  // What the next request's copy is built from (KAN-391): the bank and
  // choices as the newest answer left them, with the changes on their way
  // merged in, and the header the newest PDF printed. A ref, so a request
  // that waited for the one before reads what that one left, before React
  // has drawn it.
  const held = useRef<Held>({
    bank: initialBank,
    choices: initialChoices,
    printed: null,
  });
  // The newest PDF any render answered, which a step keeps for an instant
  // Undo; newer than `rendered` while a newer request owns the page
  const lastPdf = useRef<RenderedPdf | null>(null);
  // The page's settings (KAN-435), ahead of the PDF: a pick shows in its
  // control at once, and the next edit's copy carries it
  const [page, setPage] = useState(DEFAULT_PAGE);
  const pageNow = useRef(DEFAULT_PAGE);
  // Over the defaults: an API a deploy behind sends none
  const keepPage = useCallback((next?: Partial<PageSettings>) => {
    const whole = { ...DEFAULT_PAGE, ...next };
    pageNow.current = whole;
    setPage(whole);
  }, []);
  const adopt = useCallback(
    (first: RenderedPdf) => {
      held.current.printed ??= printedBy(first);
      lastPdf.current ??= first;
      setRendered((current) => current ?? first);
      keepPage(first.page_settings);
    },
    [keepPage],
  );
  // The first render failed: the page area says so, and the phone's bar
  // stops offering "Click a line", since there is no line to click.
  const [firstFailed, setFirstFailed] = useState(false);
  const fail = useCallback(() => setFirstFailed(true), []);
  // pdf.js downloads while the server compiles, not after.
  useEffect(() => {
    void loadPdfjs().catch(() => {});
  }, []);
  const [bank, setBank] = useState(initialBank);
  const [header, setHeader] = useState(initialHeader);
  // The header as saved, for an Undo of a link: the page prints a link
  // without "https://" or "www.", so its reverse needs the stored URL
  const headerNow = useRef(initialHeader);
  useEffect(() => {
    headerNow.current = header;
  });
  const [choices, setChoices] = useState(initialChoices);
  // Undo and Redo (./history.ts): the steps, kept in this tab's memory
  const undos = useRef<Step<Held, RenderedPdf>[]>([]);
  const redos = useRef<Step<Held, RenderedPdf>[]>([]);
  const [steps, setSteps] = useState({ undo: 0, redo: 0 });
  const countSteps = useCallback(
    () => setSteps({ undo: undos.current.length, redo: redos.current.length }),
    [],
  );
  // The choices as the API last answered them, and the changes sent since
  const confirmed = useRef(initialChoices);
  const unanswered = useRef(new Map<string, ChoicesUpdate>());
  const changeCount = useRef(0);
  // The editor's renders run one at a time, so each copy holds every
  // edit before it; a copy built while an earlier edit was on its way would
  // print that edit's old text. Saves run one at a time in their own queue
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const saves = useRef<Promise<unknown>>(Promise.resolve());
  // How many jobs the queue has been given, and which of those waiting are a
  // page's settings: a page's compile goes only if no newer page is next
  const jobs = useRef(0);
  const pageJobs = useRef(new Set<number>());
  const skippedPage = useRef(false);
  // Each typed bullet's saved wording, which the render could not know
  const wordings = useRef(new Map<string, { variant_id: string | null; text: string }>());
  // The moves on their way, shown on the page at once (./pdf-pages.tsx)
  const [swaps, setSwaps] = useState<(Swap & { id: string })[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // Typed text by box key (KAN-391): the selected line's, and each line
  // left before the PDF that prints it has painted. The page draws it over
  // the line until then, so leaving a line never shows its old text.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<Adding | null>(null);
  const finishing = useRef(false);
  // How many lines each wrapping draft shows, for the live page's shift
  const [draftLines, setDraftLines] = useState<Record<string, number>>({});
  // What is on its way, by line key or change id, counted: a line's draft
  // and a move's swap stay until the PDF after it lands
  const onTheirWay = useRef(new Map<string, number>());
  const sent = (key: string) => onTheirWay.current.set(key, (onTheirWay.current.get(key) ?? 0) + 1);
  const answered = (key: string) => {
    const left = (onTheirWay.current.get(key) ?? 1) - 1;
    if (left > 0) onTheirWay.current.set(key, left);
    else onTheirWay.current.delete(key);
  };
  // The selected line as of now, for a save that lands after it changed
  const selectedNow = useRef<string | null>(null);
  // The text last sent for each line, so a line reopened and left as it
  // was while its PDF is on its way is not sent twice
  const lastSent = useRef(new Map<string, string>());
  const drop = useCallback(
    (key: string) =>
      setDrafts((d) =>
        key in d ? Object.fromEntries(Object.entries(d).filter(([k]) => k !== key)) : d,
      ),
    [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
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
  const pending = useRef<Draft | null>(null);
  // Where the last press on the pages landed, from their top left (the bar
  // can change height as the line is selected), to put the caret there
  const pages = useRef<HTMLDivElement>(null);
  const pressed = useRef<{ x: number; y: number } | null>(null);
  const placed = useRef<string | null>(null);
  const phone = usePhone();
  // The Suggestions card in focus (its lines outlined), the card of the
  // marked line last clicked, and the phone's Suggestions sheet
  const [focused, setFocused] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  // What Tailor's review sets beside the page, picked on the toolbar: the
  // Suggestions panel, the original resume, or nothing, when the page
  // takes the room
  const [side, setSide] = useState<Side>("suggestions");
  // What the editor shows in Scout's panel (KAN-440): the assistant, or the
  // Experiences picker, opened from the toolbar. The panel shows one at a
  // time, so they share it, and there is no switch in it: the top bar's Scout
  // is the way back, and a switch only took up the panel's top. Closed, it
  // goes back to the assistant, so the top bar's Scout always opens Scout
  const scoutOpen = useScout().open;
  const [panelView, setPanelView] = useState<
    "scout" | "experiences" | "cut" | "format" | "sections"
  >("scout");
  const [panelWasOpen, setPanelWasOpen] = useState(scoutOpen);
  if (panelWasOpen !== scoutOpen) {
    setPanelWasOpen(scoutOpen);
    if (!scoutOpen) setPanelView("scout");
  }
  const showScout = useCallback(() => setPanelView("scout"), []);
  const showPanel = (view: "experiences" | "cut" | "format" | "sections") => {
    if (scoutOpen && panelView === view) return setScoutOpen(false);
    setPanelView(view);
    setScoutOpen(true);
  };
  // Tailor's marks on the page: off when so many lines changed that they get
  // in the way of reading it. The changes stay, and so does the panel
  const [showMarks, setShowMarks] = useState(true);
  // The line whose popup the student closed, so it stays closed on that line
  const [closedPopup, setClosedPopup] = useState<string | null>(null);
  /** Format Options or Sections: beside the page on Tailor's review, in
   *  Scout's panel on the editor's own page, as the Experiences picker is. */
  const togglePanel = (panel: "format" | "sections") => {
    if (suggestions) return showSide(side === panel ? null : panel);
    showPanel(panel);
  };
  const showExperiences = () => {
    showPanel("experiences");
  };
  // What Fit to One Page cut, for Cut From Resume: every fit in this tab,
  // kept in sessionStorage (./fit-cuts.ts), so a reload keeps it
  const [cuts, setCuts] = useState(NO_CUTS);
  // The latest list for a fit's queued job, whose closure can predate the
  // fit before it
  const cutsNow = useRef(NO_CUTS);
  // Restored after mount, never in the first render, which must match the
  // server's (it has no sessionStorage)
  useEffect(() => {
    cutsNow.current = readFitCuts(resumeId);
    setCuts(cutsNow.current);
  }, [resumeId]);
  const [zoom, setZoom] = useZoom();
  // The Suggestions panel, sized to the window from wherever its top is
  const fitPanel = useFitToWindow();

  /** Starts a request; the returned check stays true while it is the latest. */
  const begin = useCallback(() => {
    const request = ++latest.current;
    setSaving(true);
    setError(null);
    return () => request === latest.current;
  }, []);

  /** Runs a request after every request before it has answered. */
  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    jobs.current += 1;
    const run = queue.current.then(job);
    queue.current = run.catch(() => undefined);
    return run;
  }, []);

  /** Runs a save after every save before it. Saves have their own queue,
   *  beside the renders': a render never waits for a write, nor a write
   *  for a compile. */
  // Each save changes the resume's edited day, which the Resumes page
  // shows, so it marks that list stale: a revalidation here would render
  // this page, PDF and all, again on every edit (lib/resume-revalidate.ts).
  const queueSave = useCallback((job: () => Promise<unknown>) => {
    markResumesStale();
    saves.current = saves.current.then(job).catch(() => undefined);
  }, []);

  /** The choices an answer gave, with the changes still on their way and
   *  the typed wordings saved since. */
  const keepChoices = useCallback((answer: Choices) => {
    confirmed.current = answer;
    let next = answer;
    for (const changes of unanswered.current.values()) next = mergeChoices(next, changes);
    for (const [bullet, saved] of wordings.current)
      next = withWording(next, bullet, saved.variant_id, saved.text);
    held.current.choices = next;
    setChoices(next);
  }, []);

  const keepRendered = useCallback((next: RenderedPdf) => {
    if (next.identity) held.current.printed = printedBy(next);
    setRendered(next);
  }, []);

  /** The copy each request carries, or none before the first PDF. */
  const copy = useCallback((): ResumeCopy | undefined => {
    const { bank, choices, printed } = held.current;
    return printed
      ? {
          entries: bank.entries,
          skills: bank.skills,
          choices,
          ...printed,
          page_settings: pageNow.current,
        }
      : undefined;
  }, []);

  /** The choices with the typed wordings saved since (`withWording`). */
  const worded = useCallback((answer: Choices) => {
    let next = answer;
    for (const [bullet, saved] of wordings.current)
      next = withWording(next, bullet, saved.variant_id, saved.text);
    return next;
  }, []);

  /** The editor's state as the last answer left it, without the changes
   *  still on their way: a step's side (./history.ts). */
  const settled = useCallback(
    (): Held => ({
      bank: held.current.bank,
      choices: worded(confirmed.current),
      printed: held.current.printed,
    }),
    [worded],
  );

  /** Records a new step for an edit; a new edit ends what Redo could do. */
  const record = useCallback(
    (redo: Edit): Step<Held, RenderedPdf> => {
      const step: Step<Held, RenderedPdf> = {
        undo: null,
        redo,
        before: null,
        after: null,
        pdfBefore: null,
        pdfAfter: null,
      };
      push(undos.current, step);
      redos.current = [];
      countSteps();
      return step;
    },
    [countSteps],
  );

  /** Drops a step whose edit was refused: there is nothing to undo. */
  const forget = useCallback(
    (step: Step<Held, RenderedPdf>) => {
      undos.current = undos.current.filter((s) => s !== step);
      redos.current = redos.current.filter((s) => s !== step);
      countSteps();
    },
    [countSteps],
  );

  // A rename in the title is a step too (./resume-title.tsx): the title
  // records it and hands over its own rename, which Undo and Redo call
  const applyName = useRef<ApplyName | null>(null);
  const titleHistory = useMemo<TitleHistory>(
    () => ({
      record: (from, to) => {
        const step = record({ name: to });
        step.undo = { name: from };
        return () => forget(step);
      },
      attach: (apply) => {
        applyName.current = apply;
      },
    }),
    [forget, record],
  );

  /**
   * Puts the saved resume back after a save or a render failed, or after it
   * changed elsewhere (KAN-391; `notice` null, quiet):
   * once every save sent before has answered, the bank, the choices and a
   * PDF read from the database replace the editor's copy, and every draft
   * but the selected line's goes. The page showed the edit before it was
   * saved, so this is how a failed write undoes it; after a failed render
   * the save may still have gone through, so only the database can say
   * what the page should show.
   */
  const reload = useCallback(
    (notice: string | null) => {
      void enqueue(async () => {
        await saves.current;
        const current = begin();
        const bankRead = await getBank(resumeId);
        const choicesRead = await getChoices(resumeId);
        const pdf = await renderResumePdf(resumeId);
        unanswered.current.clear();
        wordings.current.clear();
        onTheirWay.current.clear();
        // The steps described edits the database no longer holds
        undos.current = [];
        redos.current = [];
        countSteps();
        if (pdf.data) lastPdf.current = pdf.data;
        if (bankRead.data) {
          held.current.bank = bankRead.data;
          setBank(bankRead.data);
        }
        if (choicesRead.data) keepChoices(choicesRead.data);
        setSwaps([]);
        const typing = selectedNow.current;
        setDrafts((d) => (typing && typing in d ? { [typing]: d[typing] } : {}));
        if (!current()) return;
        setSaving(false);
        if (pdf.data) keepRendered(pdf.data);
        setError(notice);
      });
    },
    [begin, countSteps, enqueue, keepChoices, keepRendered, resumeId],
  );

  // Another editor tab's save, or a long time away (KAN-391): `stale` marks
  // a copy to read again once the tab is idle, `hiddenAt` when it hid
  const stale = useRef(false);
  const hiddenAt = useRef<number | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);

  /** Reads a stale copy again, quietly, once the tab shows, no line is open
   *  and no edit is on its way: a reload under an edit would read the
   *  database before that edit's save. Busy, it waits: leaving a line and
   *  each PDF painted (`drawn`) call it again. */
  const refresh = useCallback(() => {
    if (!stale.current || document.hidden) return;
    const busy =
      selectedNow.current !== null || onTheirWay.current.size > 0 || unanswered.current.size > 0;
    if (busy) return;
    stale.current = false;
    reload(null);
  }, [reload]);

  /** Tells the other editor tabs a save landed: `shared` for what every
   *  resume prints (an entry's field, the header), else this resume's only. */
  const announce = useCallback(
    (shared: boolean) => channel.current?.postMessage({ resumeId, shared }),
    [resumeId],
  );

  useEffect(() => {
    const ours =
      typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(RESUME_CHANNEL);
    channel.current = ours;
    if (ours)
      ours.onmessage = (event: MessageEvent<{ resumeId: string; shared: boolean }>) => {
        if (event.data.resumeId !== resumeId && !event.data.shared) return;
        // Hidden, it only marks the copy: ten tabs cost one reload, the one
        // looked at
        stale.current = true;
        refresh();
      };
    const seen = async () => {
      if (document.hidden) {
        hiddenAt.current = Date.now();
        // A save still on its way lands after the tab hid, and is its own
        void saves.current.then(() => {
          if (document.hidden) hiddenAt.current = Date.now();
        });
        return;
      }
      const away = hiddenAt.current;
      hiddenAt.current = null;
      if (stale.current || away === null || Date.now() - away < CHECK_AFTER_MS) return refresh();
      // Another device, or a page that does not announce: one small read
      const { data } = await resumeChangedAt(resumeId);
      if (!data) return;
      // The database's clock read against this one, so a skewed clock
      // neither misses a change nor takes the tab's own saves for one
      const offset = Date.parse(data.now) - Date.now();
      if (Date.parse(data.changed_at) <= away + offset) return;
      stale.current = true;
      refresh();
    };
    document.addEventListener("visibilitychange", seen);
    return () => {
      document.removeEventListener("visibilitychange", seen);
      ours?.close();
      channel.current = null;
    };
  }, [refresh, resumeId]);

  /** Saves a typed line, in the save queue. The answer's bullet variant and
   *  profile go into the editor's state; a failure the render does not
   *  share puts the saved resume back (`unsaved`). */
  const sendLine = useCallback(
    (line: { item_id: string; kind: string; text: string }, source?: ResumeCopy) =>
      queueSave(async () => {
        const { data, error, status } = await saveLine(resumeId, line, source);
        if (data && line.kind === "bullet") {
          wordings.current.set(line.item_id, { variant_id: data.variant_id, text: line.text });
          keepChoices(confirmed.current);
        }
        if (data?.profile) setHeader(data.profile);
        if (data) announce(line.kind !== "bullet");
        if (!data && unsaved(status)) reload(lostChange(error, "saved"));
      }),
    [announce, keepChoices, queueSave, reload, resumeId],
  );

  /** Saves choice changes, in the save queue. */
  const sendChoices = useCallback(
    (changes: ChoicesUpdate) =>
      queueSave(async () => {
        const { error, status } = await updateChoices(resumeId, changes);
        if (!error) announce(false);
        if (error && unsaved(status)) reload(lostChange(error, "saved"));
      }),
    [announce, queueSave, reload, resumeId],
  );

  /** Saves the page's settings, in the save queue. */
  const sendPage = useCallback(
    (settings: PageSettings) =>
      queueSave(async () => {
        const { error, status } = await savePageSettings(resumeId, settings);
        if (error && status !== 404 && status !== 422) reload(error);
      }),
    [queueSave, reload, resumeId],
  );

  /** New page settings: they show in their control at once, the save goes
   *  beside the render, and the page changes when the PDF lands. `record:
   *  false` for an Undo or Redo sent as an edit (`travel`). */
  const applyPage = useCallback(
    async (settings: PageSettings, recorded = true) => {
      const step = recorded ? record({ page: settings }) : null;
      if (step) step.undo = { page: pageNow.current };
      keepPage(settings);
      sendPage(settings);
      const job = jobs.current + 1;
      pageJobs.current.add(job);
      return enqueue(async () => {
        pageJobs.current.delete(job);
        // Each click on a size or a font is a compile, one at a time, and
        // the next page replaces this one whole, so five quick clicks compile
        // the first and the last. A skipped step keeps no PDF, and neither
        // does the step's before after it: Undo renders those
        if (pageJobs.current.has(job + 1)) {
          skippedPage.current = true;
          return;
        }
        const current = begin();
        started.current = performance.now();
        if (step) {
          step.before = settled();
          step.pdfBefore = skippedPage.current ? null : lastPdf.current;
        }
        skippedPage.current = false;
        const { data, error } = await renderEdit(resumeId, { page: settings }, copy());
        if (data) {
          lastPdf.current = data.render;
          if (step) {
            step.after = settled();
            step.pdfAfter = data.render;
          }
        } else if (step) forget(step);
        if (!current()) return;
        setSaving(false);
        if (!data) return setError(error);
        keepRendered(data.render);
      });
    },
    [begin, copy, enqueue, forget, keepPage, keepRendered, record, resumeId, sendPage, settled],
  );

  /** `record: false` for an Undo or Redo sent as an edit (`travel`). `words`
   *  are lines to draw over the page until the PDF that prints them lands. */
  const apply = useCallback(
    async (
      changes: ChoicesUpdate,
      revertedTarget?: RevertTarget,
      recorded = true,
      words: Record<string, string> = {},
    ) => {
      // Its reverse is read before the change shows
      const step = recorded ? record({ changes }) : null;
      if (step)
        step.undo = { changes: reverseChoices(held.current.bank, held.current.choices, changes) };
      // A wording picked from the bar or the assistant replaces what was
      // typed, so the field shows the picked wording, not the old draft
      if (changes.bullets?.some((b) => "variant_id" in b)) {
        pending.current = null;
        const picked = new Set(changes.bullets.map((b) => `${b.bullet_id}.bullet`));
        setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !picked.has(k))));
        for (const b of changes.bullets) wordings.current.delete(b.bullet_id);
      }
      // The change shows at once: its plain fields in the choices, and a
      // move as two neighbours trading places on the page
      const id = `change:${++changeCount.current}`;
      const swap = swapOf(held.current.bank, held.current.choices, changes);
      unanswered.current.set(id, changes);
      keepChoices(confirmed.current);
      sent(id);
      const lines = Object.keys(words);
      lines.forEach(sent);
      setDrafts((d) => ({ ...d, ...words }));
      if (swap) setSwaps((s) => [...s, { ...swap, id }]);
      // A change to an item Tailor changed (a revert included) drops its mark
      // now, not after a compile; a change the render refuses puts it back
      const waiting = latestReview.current;
      const kept =
        waiting &&
        (revertedTarget
          ? reverted(waiting.edits, revertedTarget, held.current.choices)
          : untouched(waiting.edits, changes));
      const unmarked = waiting?.edits.filter((edit) => !kept?.includes(edit)) ?? [];
      if (waiting && kept) {
        latestReview.current = { ...waiting, edits: kept };
        setReview(latestReview.current);
      }
      // The save goes now, beside the render; a refusal is the render's to
      // show, and any other failure puts the saved resume back
      sendChoices(changes);
      return enqueue(async () => {
        const current = begin();
        started.current = performance.now();
        if (step) {
          step.before = settled();
          step.pdfBefore = lastPdf.current;
        }
        const { data, error, status } = await renderEdit(resumeId, { changes }, copy());
        unanswered.current.delete(id);
        answered(id);
        lines.forEach(answered);
        // A render that failed twice for any other reason (a timeout, a
        // compile) says nothing of the save beside it
        if (!data && !refused(status)) reload(lostChange(error, "shown"));
        // Refused: the change and its swap leave the page
        keepChoices(data?.choices ?? confirmed.current);
        if (!data) {
          setSwaps((s) => s.filter((x) => x.id !== id));
          lines.forEach(drop);
          // The record is gone once its last change was: `waiting` still has it
          const now = latestReview.current ?? waiting;
          if (now && unmarked.length) {
            latestReview.current = { ...now, edits: [...now.edits, ...unmarked] };
            setReview(latestReview.current);
          }
        }
        if (data) {
          lastPdf.current = data.render;
          if (step) {
            step.after = settled();
            step.pdfAfter = data.render;
          }
        } else if (step) forget(step);
        if (!current()) return;
        setSaving(false);
        if (!data) return setError(error);
        keepRendered(data.render);
      });
    },
    [
      begin,
      copy,
      drop,
      enqueue,
      forget,
      keepChoices,
      keepRendered,
      record,
      reload,
      resumeId,
      sendChoices,
      setReview,
      settled,
    ],
  );

  /** One typed line (KAN-391): the save and the render go side by side.
   *  The render answers what the line changed in the copy, read by the API
   *  (a GPA's number, a link's https://); the save answers a bullet's
   *  variant id and the profile after a header field. */
  const saveText = useCallback(
    (item_id: string, kind: string, text: string, recorded = true) => {
      const key = `${item_id}.${kind}`;
      sent(key);
      lastSent.current.set(key, text);
      const step = recorded ? record({ line: { item_id, kind, text } }) : null;
      sendLine({ item_id, kind, text }, copy());
      return enqueue(async () => {
        const current = begin();
        started.current = performance.now();
        if (step) {
          // Read once every edit before it has answered: the line's wording,
          // stored link or printed text as it stands now
          const before = settled();
          step.undo = reverseLine(
            before.bank,
            before.choices,
            { item_id, kind },
            lastPdf.current?.boxes.find((b) => boxKey(b) === key)?.text,
            item_id === HEADER && (LINK_FIELDS as readonly string[]).includes(kind)
              ? (headerNow.current[kind as HeaderField] ?? null)
              : undefined,
          );
          step.before = before;
          step.pdfBefore = lastPdf.current;
        }
        const { data, error, status } = await renderEdit(
          resumeId,
          { line: { item_id, kind, text } },
          copy(),
        );
        answered(key);
        if (!data && !refused(status)) reload(lostChange(error, "shown"));
        // Refused: the page shows what is saved, unless the student is
        // still on the line to fix it
        if (!data && key !== selectedNow.current) drop(key);
        // What the line changed is kept even when a newer request owns the
        // page: the next request's copy needs it
        const entry = data?.entry;
        if (entry) {
          held.current.bank = {
            ...held.current.bank,
            entries: held.current.bank.entries.map((e) =>
              e.id === entry.id ? { ...entry, bullets: e.bullets, resume_ids: e.resume_ids } : e,
            ),
          };
          setBank(held.current.bank);
        }
        if (data?.choices) keepChoices(data.choices);
        if (data) {
          lastPdf.current = data.render;
          if (step) {
            step.after = settled();
            step.pdfAfter = data.render;
          }
        } else if (step) forget(step);
        if (!current()) return;
        setSaving(false);
        if (!data) return setError(error);
        if (data.choices) {
          // A typed bullet Tailor changed drops its mark
          const waiting = latestReview.current;
          const changes = { bullets: [{ bullet_id: item_id, text }] };
          if (waiting) setReview({ ...waiting, edits: untouched(waiting.edits, changes) });
        }
        keepRendered(data.render);
      });
    },
    [
      begin,
      copy,
      drop,
      enqueue,
      forget,
      keepChoices,
      keepRendered,
      record,
      reload,
      resumeId,
      sendLine,
      setReview,
      settled,
    ],
  );

  /** Adds a header field the profile lacks, which has no line to click. */
  const addContact = useCallback(
    (field: HeaderField, text: string) => void saveText(HEADER, field, text),
    [saveText],
  );

  /** Saves typed text when it differs from what the line prints, or, while
   *  its PDF is on its way, from what was last sent for it: the page still
   *  prints the text before, so a line reopened and typed back to it sent
   *  nothing and the sent text came back. Left as it was, it sends nothing
   *  again. */
  const save = useCallback(
    async (typed: Draft) => {
      const shown = rendered?.boxes.find((b) => boxKey(b) === typed.key)?.text;
      const text = typed.text.trim();
      const onItsWay = onTheirWay.current.has(typed.key)
        ? lastSent.current.get(typed.key)
        : undefined;
      if (shown === undefined || text === (onItsWay ?? shown)) return;
      const { item_id, kind } = splitKey(typed.key);
      await saveText(item_id, kind, text);
    },
    [rendered, saveText],
  );

  /** Sends the line's typed text, as the student leaves it (a click away,
   *  Enter, Escape, another line). Nothing goes while they type: a pause
   *  saved half a line once, and the line again when it was done (KAN-391). */
  const flush = useCallback(() => {
    const waiting = pending.current;
    pending.current = null;
    if (waiting) void save(waiting);
  }, [save]);

  const select = useCallback(
    (key: string | null) => {
      const left = selectedNow.current;
      flush();
      // A line left unchanged has nothing on its way to wait for
      if (left && left !== key && !onTheirWay.current.has(left)) drop(left);
      placed.current = null;
      selectedNow.current = key;
      setSelected(key);
      if (key === null) refresh();
    },
    [drop, flush, refresh],
  );

  /** The toolbar's switch: the panel, the original, or nothing beside the
   *  page. A hidden panel leaves no line highlighted for a card out of
   *  sight. */
  const showSide = (to: Side) => {
    if (side === "suggestions" && to !== "suggestions") {
      setActive(null);
      setFocused(null);
    }
    // The comparison only reads (`comparing`): an open line saves and closes
    if (to === "original") select(null);
    setSide(to);
  };

  useEffect(() => {
    const clear = (event: KeyboardEvent) => event.key === "Escape" && select(null);
    window.addEventListener("keydown", clear);
    return () => window.removeEventListener("keydown", clear);
  }, [select]);

  /** The page as a step left it: its state and its PDF, at once. */
  const restore = useCallback(
    (state: Held, pdf: RenderedPdf) => {
      begin();
      setSaving(false);
      unanswered.current.clear();
      onTheirWay.current.clear();
      held.current = { ...state };
      setBank(state.bank);
      keepChoices(state.choices);
      setSwaps([]);
      setDrafts({});
      lastPdf.current = pdf;
      keepRendered(pdf);
      keepPage(pdf.page_settings);
    },
    [begin, keepChoices, keepPage, keepRendered],
  );

  /**
   * Undo (`back`) or Redo (./history.ts). It waits for every render before
   * it, so the step's state is whole. When the step kept the state and PDF
   * on its other side, the page goes back to them at once and only the
   * save goes, with a copy of what the database holds, which the save
   * checks a typed entry field against. Otherwise the edit goes as any
   * other, its line drawn over the page until its PDF lands. An open line
   * is saved first, so Undo then takes back what was just typed.
   */
  const travel = useCallback(
    (back: boolean) => {
      select(null);
      void enqueue(async () => {
        const from = back ? undos : redos;
        const step = from.current.pop();
        if (!step) return countSteps();
        (back ? redos : undos).current.push(step);
        countSteps();
        const edit = back ? step.undo : step.redo;
        const state = back ? step.before : step.after;
        const pdf = back ? step.pdfBefore : step.pdfAfter;
        const saved = back ? step.after : step.before;
        if (!edit) return;
        if ("name" in edit) return applyName.current?.(edit.name, () => forget(step));
        // Not past a page's render still queued (a skipped step's Undo sends
        // one): it would land after this and print its settings over them
        if (state && pdf && saved?.printed && pageJobs.current.size === 0) {
          restore(state, pdf);
          const source = {
            entries: saved.bank.entries,
            skills: saved.bank.skills,
            choices: saved.choices,
            ...saved.printed,
            page_settings: pdf.page_settings,
          };
          if ("changes" in edit) sendChoices(edit.changes);
          else if ("page" in edit) sendPage(edit.page);
          else sendLine(edit.line, source);
          return;
        }
        if ("changes" in edit) {
          void apply(edit.changes, undefined, false);
        } else if ("page" in edit) {
          void applyPage(edit.page, false);
        } else {
          const { item_id, kind, text } = edit.line;
          if (!(LINK_FIELDS as readonly string[]).includes(kind))
            setDrafts((d) => ({ ...d, [`${item_id}.${kind}`]: text }));
          void saveText(item_id, kind, text, false);
        }
      });
    },
    [
      apply,
      applyPage,
      countSteps,
      enqueue,
      forget,
      restore,
      saveText,
      select,
      sendChoices,
      sendLine,
      sendPage,
    ],
  );

  // Cmd+Z (Ctrl+Z) undoes, Shift+Cmd+Z or Ctrl+Y redoes; inside a field the
  // field's own text undo runs instead
  useEffect(() => {
    if (phone) return;
    const keys = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if ((event.target as Element).closest?.("input, textarea, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      event.preventDefault();
      travel(key === "z" && !event.shiftKey);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [phone, travel]);

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

  function type(key: string, text: string) {
    setDrafts((d) => ({ ...d, [key]: text }));
    pending.current = { key, text };
  }

  /** Add Bullet: an empty line under the open bullet, or at the foot of the
   *  open entry's, in place at once, with the page under it moved down. Nothing
   *  is written until it has words, so a line left empty leaves no trace in the
   *  bank: a saved placeholder would stay there if the tab closed. */
  function startBullet(open: Line) {
    if (adding || !rendered || (open.kind !== "bullet" && open.kind !== "entry")) return;
    const after =
      open.kind === "bullet" ? open.bullet.id : (shownBullets(open.entry, choices).at(-1) ?? null);
    const anchor = after
      ? `${after}.bullet`
      : `${open.entry.id}.${rendered.boxes.findLast((b) => b.item_id === open.entry.id)?.kind}`;
    const anchorBox = rendered.boxes.find((b) => boxKey(b) === anchor);
    if (!anchorBox) return;
    // An entry with no bullets yet takes the column the page's bullets use
    const column = rendered.boxes.find((b) => b.kind === "bullet")?.x0 ?? anchorBox.x0 + 18;
    select(null);
    finishing.current = false;
    setAdding({
      entry: open.entry.id,
      after,
      anchor,
      x0: after ? anchorBox.x0 : column,
      text: "",
      sent: false,
      id: null,
    });
  }

  /** The new bullet leaves its field. Empty, it was never there. Otherwise the
   *  bank takes its plain words, this resume its place and any bold or italic,
   *  and its text stays drawn until the PDF prints it (`drawn`). */
  async function finishBullet(typed: string) {
    // Once: the field's blur follows Enter as it goes
    if (!adding || finishing.current) return;
    finishing.current = true;
    const text = typed.trim();
    const plain = unmarked(text).trim();
    if (!plain) return setAdding(null);
    setAdding({ ...adding, text, sent: true });
    const { data, error } = await addBullet(adding.entry, plain);
    if (!data) {
      setAdding(null);
      return setError(error);
    }
    setAdding((now) => now && { ...now, id: data.id });
    const entries = held.current.bank.entries.map((e) =>
      e.id === adding.entry ? { ...e, bullets: [...e.bullets, data] } : e,
    );
    held.current.bank = { ...held.current.bank, entries };
    setBank(held.current.bank);
    const entry = entries.find((e) => e.id === adding.entry);
    await apply(
      bulletPlaced(
        // Without the new bullet, which has no row yet
        entry ? shownBullets(entry, held.current.choices) : [],
        data.id,
        adding.after,
        text === plain ? undefined : text,
      ),
    );
    if (!lastPdf.current?.boxes.some((b) => b.item_id === data.id)) setAdding(null);
  }

  function fit() {
    select(null);
    return enqueue(async () => {
      // Fit reads the saved resume, so every save sent before goes first
      await saves.current;
      const current = begin();
      started.current = performance.now();
      const before = settled();
      const pdfBefore = lastPdf.current;
      markResumesStale();
      const { data, error } = await fitToOnePage(resumeId);
      if (!current()) return;
      if (!data) {
        setSaving(false);
        return setError(error);
      }
      announce(false);
      lastPdf.current = data.render;
      keepRendered(data.render);
      const hid =
        data.undo.bullets?.length || data.undo.entries?.length || data.undo.skills?.length;
      if (hid) {
        cutsNow.current = addCuts(cutsNow.current, data.undo);
        setCuts(cutsNow.current);
        keepFitCuts(resumeId, cutsNow.current);
      }
      const fresh = await getChoices(resumeId);
      if (fresh.data) keepChoices(fresh.data);
      // Fit is one step like any edit: Undo (the button or Cmd+Z) shows what
      // it hid, Redo hides it again. It had an Undo Fit button of its own
      // until 2026-11-01, a second way to do what Undo does.
      if (hid && fresh.data) {
        push(undos.current, {
          undo: { changes: data.undo },
          redo: { changes: hideAgain(data.undo) },
          before,
          after: settled(),
          pdfBefore,
          pdfAfter: data.render,
        });
        redos.current = [];
        countSteps();
      }
      if (current()) setSaving(false);
    });
  }

  const box = rendered?.boxes.find((b) => boxKey(b) === selected);
  const line = box ? lineOf(bank, box) : null;
  // A bullet being added has no box yet: it is drawn under its anchor, with no
  // height of its own, so everything below the anchor moves
  const anchorBox = adding && rendered?.boxes.findLast((b) => boxKey(b) === adding.anchor);
  const newBox: RenderBox | undefined =
    adding && anchorBox
      ? {
          ...anchorBox,
          item_id: NEW_BULLET.item_id,
          kind: NEW_BULLET.kind,
          x0: adding.x0,
          y0: anchorBox.y1,
          text: "",
        }
      : undefined;
  // The live page (KAN-391): while a wrapping line's typed text differs from
  // what the PDF prints, the page under it moves by the lines it gained or
  // lost. When the next PDF lands with that text, the shift is 0 again;
  // where TeX wraps the same text otherwise, the page jumps then.
  const overlaid = [
    ...(line && typed(line) && selected ? [selected] : []),
    ...Object.keys(drafts).filter((k) => k !== selected),
    ...(newBox ? [NEW_BULLET.key] : []),
  ];
  // What the page under an overlaid line moves by, against the box of the
  // PDF on screen: the lines its typed text gained or lost, 0 once that PDF
  // prints the text
  const shiftOf = (target: RenderBox) => {
    if (boxKey(target) === NEW_BULLET.key) {
      return (draftLines[NEW_BULLET.key] ?? 1) * (rendered?.wrapped_line ?? DEFAULT_WRAPPED_LINE);
    }
    const text = drafts[boxKey(target)];
    const lines = draftLines[boxKey(target)];
    if (text === undefined || !lines || !WRAPS.has(target.kind) || text.trim() === target.text) {
      return 0;
    }
    const step = rendered?.wrapped_line ?? DEFAULT_WRAPPED_LINE;
    return (lines - boxLines(target, step)) * step;
  };

  // The moves on their way as strips of the page on screen, each against
  // the page after the ones before: a bullet is its box, an entry its
  // fields' and bullets' boxes. A swap the page already shows (`a` no
  // longer above `b`), or one across a page break, is left out.
  const swapsOn = (boxes: RenderBox[]) => {
    const strips: Strip[] = [];
    let placed = boxes;
    const regionOf = (kind: Swap["kind"], id: string) => {
      const bullets = new Set(
        kind === "entry" ? bank.entries.find((e) => e.id === id)?.bullets.map((b) => b.id) : [],
      );
      const own = placed.filter((b) =>
        kind === "bullet"
          ? b.kind === "bullet" && b.item_id === id
          : (b.item_id === id && b.kind !== "bullet") ||
            (b.kind === "bullet" && bullets.has(b.item_id)),
      );
      if (!own.length || own.some((b) => b.page !== own[0].page)) return null;
      if (kind === "bullet" && own.length !== 1) return null;
      return {
        page: own[0].page,
        top: Math.min(...own.map((b) => b.y0)),
        bottom: Math.max(...own.map((b) => b.y1)),
      };
    };
    for (const swap of swaps) {
      const a = regionOf(swap.kind, swap.a);
      const b = regionOf(swap.kind, swap.b);
      if (!a || !b || a.page !== b.page || a.bottom > b.top) continue;
      const strip: Strip = { page: a.page, a: [a.top, a.bottom], b: [b.top, b.bottom] };
      strips.push(strip);
      placed = placed.map((x) => afterStrips(x, [strip]));
    }
    return strips;
  };

  /** The text a typed line's field opens on: what the line prints. */
  function startText(line: Line, target: RenderBox) {
    return typed(line) ? target.text : null;
  }

  /** Keeps `draftLines` current for a wrapping line's field or text: it
   *  grows with its text, so its height says how many lines it wraps to. */
  function measure(key: string, kind: string, element: HTMLElement | null) {
    if (!element || !WRAPS.has(kind)) return;
    const observer = new ResizeObserver(() => {
      const height = parseFloat(getComputedStyle(element).lineHeight);
      const lines = Math.round(element.offsetHeight / height);
      if (height > 0) setDraftLines((d) => (d[key] === lines ? d : { ...d, [key]: lines }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }

  /** Jake's type for a box's line, as the field and the read-only text set it. */
  function lineLook(target: RenderBox) {
    const of = lineOf(bank, target);
    const settings = rendered?.page_settings ?? DEFAULT_PAGE;
    const look = typeOf(
      target.kind,
      of?.kind === "entry" || of?.kind === "bullet" ? of.entry.section : null,
      settings,
    );
    const wraps = WRAPS.has(target.kind);
    // A wrapping line's field steps as the page's lines do
    const lineHeight = wraps
      ? (rendered?.wrapped_line ?? DEFAULT_WRAPPED_LINE) / look.size
      : LINE_HEIGHT;
    return {
      className: cn(
        latinModern.className,
        // A negative margin puts the side padding outside the text, so the
        // text lands on the PDF's own glyphs
        "bg-panel text-ink -mx-[0.4cqw] block px-[0.4cqw]",
        look.bold && "font-bold",
        look.italic && "italic",
      ),
      style: {
        fontFamily: FONTS.find((font) => font.value === settings.font_family)?.css,
        fontSize: pt(look.size),
        lineHeight: pt(look.size * lineHeight),
        // Puts the text's baseline on the PDF's
        marginTop: pt(boxAscent(target.kind) - fieldBaseline(lineHeight) * look.size),
        ...(wraps
          ? {
              width: `calc(${pt(PAGE_WIDTH - settings.side_margin * 72 - target.x0)} + 0.8cqw)`,
              textAlign: settings.alignment === "justified" ? ("justify" as const) : undefined,
            }
          : { minWidth: pt(40) }),
      },
    };
  }

  /** What the page draws over an overlaid line: the selected line's field,
   *  or a line's typed text while the PDF that prints it is on its way. */
  function overlay(target: RenderBox) {
    const key = boxKey(target);
    if (key === NEW_BULLET.key) return newLine(target);
    if (key === selected) return field(target);
    const text = drafts[key];
    if (text === undefined) return null;
    const look = lineLook(target);
    // A click on the text reopens the line with what was typed, while its
    // PDF is still on its way: the text sits over the line's own target,
    // and the press closed the line instead (`data-box` keeps it a line's)
    return (
      <div
        ref={(element) => measure(key, target.kind, element)}
        aria-hidden
        data-box={key}
        onClick={() => onLine(key)}
        className={cn(look.className, "cursor-text break-words whitespace-pre-wrap")}
        style={look.style}
      >
        {target.kind === "bullet" ? wordsOf(text) : text}
      </div>
    );
  }

  function wordsOf(text: string) {
    return runs(text).map((run, i) => (
      <span key={i} className={cn(run.bold && "font-bold", run.italic && "italic")}>
        {run.text}
      </span>
    ));
  }

  /** The bullet being added: its field, then its words until the PDF prints
   *  them, one line under its anchor, with the dot the page gives a bullet. */
  function newLine(target: RenderBox) {
    if (!adding) return null;
    const look = lineLook(target);
    const step = rendered?.wrapped_line ?? DEFAULT_WRAPPED_LINE;
    const settings = rendered?.page_settings ?? DEFAULT_PAGE;
    return (
      <div className="relative" style={{ paddingTop: pt(step - BOX_HEIGHT) }}>
        <span
          aria-hidden
          className={cn(latinModern.className, "text-ink absolute")}
          style={{ ...look.style, left: pt(-DOT_GAP), width: undefined, textAlign: undefined }}
        >
          {settings.bullet === "dash" ? "–" : "•"}
        </span>
        {adding.sent ? (
          <div
            aria-hidden
            className={cn(look.className, "break-words whitespace-pre-wrap")}
            style={look.style}
          >
            {wordsOf(adding.text)}
          </div>
        ) : (
          richLine(adding.text, (text) => setAdding((now) => now && { ...now, text }), {
            "aria-label": "New Bullet",
            attach: (element) => {
              focusAt(NEW_BULLET.key, element);
              return measure(NEW_BULLET.key, NEW_BULLET.kind, element);
            },
            onBlur: (e) => void finishBullet(readMarked(e.currentTarget)),
            // Either key saves it, or drops it while empty
            onKeyDown: (e) => {
              if (e.key !== "Enter" && e.key !== "Escape") return;
              e.preventDefault();
              void finishBullet(readMarked(e.currentTarget));
            },
            className: cn(
              look.className,
              FIELD_RING,
              "before:text-ink-meta empty:before:content-['New_Bullet']",
            ),
            style: look.style,
          })
        )}
      </div>
    );
  }

  /** A rich field, so bold and italic show in the words as they are set
   *  (KAN-435): a textarea showed their markers until the line was left. React
   *  holds no children here; `showMarked` keeps it to `value`, so a change from
   *  elsewhere (Undo on its suggestion) still reaches it. The browser gives it
   *  Ctrl or Cmd+B and I, and text undo. */
  function richLine(
    value: string,
    onText: (text: string) => void,
    {
      attach,
      className,
      ...rest
    }: Omit<ComponentProps<"div">, "ref" | "onInput" | "onPaste" | "onDrop"> & {
      attach: (element: LineField | null) => (() => void) | undefined;
    },
  ) {
    return (
      <div
        {...rest}
        // Its own element: its words are the browser's, so a plain div drawn in
        // its place by React (the line's words on their way) would keep them
        // and add its own beside them
        key="rich-line"
        ref={(element) => {
          if (element) showMarked(element, value);
          return attach(element);
        }}
        role="textbox"
        aria-multiline
        contentEditable
        suppressContentEditableWarning
        className={cn(className, "min-h-lh break-words whitespace-pre-wrap")}
        onInput={(e) => onText(readMarked(e.currentTarget))}
        // Plain words on one line only: a paste would bring its own fonts
        onPaste={(e) => {
          e.preventDefault();
          const words = e.clipboardData.getData("text/plain").replace(/\s+/g, " ");
          document.execCommand("insertText", false, words);
        }}
        onDrop={(e) => e.preventDefault()}
      />
    );
  }

  /** Focuses a field once per selection, with the caret where the press
   *  landed on the PDF (the field's text sits over the same glyphs), or at
   *  the end. */
  function focusAt(key: string, element: LineField | null) {
    if (!element || placed.current === key) return;
    placed.current = key;
    element.focus({ preventScroll: true });
    const at = pressed.current;
    const origin = pages.current?.getBoundingClientRect();
    const caret =
      at && origin && document.caretPositionFromPoint?.(origin.left + at.x, origin.top + at.y);
    if (element instanceof HTMLDivElement) {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      if (caret && element.contains(caret.offsetNode)) {
        range.setStart(caret.offsetNode, caret.offset);
        range.collapse(true);
      }
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      return;
    }
    const offset = caret && caret.offsetNode === element ? caret.offset : element.value.length;
    element.setSelectionRange(offset, offset);
  }

  function field(target: RenderBox) {
    const start = line && startText(line, target);
    if (start == null || !line) return null;
    const key = boxKey(target);
    const look = lineLook(target);
    const value = drafts[key] ?? start;
    const attach = (element: LineField | null) => {
      focusAt(key, element);
      return measure(key, target.kind, element);
    };
    const common = {
      "aria-label": kindLabel(target.kind),
      onBlur: () => flush(),
      // Enter saves the line and clears the selection, back to the page
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        select(null);
      },
      className: cn(look.className, FIELD_RING),
      style: look.style,
    };
    if (target.kind === "bullet") {
      return richLine(value, (text) => type(key, text), { ...common, attach });
    }
    const text = {
      ...common,
      ref: attach,
      value,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        type(key, e.target.value),
    };
    return WRAPS.has(target.kind) ? <textarea {...text} rows={1} /> : <input {...text} />;
  }

  /** Called when every page of a new PDF has painted: a line whose save
   *  has landed is now printed by the page itself, so its typed text goes. */
  const drawn = () => {
    setDrafts((d) => {
      const kept = Object.entries(d).filter(
        ([k]) => k === selectedNow.current || onTheirWay.current.has(k),
      );
      return kept.length === Object.keys(d).length ? d : Object.fromEntries(kept);
    });
    setSwaps((s) => {
      const kept = s.filter((x) => onTheirWay.current.has(x.id));
      return kept.length === s.length ? s : kept;
    });
    // The page prints the new bullet now, so its drawn text goes
    setAdding((now) => (now?.id && rendered?.boxes.some((b) => b.item_id === now.id) ? null : now));
    refresh();
    if (started.current == null) return;
    setElapsed(Math.round(performance.now() - started.current));
    started.current = null;
  };

  const hide = (changes: ChoicesUpdate) => {
    apply(changes);
    select(null);
  };
  const assistant = (className: string) => (
    <Assistant
      resumeId={resumeId}
      bank={bank}
      choices={choices}
      line={line?.kind === "header" ? null : line}
      pageCount={rendered?.page_count ?? 1}
      onApply={apply}
      onHide={hide}
      onFit={fit}
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
  // Each line's place on the page, so the panel lists entries as the page does
  const boxOrder = new Map<string, number>();
  rendered?.boxes.forEach((b, i) => {
    if (!boxOrder.has(boxKey(b))) boxOrder.set(boxKey(b), i);
  });
  const pageOrder = (key: string) => boxOrder.get(key) ?? Number.POSITIVE_INFINITY;
  const suggestionCount = reviewing ? reviewing.edits.length : 0;
  // Every changed line is tinted by its change's type; the lines of the card
  // in focus or open also take an outline. A phone tints only those and keeps
  // a dot per line, since a tap there opens a sheet, not a popup
  const allMarks = reviewing ? marksOf(reviewing.edits, choices) : undefined;
  const litEdits = reviewing?.edits.filter((edit) => [focused, active].includes(editKey(edit)));
  const lit = new Set(litEdits?.flatMap((edit) => linesOf(edit, choices)));
  const marks = allMarks && new Map([...allMarks].filter(([line]) => lit.has(line)));
  const dots =
    allMarks &&
    new Map([...allMarks].map(([line, mark]) => [line, { mark, lit: lit.has(line) }] as const));
  // The page scrolls to a suggestion's lines only once it is opened: on
  // hover it scrolled under the pointer as it crossed the panel, which made
  // the page swim. Hover still highlights the lines (`lit`, above)
  const openEdit = reviewing?.edits.find((edit) => editKey(edit) === active);
  const focus = openEdit ? linesOf(openEdit, choices) : undefined;
  // The change on the open line, in a small card beside it, until the
  // student types, closes it or leaves the line. Archived: Tailor's review
  // passes no `suggestionPopup` (POPUP_LIVE in tailor-suggestions.tsx)
  const popupCard =
    showMarks && selected && selected !== closedPopup && drafts[selected] === undefined
      ? cards?.get(selected)
      : undefined;
  const popupEdit = reviewing?.edits.find((edit) => editKey(edit) === popupCard);
  /** A click on a line selects it, and a changed one also opens Suggestions
   *  beside the page, on that line's card (`SuggestionsPanel` scrolls to
   *  it), unless Hide Suggestions has taken the marks off the page. While
   *  the popup was live the panel stayed as it was: the popup said the same
   *  thing, and the panel took the column from a student who had closed it. */
  const onLine = (key: string) => {
    select(selected === key ? null : key);
    const card = cards?.get(key);
    if (!card) return;
    setActive(card);
    setClosedPopup(null);
    if (showMarks) setSide("suggestions");
  };
  /** A click on a margin dot opens its card (on a phone, in the sheet). */
  const onDot = (key: string) => {
    const card = cards?.get(key);
    if (!card) return;
    setActive(card);
    setSuggestionsOpen(true);
  };
  const SuggestionPopup = suggestionPopup;
  const popupNode =
    popupEdit && SuggestionPopup ? (
      <SuggestionPopup
        edit={popupEdit}
        bank={bank}
        choices={choices}
        undo={() => {
          select(null);
          void apply(
            revertOf({ edit: popupEdit }, choices),
            { edit: popupEdit },
            true,
            wordsBack([popupEdit]),
          );
        }}
        close={() => setClosedPopup(selected)}
      />
    ) : undefined;
  const Suggestions = suggestions;
  const panel =
    reviewing && Suggestions ? (
      <Suggestions
        record={reviewing}
        pageOrder={pageOrder}
        bank={bank}
        choices={choices}
        undo={(edit) => void apply(revertOf({ edit }, choices), { edit }, true, wordsBack([edit]))}
        undoAll={() =>
          void apply(
            revertAll(reviewing.edits, choices),
            undefined,
            true,
            wordsBack(reviewing.edits),
          )
        }
        close={() => showSide(null)}
        focused={focused}
        focus={setFocused}
        show={(key) => {
          setActive(key);
          setSuggestionsOpen(false);
        }}
        active={active}
        open={setActive}
      />
    ) : null;
  // Beside the page, the toolbar's Suggestions shows and hides the panel;
  // the phone opens it as a sheet from its own button
  const shownPanel = side === "suggestions" && panel;
  const shownOriginal = side === "original" && original;
  const shownFormat = side === "format";
  const shownSections = side === "sections";
  const shownCut = side === "cut";
  const cutOpen = suggestions ? shownCut : scoutOpen && panelView === "cut";
  const sectionsOutline = (
    <SectionsOutline
      bank={bank}
      choices={choices}
      order={page.section_order}
      onOrder={(section_order) => void applyPage({ ...page, section_order })}
      onApply={apply}
    />
  );
  const history: HistoryTools = {
    canUndo: steps.undo > 0,
    canRedo: steps.redo > 0,
    onUndo: () => travel(true),
    onRedo: () => travel(false),
  };
  if (phone) {
    const start = line && box && startText(line, box);
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
              swaps={swapsOn}
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
          text={start == null ? null : (drafts[selected!] ?? start)}
          saving={saving}
          elapsed={elapsed}
          error={error}
          download={download}
          bar={phoneBar}
          page={page}
          onPage={applyPage}
          suggestions={
            reviewing && {
              count: suggestionCount,
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
                onSaveHeader={addContact}
                onHide={hide}
                up={move(bank, choices, line, -1)}
                down={move(bank, choices, line, 1)}
              />
            )
          }
          assistant={assistant("h-full")}
          onSelect={select}
          onType={(text) => selected && type(selected, text)}
          onFlush={() => flush()}
          onApply={apply}
          onFit={fit}
          history={history}
          cuts={cuts}
        />
        {fitToast}
      </>
    );
  }

  const bar = (
    <Bar
      line={line}
      box={box}
      choices={choices}
      header={header}
      rendered={rendered}
      saving={saving}
      elapsed={elapsed}
      download={download}
      onApply={apply}
      onSaveHeader={addContact}
      composing={Boolean(adding && !adding.sent)}
      onAddBullet={() => line && startBullet(line)}
      onClose={() => select(null)}
      onFit={fit}
      experiences={
        // They wait for the first render, since a pick renders again
        rendered
          ? {
              // Not on Tailor's review: choosing what a resume shows is the
              // editor's own page's work, a run's own removals have Undo, and
              // a toolbar button and modal for it there cluttered the review
              picker: suggestions
                ? null
                : { open: scoutOpen && panelView === "experiences", onToggle: showExperiences },
              // On both pages, since both have Fit: only while something it
              // cut is still off the page, or its panel is open
              cut:
                cutOpen || cutLeft(bank, choices, cuts)
                  ? {
                      open: cutOpen,
                      onToggle: () =>
                        suggestions ? showSide(cutOpen ? null : "cut") : showPanel("cut"),
                    }
                  : null,
            }
          : null
      }
      zoom={<Zoom zoom={zoom} onZoom={setZoom} />}
      history={history}
      docs={Boolean(suggestions)}
      format={{
        page,
        disabled: !rendered,
        onChange: applyPage,
        formatOpen: suggestions ? shownFormat : scoutOpen && panelView === "format",
        sectionsOpen: suggestions ? shownSections : scoutOpen && panelView === "sections",
        onToggle: togglePanel,
        marks: reviewing ? { shown: showMarks, onToggle: () => setShowMarks(!showMarks) } : null,
      }}
    />
  );
  // The two resumes side by side only read: a plain heading over each in
  // place of the toolbar, no click targets and no marks. They scroll with
  // the page, together, so a line stays level with its twin. The tailored
  // one kept its toolbar, and the original a card with a Read Only tag and a
  // scroll of its own, until the user found that heavy for a comparison
  const comparing = Boolean(shownOriginal);
  const compareHeading = "text-label text-ink font-semibold";

  const grid = (
    <div
      className={cn(
        "grid items-start gap-5",
        // The column docks beside the page from @6xl only; below it floats
        // over the page (`floating`)
        (shownPanel || shownFormat || shownSections || shownCut) &&
          "@6xl/main:grid-cols-[minmax(0,1fr)_24rem]",
        // The two resumes at one width, so a line reads against its twin
        shownOriginal && "@4xl/main:grid-cols-2",
      )}
    >
      {/* Placed, so a column floating in the same cell never pushes it down */}
      <div className="flex min-w-0 flex-col gap-2 @4xl/main:col-start-1 @4xl/main:row-start-1">
        {comparing ? (
          <div className="flex min-h-9 items-center">
            <h2 className={compareHeading}>Tailored Resume</h2>
          </div>
        ) : (
          bar
        )}
        {error && (
          <p role="alert" className="text-note text-danger">
            {error}
          </p>
        )}
        <DownloadNotes download={download} />
        <div
          ref={pages}
          data-keeps-selection
          className="mx-auto w-full"
          style={{ maxWidth: zoomWidth(zoom) }}
          onPointerDownCapture={(e) => {
            const origin = e.currentTarget.getBoundingClientRect();
            pressed.current = { x: e.clientX - origin.left, y: e.clientY - origin.top };
          }}
          // A press on the paper off every line saves the open line and
          // closes it, as a press off the page does: the page keeps the
          // selection for its lines, so until then only Enter or Escape
          // left a line once it was open. A line's own target opens that
          // line, and the field and the margin dots keep it
          onPointerDown={(e) => {
            if (
              !(e.target as Element).closest(
                "[data-box], [data-popup], input, textarea, button, [contenteditable]",
              )
            )
              select(null);
          }}
        >
          {pdfPane((pdf) => (
            <PdfPages
              pdf={pdf.pdf}
              boxes={pdf.boxes}
              readOnly={comparing}
              popup={selected && popupNode ? { line: selected, node: popupNode } : undefined}
              selected={selected}
              onSelect={onLine}
              overlay={overlay}
              overlaid={overlaid}
              extra={newBox}
              shiftOf={shiftOf}
              swaps={swapsOn}
              onDrawn={drawn}
              placeholder={<PageSkeleton />}
              marks={showMarks ? allMarks : undefined}
              lit={lit}
              focus={showMarks ? focus : undefined}
            />
          ))}
        </div>
      </div>
      {/* The assistant lives in Scout's panel, opened from the top bar's
          Scout (`ScoutTakeover`), so the page has one way to it. Not on
          Tailor's review, whose Scout stays the job search chat. Kept
          mounted while the panel is closed, so the chat survives closing
          it; marked KEEPS_SELECTION, since the panel sits outside the
          editor and the assistant acts on the selected line. It docked
          beside the page from a toolbar Ask Scout until KAN-411; the user
          found two Scout buttons on one page one too many. It waits for the
          first render, as that button did: the assistant reads its page
          count and acts through renders, so until then the panel is
          Scout's job chat. The Experiences picker shares the panel (KAN-440):
          the toolbar's Experiences opens it, and the top bar's Scout goes
          back to the assistant, which stays mounted under it, for its chat.
          It floats over the page below xl (`float`, KAN-576): docked at
          1024, it left the resume a 416px column with about 4px text */}
      {rendered && !suggestions && (
        <ScoutTakeover
          float
          mark={
            panelView === "experiences"
              ? EXPERIENCES_MARK
              : panelView === "cut"
                ? CUT_MARK
                : undefined
          }
          away={panelView !== "scout" ? showScout : undefined}
          title={
            panelView === "experiences"
              ? "Experiences"
              : panelView === "cut"
                ? "Cut From Resume"
                : panelView === "format"
                  ? "Format Options"
                  : panelView === "sections"
                    ? "Sections"
                    : "Scout"
          }
          subtitle={
            panelView === "experiences"
              ? "Pick what this resume shows"
              : panelView === "cut"
                ? "Put back what Fit to One Page hid"
                : panelView === "format"
                  ? "Set how this page prints"
                  : panelView === "sections"
                    ? "Drag to change the order"
                    : "Edits this resume as you talk"
          }
        >
          <div data-keeps-selection className="flex min-h-0 flex-1 flex-col">
            <div className={cn("flex min-h-0 flex-1 flex-col", panelView !== "scout" && "hidden")}>
              {assistant("flex-1")}
            </div>
            {panelView === "experiences" && (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-none px-4 pt-2 pb-4">
                <ExperiencesPicker bank={bank} choices={choices} onApply={apply} />
              </div>
            )}
            {panelView === "cut" && (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-none px-4 pt-2 pb-4">
                <CutPicker bank={bank} choices={choices} cuts={cuts} onApply={apply} />
              </div>
            )}
            {panelView === "sections" && (
              <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-none px-4 pt-2 pb-4">
                {sectionsOutline}
              </div>
            )}
            {panelView === "format" && (
              <div className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-none px-4 pt-2 pb-4">
                <FormatOptions page={page} onChange={applyPage} />
              </div>
            )}
          </div>
        </ScoutTakeover>
      )}
      {/* Tailor's suggestions, above the page on a narrow screen. */}
      {/* The panel scrolls its own list under its header, so the column
          only caps its height: scrolled here, the header and the panel's
          rounded corners went up with the list. The cap is measured
          (`useFitToWindow`): a fixed one, the window less 15rem, ran the
          panel's foot below the window before the page scrolled and left a
          gap under it after, once the title row grew.
          Below @6xl it floats over the page's right side in the page's own
          cell (KAN-576), under the 44px bar, with `shadow-lift`: docked at
          1024, the 384px column left the resume about 480px wide */}
      {(shownPanel || shownFormat || shownSections || shownCut) && (
        <div
          data-keeps-selection
          ref={fitPanel}
          className={cn(
            "max-h-scroll-box -order-1 flex flex-col @4xl/main:sticky @4xl/main:order-none @4xl/main:max-h-(--fit-height)",
            FLOATING,
          )}
        >
          {shownFormat ? (
            <SidePanel title="Format Options" onClose={() => showSide(null)}>
              <FormatOptions page={page} onChange={applyPage} />
            </SidePanel>
          ) : shownSections ? (
            <SidePanel title="Sections" onClose={() => showSide(null)}>
              {sectionsOutline}
            </SidePanel>
          ) : shownCut ? (
            <SidePanel title="Cut From Resume" onClose={() => showSide(null)}>
              <CutPicker bank={bank} choices={choices} cuts={cuts} onApply={apply} />
            </SidePanel>
          ) : (
            shownPanel
          )}
        </div>
      )}
      {/* The original beside the page; under it on a narrow screen */}
      {shownOriginal && (
        <section className="flex min-w-0 flex-col gap-2">
          {/* Its X closes the column, as the Suggestions panel's does: the
              toolbar is gone here, so this is the way out */}
          <div className="flex min-h-9 items-center justify-between">
            <h2 className={compareHeading}>Original Resume</h2>
            <IconButton
              label="Close Comparison"
              tooltip="Close"
              className="size-9"
              onClick={() => showSide(null)}
            >
              <CloseIcon className="size-4.5" />
            </IconButton>
          </div>
          {shownOriginal}
        </section>
      )}
      {fitToast}
    </div>
  );
  // The title spans the page and the column beside it, so the column starts
  // level with the toolbar, as Docs' comments start level with its bar, and
  // on Tailor's review the document's actions sit at its right, as Docs' do. The
  // toolbar spanned both too for a day, which put the panel under it, apart
  // from the page it reviews
  return (
    <div className={cn("flex flex-col", suggestions ? "mt-2 gap-2" : "mt-4 gap-3")}>
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <TitleHistoryContext value={titleHistory}>{heading}</TitleHistoryContext>
        </div>
        {suggestions && (
          <div className="flex shrink-0 items-center gap-1.5">
            {reviewing && (
              <ReviewButtons
                review={{
                  count: suggestionCount,
                  side,
                  onSide: showSide,
                  hasOriginal: Boolean(original),
                }}
              />
            )}
            <DownloadMenu download={download} />
          </div>
        )}
      </div>
      {grid}
    </div>
  );
}

/**
 * A sticky column's height cap, as `--fit-height` on it: the window below
 * its top, less a 24px foot. Read again on any scroll (the page scrolls in
 * `main`, not the window, so the listener captures) and on resize, once a
 * frame. Before the page scrolls the column's top sits under the title
 * row; stuck, at its `top`; a fixed cap fitted one and not the other.
 * Its top is read no higher than where it sticks: at the page's end the
 * grid pushes a sticky column up past that, and reading that top grew the
 * cap, so the panel kept growing as the page scrolled. Never under 240px,
 * so a short window still shows the panel's top.
 */
function useFitToWindow(foot = 24) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!el) return;
    let frame = 0;
    const fit = () => {
      frame = 0;
      const stuck =
        (el.closest("main")?.getBoundingClientRect().top ?? 0) +
        (parseFloat(getComputedStyle(el).top) || 0);
      const room = window.innerHeight - Math.max(el.getBoundingClientRect().top, stuck) - foot;
      el.style.setProperty("--fit-height", `${Math.max(240, Math.round(room))}px`);
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(fit);
    };
    fit();
    document.addEventListener("scroll", queue, { capture: true, passive: true });
    window.addEventListener("resize", queue);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", queue, { capture: true });
      window.removeEventListener("resize", queue);
    };
  }, [el, foot]);
  return setEl;
}

/** The review's column from @4xl to @6xl: in the page's cell, at its right,
 *  over the page, below the 44px bar (`DOCS_BAR`) at rest and when stuck.
 *  From @6xl it docks in the grid's second column, level with the bar. */
const FLOATING = cn(
  "@4xl/main:col-start-1 @4xl/main:row-start-1 @4xl/main:z-30 @4xl/main:mt-13 @4xl/main:top-15 @4xl/main:w-96 @4xl/main:justify-self-end @4xl/main:rounded-2xl @4xl/main:shadow-lift",
  "@6xl/main:col-start-2 @6xl/main:z-auto @6xl/main:mt-0 @6xl/main:top-2 @6xl/main:w-auto @6xl/main:justify-self-stretch @6xl/main:shadow-none",
);

/** The sticky bar above the page (`SlimBar`), on the editor's own page
 *  and on Tailor's review: the selected line's kind and actions, or the
 *  page-count chip and Fit to One Page. Sticky, so a line's actions never
 *  cover the lines around it (user story 63), and Download stays in reach
 *  down a two-page resume. */
function Bar({
  line,
  box,
  choices,
  header,
  rendered,
  saving,
  elapsed,
  download,
  onApply,
  onSaveHeader,
  composing,
  onAddBullet,
  onClose,
  onFit,
  experiences,
  docs,
  format,
  zoom,
  history,
}: {
  line: Line | null;
  box: RenderBox | undefined;
  choices: Choices;
  header: Header;
  /** Null until the first render lands. */
  rendered: RenderedPdf | null;
  saving: boolean;
  elapsed: number | null;
  download: ResumeDownload;
  onApply: (changes: ChoicesUpdate) => void;
  onSaveHeader: (field: HeaderField, text: string) => void;
  /** A bullet is being added: its field is the open line. */
  composing: boolean;
  onAddBullet: () => void;
  onClose: () => void;
  onFit: () => void;
  experiences: ExperiencesTools | null;
  docs: boolean;
  format: FormatTools;
  zoom: ReactNode;
  history: HistoryTools;
}) {
  return (
    <SlimBar
      rendered={rendered}
      saving={saving}
      elapsed={elapsed}
      download={download}
      onFit={onFit}
      experiences={experiences}
      docs={docs}
      format={format}
      zoom={zoom}
      history={history}
      lineOpen={composing || Boolean(line && box)}
      composing={composing}
      editing={
        // What acts on the line clicked: its kind of text's size, named, then a
        // bullet's bold, italic and Add Bullet. A kind's label, Hide and
        // Original crowded the bar for what the page and the Sections and
        // Experiences panels already say. An entry keeps its GPA and
        // coursework choices, and the header its missing contacts
        composing ? (
          <>
            <RoleTools role={TEXT_ROLES.body} format={format} />
            <MarkTools />
          </>
        ) : (
          line &&
          box && (
            <>
              <RoleTools
                role={textRoleOf(box.kind, "entry" in line ? line.entry.section : null)}
                format={format}
              />
              {line.kind === "bullet" && <MarkTools />}
              {(line.kind === "bullet" || line.kind === "entry") && (
                <Button size="sm" data-bar-action className="shrink-0" onClick={onAddBullet}>
                  <PlusIcon aria-hidden /> Add Bullet
                </Button>
              )}
              {(line.kind === "entry" || line.kind === "header") && (
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
                />
              )}
            </>
          )
        )
      }
    />
  );
}

/** The size of the kind of text clicked, under its name: it changes every line
 *  of that kind, and an unnamed size looked as if it changed the selection. */
function RoleTools({ role, format }: { role: TextRole; format: FormatTools }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <span className="text-note text-ink-muted pl-1 font-medium">{role.label}</span>
      <SizeStepper
        role={role}
        page={format.page}
        disabled={format.disabled}
        onChange={format.onChange}
      />
      <span aria-hidden className="bg-border-subtle mx-1 h-5 w-px" />
    </div>
  );
}

/** Bold and italic for the open bullet, lit while the selection has them,
 *  as Docs does. The bar keeps the focus in the field, so the browser acts on
 *  the selection and the field reports the change as typing. */
function MarkTools() {
  const [on, setOn] = useState({ bold: false, italic: false });
  useEffect(() => {
    const read = () =>
      setOn({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
      });
    read();
    document.addEventListener("selectionchange", read);
    return () => document.removeEventListener("selectionchange", read);
  }, []);
  const press = (mark: "bold" | "italic") => {
    document.execCommand(mark);
    setOn((was) => ({ ...was, [mark]: document.queryCommandState(mark) }));
  };
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Bold"
        title="Bold"
        aria-pressed={on.bold}
        className={cn(on.bold && ON)}
        onClick={() => press("bold")}
      >
        <TextBIcon aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Italic"
        title="Italic"
        aria-pressed={on.italic}
        className={cn(on.italic && ON)}
        onClick={() => press("italic")}
      >
        <TextItalicIcon aria-hidden />
      </Button>
    </div>
  );
}

/** The toolbar's Experiences (KAN-440): whether Scout's panel shows the
 *  picker now. */
type ExperiencesTools = {
  /** Add Experiences, on the editor's own page only. */
  picker: { open: boolean; onToggle: () => void } | null;
  /** Cut From Resume, only after a fit cut something still off the page. */
  cut: { open: boolean; onToggle: () => void } | null;
};

/** The bar's page settings (./page-format.tsx). */
type FormatTools = {
  page: PageSettings;
  disabled: boolean;
  onChange: (next: PageSettings) => void;
  formatOpen: boolean;
  sectionsOpen: boolean;
  onToggle: (panel: "format" | "sections") => void;
  /** Tailor's marks on the page, on Tailor's review only. */
  marks: { shown: boolean; onToggle: () => void } | null;
};

/** What sits beside the page on Tailor's review. */
type Side = "suggestions" | "original" | "format" | "sections" | "cut" | null;

/** The slim bar's review tools: the changes left, and which column shows
 *  beside the page. */
type ReviewTools = {
  count: number;
  side: Side;
  onSide: (side: Side) => void;
  /** False when the run's record names no source resume. */
  hasOriginal: boolean;
};

/** The bar on Tailor's review, as Google Docs draws its own (KAN-499): a
 *  pill, its tools from the left, white and ruled since the page's ground
 *  went grey. Both bars' buttons are dark grey, as Docs' are, and only a
 *  pressed one takes the brand. The page count's amber chip keeps its colour. */
const DOCS_BAR = cn(
  "bg-panel ring-border-subtle sticky top-2 z-20 flex min-h-11 flex-wrap items-center gap-2 rounded-full px-3 py-1 ring-1",
  "[&_button:not([aria-pressed=true]):not([data-bar-action])]:text-ink-muted [&_button:not([aria-pressed=true]):not([data-bar-action]):hover]:text-ink",
);

/** The editor's Undo and Redo (./history.ts), for the slim bar and the
 *  phone's bar. */
export type HistoryTools = {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
};

/**
 * Undo and Redo, first on the slim bar in both its states (KAN-391: until
 * then disabled, UI only). Each goes back or forward one step of
 * `HISTORY_STEPS`; Cmd+Z and Shift+Cmd+Z do the same off a field. A Fit to
 * One Page is one step too; its own Undo Fit button went on 2026-11-01.
 */
function History({ tools }: { tools?: HistoryTools }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Undo"
        title="Undo"
        disabled={!tools?.canUndo}
        onClick={tools?.onUndo}
      >
        <ArrowUUpLeftIcon aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Redo"
        title="Redo"
        disabled={!tools?.canRedo}
        onClick={tools?.onRedo}
      >
        <ArrowUUpRightIcon aria-hidden />
      </Button>
      <span aria-hidden className="bg-border-subtle mx-1 h-5 w-px" />
    </div>
  );
}

/**
 * The slim bar, the editor's one toolbar, on its own page and on Tailor's
 * review (KAN-411: the editor's own page had a brand-tinted full bar until
 * then, with a hint, a Done button and an amber Fit group, so a student saw
 * two editor designs). Over the page with the column beside it starting
 * level, holding only tools for the page: Undo and Redo (`History`), then
 * Fit to One Page (over one page only, `FitButton`) and, idle, Download at
 * the right,
 * secondary, since Finish is the review's one filled button. Not on This
 * Resume was a button here with a modal for a day; the review does not
 * need it (see the grid). No "Click a line to edit it." hint: the
 * pointer's own highlight on a line says so. On Tailor's review it is Docs'
 * bar (`DOCS_BAR`, KAN-499): a filled pill of Undo, Redo and zoom from the
 * left, with Download and the view icons (`ReviewButtons`) in the name's row. With a line open: the text's
 * own tools (a bullet's bold and italic) or an entry's or the header's
 * choices, and "Esc when done" in place of a Done button, since Escape or a
 * click off the page already saves and closes. The page's settings (font
 * size, spacing, margins) sat here too until 2026-11-01: beside bold and
 * italic they looked as if they acted on the selection, and they change the
 * whole page, so they are Format Options' alone.
 *
 * Download sat in the page's top row beside Finish for a day; the user
 * wanted it back with the page's tools. No Ask Scout: on the editor's own
 * page the top bar's Scout opens the assistant (`ScoutTakeover`), and an
 * Ask Scout ending this bar for a day was a second Scout button on one
 * page; on the review the panel holds the page's attention, and a second
 * AI entry beside it split it. The bar spanned the page and the panel for a
 * day, which put the panel under it, apart from the page; the panel folded
 * to a rail of its own (») until the user found it dated.
 */
function SlimBar({
  rendered,
  saving,
  elapsed,
  download,
  onFit,
  lineOpen,
  composing,
  editing,
  experiences,
  docs = false,
  format,
  zoom,
  history,
}: {
  rendered: RenderedPdf | null;
  saving: boolean;
  elapsed: number | null;
  download: ResumeDownload;
  onFit: () => void;
  /** Whether a line is open. */
  lineOpen: boolean;
  /** Whether that line is a bullet being added. */
  composing: boolean;
  /** The open line's own tools, if it has any. */
  editing: ReactNode;
  /** The editor's own page only; null on Tailor's review. */
  experiences: ExperiencesTools | null;
  /** Tailor's review: Docs' bar (`DOCS_BAR`), with zoom from the left and
   *  Download in the name's row. By the page, not the run's record, which
   *  is read after mount, so nothing moves when it lands. */
  docs?: boolean;
  /** The ways to the panels, at the bar's end while no line is open. */
  format?: FormatTools;
  /** The page's zoom control (`Zoom`), on the editor's own page only. */
  zoom?: ReactNode;
  history?: HistoryTools;
}) {
  const status = (
    <span className="text-note text-ink-meta pr-1" aria-live="polite">
      {saving ? "Saving…" : elapsed !== null ? `Saved, ${elapsed} ms` : ""}
    </span>
  );
  const box = docs ? DOCS_BAR : SLIM_BAR;
  const docsZoom = docs && zoom && (
    <>
      {zoom}
      <span aria-hidden className="bg-border-subtle mx-1 h-5 w-px" />
    </>
  );
  // Gone while a bullet is being added: a fit would read a resume without it
  const fitButton = !composing && rendered && rendered.page_count > 1 && (
    <FitButton
      pages={rendered.page_count}
      linesOver={rendered.lines_over}
      disabled={saving}
      onFit={onFit}
    />
  );
  if (lineOpen) {
    return (
      <div
        data-keeps-selection
        data-page-bar
        className={box}
        // A press on a button keeps focus in the field, so it does not blur and save first
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) e.preventDefault();
        }}
      >
        <History tools={history} />
        {docsZoom}
        {editing}
        {fitButton}
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
    <div data-keeps-selection data-page-bar className={box}>
      <History tools={history} />
      {docsZoom}
      {fitButton}
      {experiences?.picker && (
        // A button of the bar's own weight, as Download is: it is the way to
        // add to the resume, not a label. Tinted while its panel is open
        <Button
          variant="secondary"
          size="sm"
          aria-pressed={experiences.picker.open}
          title="Pick what this resume shows"
          className={cn(
            experiences.picker.open && "border-brand/50 bg-brand/10 text-brand hover:bg-brand/10",
          )}
          onClick={experiences.picker.onToggle}
        >
          <StackIcon aria-hidden /> Add Experiences
        </Button>
      )}
      {experiences?.cut && (
        // Beside Add Experiences, in the same weight, amber as Fit is
        <Button
          variant="secondary"
          size="sm"
          aria-pressed={experiences.cut.open}
          title="Put back what Fit to One Page cut"
          className={cn(
            "text-warning hover:text-warning",
            experiences.cut.open && "border-warning/50 bg-warning-tint hover:bg-warning-tint",
          )}
          onClick={experiences.cut.onToggle}
        >
          <ScissorsIcon aria-hidden /> Cut From Resume
        </Button>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {status}
        {format && (
          <>
            {format.marks && (
              <PanelButton
                label={format.marks.shown ? "Hide Suggestions" : "Show Suggestions"}
                Icon={format.marks.shown ? EyeSlashIcon : EyeIcon}
                open={false}
                disabled={format.disabled}
                onToggle={format.marks.onToggle}
              />
            )}
            <PanelButton
              label="Sections"
              Icon={ListDashesIcon}
              open={format.sectionsOpen}
              disabled={format.disabled}
              onToggle={() => format.onToggle("sections")}
            />
            <PanelButton
              label="Format Options"
              Icon={SlidersHorizontalIcon}
              open={format.formatOpen}
              disabled={format.disabled}
              onToggle={() => format.onToggle("format")}
            />
          </>
        )}
        {!docs && zoom}
        {/* On Tailor's review it sits in the name's row, as Docs' Share does.
            Secondary: Finish is the review's one filled button, and in the
            brand fill too, the two competed */}
        {!docs && <DownloadMenu download={download} />}
      </div>
    </div>
  );
}

/**
 * What sits beside the page on Tailor's review, as icons at the right of the
 * name's row, over the toolbar, where Google Docs keeps its own (KAN-499):
 * Original, the file every resume wears, and Suggestions, a lightbulb, each
 * tinted while its column is open, and each closing it when pressed again.
 * Docs' history and comment glyphs stood here for a moment, then the sparkle,
 * which read as Scout's beside the top bar's. The place is Docs', the marks
 * are WorkIt's. Neither open is
 * the page alone at full width. A three-way switch in the name's row held
 * this, then labelled buttons in the toolbar, which the user found unlike
 * Docs: the bar holds tools for the page, and these are the document's.
 */
function ReviewButtons({ review }: { review: ReviewTools }) {
  const button = (
    side: "suggestions" | "original",
    label: string,
    Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>,
    count = 0,
  ) => {
    const open = review.side === side;
    return (
      <IconButton
        label={count > 0 ? `${label}, ${count}` : label}
        tooltip={label}
        aria-pressed={open}
        className={cn(
          "hover:bg-ink/5 size-10 rounded-full after:inset-0",
          open && "bg-brand/10 text-brand hover:bg-brand/10 hover:text-brand",
        )}
        onClick={() => review.onSide(open ? null : side)}
      >
        <Icon aria-hidden className="size-5.5" />
        {count > 0 && (
          <span className="bg-brand text-on-brand absolute -top-0.5 -right-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums">
            {count}
          </span>
        )}
      </IconButton>
    );
  };
  return (
    <>
      {review.hasOriginal && button("original", "Original Resume", FileIcon)}
      {button("suggestions", "Suggestions", LightbulbIcon, review.count)}
    </>
  );
}

/** The way back to one page, on the bar only while the resume runs over it.
 *  It is the action itself: an amber "2 pages" chip with a caret came first,
 *  whose click opened a card holding this button, which the user found one
 *  step too many (2026-11-01). The count and what it does are in its title. A
 *  brand outline, since it is a choice the student may pass on, and Add Bullet
 *  beside it is the bar's one fill. */
function FitButton({
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
  const over =
    linesOver > 0
      ? `About ${linesOver} ${linesOver === 1 ? "line runs" : "lines run"} onto page 2.`
      : `It runs to ${pages} pages.`;
  return (
    <Button
      variant="outline"
      size="sm"
      data-bar-action
      className="shrink-0"
      title={`${over} This hides the least useful lines until it fits.`}
      disabled={disabled}
      onClick={onFit}
    >
      <ScissorsIcon aria-hidden /> Fit to One Page
    </Button>
  );
}

function LineActions({
  line,
  choices,
  header,
  onApply,
  onSaveHeader,
  onHide,
  up,
  down,
}: {
  line: Line;
  choices: Choices;
  header: Header;
  onApply: (changes: ChoicesUpdate) => void;
  onSaveHeader: (field: HeaderField, text: string) => void;
  onHide: (changes: ChoicesUpdate) => void;
  /** A phone's way to move a line; a desktop has the Sections panel. */
  up?: ChoicesUpdate | null;
  down?: ChoicesUpdate | null;
}) {
  const moves = up !== undefined && (
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
    const row = choices.bullets.find((c) => c.bullet_id === id);
    // One wording button, Original, shown while the bullet shows any other
    // wording (Tailor's or one typed on this resume): it puts the bank's
    // text back, and Undo takes it back. The resume's own wording stays
    // stored. A "Tailored N" button per Tailor wording went first, then a
    // This Resume's Wording button; the user wanted Original alone
    // (2026-10-29)
    const reworded = row?.variant_id != null || row?.text != null;
    return (
      <>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onHide({ bullets: [{ bullet_id: id, shown: false }] })}
        >
          <EyeSlashIcon aria-hidden /> Hide
        </Button>
        {moves}
        {reworded && (
          <Button
            variant="secondary"
            size="sm"
            title={line.bullet.text}
            onClick={() => onApply({ bullets: [{ bullet_id: id, variant_id: null }] })}
          >
            Original
          </Button>
        )}
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
        <EyeSlashIcon aria-hidden /> Hide Entry
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
      {!typed(line) && (
        <span className="text-note text-ink-meta">
          Change this in <TextLink href="/experiences">Experiences</TextLink>.
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
  onSave: (field: HeaderField, text: string) => void;
}) {
  const label = `Add ${kindLabel(field)}`;
  function save(element: HTMLInputElement) {
    const text = element.value.trim();
    if (!text) return;
    onSave(field, text);
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
 * title row's title, then the slim bar's box with Undo and Redo and its
 * end (Download) as bars, over a page's skeleton, in the
 * editor's own layout, so the editor that replaces it keeps every edge
 * where it was.
 */
export function EditorSkeleton() {
  return (
    <div aria-hidden="true" className="mt-4 flex flex-col gap-3">
      {/* The title's height (`ResumeTitle`) */}
      <div className="flex h-8 items-center">
        <Skeleton className="h-6 w-56 max-w-full" />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <div className={SLIM_BAR}>
          <Skeleton className="h-6 w-14" />
          <Skeleton className="ml-auto h-9 w-28" />
        </div>
        <PageSkeleton />
      </div>
    </div>
  );
}
