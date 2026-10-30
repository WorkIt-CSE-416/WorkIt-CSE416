"use client";

import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Skeleton } from "@/components/shadcn/skeleton";
import type { RenderBox } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";

import type { Mark } from "./tailor-review";

/**
 * The rendered PDF drawn with pdf.js, one canvas per page, with a click
 * target over each line from the render's boxes (KAN-209). pdf.js is
 * imported inside an effect (loadPdfjs), so it never runs on the server and
 * loads only where this component mounts: the editor page and an upload's
 * page. Targets are placed in
 * percent of the page, so they need no redraw to follow the canvas's size.
 * `overlay` draws over the first box of each line in `overlaid`: the
 * selected line's text field (KAN-218), and typed text the PDF does not
 * print yet; each page is a size container, so their type can be set in
 * `cqw` to match the PDF's at any width. Under them is the live page's
 * first step (KAN-391, docs/live_page.md): each such line's glyphs are
 * cleared, and everything below it on its page moves by `shiftOf` it, the
 * points its text grew or shrank, click targets too, so the
 * page reflows as the student types. The boxes drawn are the ones that
 * came with the PDF on screen, so a new PDF's boxes never land on the old
 * page. `swaps` shows a move before its PDF lands: two neighbours' strips
 * of the page trade places, under any overlaid line. On Tailor's review, `dots` puts a small
 * brand dot in the page's left margin beside each changed line; `marks`
 * highlights the lines of the card in focus or open, in the colour of its
 * change type, and `focus` brings the first of them into view
 * (./tailor-review.tsx).
 */

/** A marked line's highlight, as Quinncia draws one: the tint, rounded
 *  (`MARK_TINT`), and its edge (`MARK_EDGE`), the tint carried 1px past the
 *  line by a spread shadow so the text does not touch the edge, then a 1px
 *  border in the mark's dark shade at half strength. A flat tint with
 *  square corners read as a smear; the border at full strength read too
 *  thick (2026-10-26). A line being typed in keeps the tint only: the
 *  field's ring is its one outline. */
const MARK_TINT: Record<Mark, string> = {
  added: "rounded-[4px] bg-positive/20",
  reworded: "rounded-[4px] bg-advanced/15",
  moved: "rounded-[4px] bg-warning-fill/20",
};

const MARK_EDGE: Record<Mark, string> = {
  added:
    "shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-positive)_20%,transparent),0_0_0_2px_color-mix(in_oklab,var(--color-positive-ink)_50%,transparent)]",
  reworded:
    "shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-advanced)_15%,transparent),0_0_0_2px_color-mix(in_oklab,var(--color-advanced)_50%,transparent)]",
  moved:
    "shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-warning-fill)_20%,transparent),0_0_0_2px_color-mix(in_oklab,var(--color-warning-strong)_50%,transparent)]",
};

const DOT_LABEL: Record<Mark, string> = {
  added: "Show the suggestion for this added line",
  reworded: "Show the suggestion for this reworded line",
  moved: "Show the suggestion for this moved bullet",
};

/** A line's margin dot: the line's mark, and whether its card is in focus.
 *  Dots carried their card's number until 2026-10-26: numbered cards and
 *  dots read as an order the student had to follow. */
export type Dot = { mark: Mark; lit: boolean };

/** A box's identity across renders: its bank item and which part of it. */
export const boxKey = (box: Pick<RenderBox, "item_id" | "kind">) => `${box.item_id}.${box.kind}`;

const KIND_LABELS: Record<string, string> = {
  bullet: "Bullet",
  skill: "Skill",
  title: "Title",
  organization: "Organization",
  location: "Location",
  dates: "Dates",
  degree: "Degree",
  gpa: "GPA",
  coursework: "Coursework",
  honors: "Honors",
  full_name: "Name",
  phone_number: "Phone",
  email: "Email",
  linkedin_url: "LinkedIn",
  github_url: "GitHub",
  portfolio_url: "Portfolio",
  other_url: "Link",
};
export const kindLabel = (kind: string) => KIND_LABELS[kind] ?? kind;

type Size = { width: number; height: number };

let pdfjsLoading: Promise<typeof import("pdfjs-dist")> | null = null;

/**
 * pdf.js, imported once and shared, with its worker set. PdfPages waits on
 * it, and the editor calls it as it mounts (KAN-368), so the library
 * downloads while the server is still compiling the PDF rather than after
 * the PDF has arrived. A failed import is forgotten, so the next caller
 * tries again.
 */
export function loadPdfjs() {
  pdfjsLoading ??= import("pdfjs-dist").then(
    (pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc ||= new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    },
    (error: unknown) => {
      pdfjsLoading = null;
      throw error;
    },
  );
  return pdfjsLoading;
}

/** A Letter page's proportions, in points: 8.5 by 11 inches. */
const LETTER = "612 / 792";

/**
 * A page's place while the PDF is on its way: the page's own box (white,
 * its border and shadow, Letter's 8.5 by 11), with bars where a resume's
 * name, contact line, headings and lines sit, so the editor and an upload's
 * page hold their full height and the PDF lands in place. One page: a
 * second page, when there is one, extends the column below the first.
 */
export function PageSkeleton() {
  return (
    <div
      role="status"
      className="bg-panel border-border-subtle flex w-full flex-col items-center gap-2 overflow-hidden border px-[8%] pt-[7%] shadow-sm"
      style={{ aspectRatio: LETTER }}
    >
      <span className="sr-only">Drawing the PDF</span>
      <Skeleton aria-hidden="true" className="h-5 w-2/5" />
      <Skeleton aria-hidden="true" className="h-2.5 w-3/5" />
      {[0, 1, 2].map((section) => (
        <div key={section} aria-hidden="true" className="mt-5 flex w-full flex-col gap-2">
          <Skeleton className="h-3 w-1/4" />
          {["w-full", "w-11/12", "w-full", "w-4/5"].map((width, line) => (
            <Skeleton key={line} className={cn("h-2", width)} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PdfPages({
  pdf,
  boxes,
  selected,
  onSelect,
  onDrawn,
  overlay,
  overlaid = [],
  shiftOf,
  swaps,
  placeholder,
  marks,
  focus,
  dots,
  onDot,
}: {
  /** base64, as the render response sends it */
  pdf: string;
  boxes: RenderBox[];
  selected: string | null;
  onSelect: (key: string) => void;
  /** Called once every page of this `pdf` has painted. */
  onDrawn?: () => void;
  /** What to draw over the first box of each line in `overlaid`, by box
   *  key: the text field for the selected line, typed text for others. */
  overlay?: (box: RenderBox) => ReactNode;
  overlaid?: string[];
  /** Points an overlaid line's text is taller (or, below 0, shorter) than
   *  its box on the PDF on screen: what the page under it moves by. */
  shiftOf?: (box: RenderBox) => number;
  /** The moves on their way, as strips of the page on screen that trade
   *  places, in order, each against the page after the ones before. */
  swaps?: (boxes: RenderBox[]) => Strip[];
  /** Shown until pdf.js has read the PDF: the editor's PageSkeleton, so
   *  its skeleton holds until the canvas. A line of text by default. */
  placeholder?: ReactNode;
  /** Tailor's changed lines, by box key, while their changes are untouched. */
  marks?: Map<string, Mark>;
  /** The lines of the open suggestion, by box key, scrolled into view. */
  focus?: string[];
  /** Tailor's margin dots, by box key, and what a click on one does. */
  dots?: Map<string, Dot>;
  onDot?: (key: string) => void;
}) {
  const [doc, setDoc] = useState<{
    pdf: PDFDocumentProxy;
    sizes: Size[];
    boxes: RenderBox[];
  } | null>(null);
  // The boxes of the PDF on screen, where the moves on their way put them
  const strips = swaps?.(doc?.boxes ?? []) ?? [];
  const shown = (doc?.boxes ?? []).map((box) => afterStrips(box, strips));
  // Each overlaid line's first box, top to bottom, with what it moves by
  const lives = overlaid
    .map((key) => shown.find((b) => boxKey(b) === key))
    .filter((box): box is RenderBox => box !== undefined)
    .map((box) => ({ ...box, by: shiftOf?.(box) ?? 0 }))
    .sort((a, b) => a.page - b.page || a.y0 - b.y0);
  const typing = selected !== null && lives.some((l) => boxKey(l) === selected);
  // A target below an overlaid line moves with the page under it
  const moved = (box: RenderBox) =>
    lives.reduce((by, l) => (l.page === box.page && l.y1 <= box.y0 ? by + l.by : by), 0);
  const [failed, setFailed] = useState(false);
  const painted = useRef(new Set<number>());
  const drawn = useRef(onDrawn);
  // The boxes that came with `pdf`, read when it has loaded: a page that
  // passes none passes a new empty array each render
  const latestBoxes = useRef(boxes);
  useEffect(() => {
    drawn.current = onDrawn;
    latestBoxes.current = boxes;
  });
  // The open suggestion's first line comes into view, if it is not already
  const frame = useRef<HTMLDivElement>(null);
  const focusFirst = focus?.[0];
  useEffect(() => {
    if (!focusFirst) return;
    frame.current
      ?.querySelector(`[data-box="${CSS.escape(focusFirst)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusFirst, doc]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pdfjs = await loadPdfjs();
      const data = Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0));
      const loaded = await pdfjs.getDocument({ data }).promise;
      const sizes: Size[] = [];
      for (let n = 1; n <= loaded.numPages; n++) {
        const { width, height } = (await loaded.getPage(n)).getViewport({ scale: 1 });
        sizes.push({ width, height });
      }
      // A newer PDF arrived while this one loaded
      if (cancelled) return void loaded.destroy();
      painted.current = new Set();
      setDoc({ pdf: loaded, sizes, boxes: latestBoxes.current });
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [pdf]);

  // The old document stays on screen until the new one replaces it
  useEffect(() => () => void doc?.pdf.destroy(), [doc]);

  if (failed) {
    return (
      <p role="alert" className="text-body text-danger">
        The PDF could not be shown. Reload the page to try again.
      </p>
    );
  }
  if (!doc) return placeholder ?? <p className="text-body text-ink-meta">Drawing the PDF…</p>;

  return (
    <div ref={frame} className="flex flex-col gap-4">
      {doc.sizes.map((size, i) => (
        <div
          key={i}
          className="bg-panel border-border-subtle @container relative w-full border shadow-sm"
          style={{ aspectRatio: `${size.width} / ${size.height}` }}
        >
          <PageCanvas
            pdf={doc.pdf}
            page={i + 1}
            size={size}
            lives={lives.filter((l) => l.page === i + 1)}
            strips={strips.filter((s) => s.page === i + 1)}
            onPainted={() => {
              painted.current.add(i);
              if (painted.current.size === doc.sizes.length) drawn.current?.();
            }}
          />
          {shown
            .filter((box) => box.page === i + 1)
            .map((box) => {
              const key = boxKey(box);
              const mark = marks?.get(key);
              return (
                <button
                  key={`${key}.${box.page}`}
                  type="button"
                  data-box={key}
                  aria-label={`${kindLabel(box.kind)}, page ${box.page}`}
                  aria-pressed={selected === key}
                  onClick={() => onSelect(key)}
                  className={cn(
                    "absolute rounded-[2px] outline-offset-1 transition-colors",
                    !mark && "hover:bg-brand/5",
                    mark && MARK_TINT[mark],
                    mark && !(selected === key && typing) && MARK_EDGE[mark],
                    "focus-visible:outline-brand focus-visible:outline-2",
                    // While its line is typed in, the field's ring is the one
                    // outline: this box sits a few pixels off the field, and its
                    // own outline showed as a second line under the ring.
                    selected === key && !typing && "outline-brand outline-2",
                    selected === key && !typing && !mark && "bg-brand/10",
                  )}
                  style={{
                    left: `${(box.x0 / size.width) * 100}%`,
                    top: `${((box.y0 + moved(box)) / size.height) * 100}%`,
                    width: `${((box.x1 - box.x0) / size.width) * 100}%`,
                    height: `${((box.y1 - box.y0) / size.height) * 100}%`,
                  }}
                />
              );
            })}
          {dots && <MarginDots boxes={shown} page={i + 1} size={size} dots={dots} onDot={onDot} />}
          {lives
            .filter((l) => l.page === i + 1)
            .map((l) => (
              <div
                key={boxKey(l)}
                className="absolute z-10"
                style={{
                  left: `${(l.x0 / size.width) * 100}%`,
                  top: `${((l.y0 + moved(l)) / size.height) * 100}%`,
                  minWidth: `${((l.x1 - l.x0) / size.width) * 100}%`,
                }}
              >
                {overlay?.(l)}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

/** One page's margin dots: one per changed line, at its first box's top, in
 *  the left margin. Dots on one row (skills on one line) stack like coins,
 *  7px apart, each ringed in white, so they stay inside the margin. */
function MarginDots({
  boxes,
  page,
  size,
  dots,
  onDot,
}: {
  boxes: RenderBox[];
  page: number;
  size: Size;
  dots: Map<string, Dot>;
  onDot?: (key: string) => void;
}) {
  const placed = new Set<string>();
  const perRow = new Map<number, number>();
  return boxes
    .filter((box) => box.page === page)
    .map((box) => {
      const key = boxKey(box);
      const dot = dots.get(key);
      if (!dot || placed.has(key)) return null;
      placed.add(key);
      const row = Math.round(box.y0);
      const nth = perRow.get(row) ?? 0;
      perRow.set(row, nth + 1);
      return (
        <button
          key={`${key}.dot`}
          type="button"
          aria-label={DOT_LABEL[dot.mark]}
          onClick={() => onDot?.(key)}
          className={cn(
            // Brand purple whatever the change, and 8px: in each type's
            // colour the amber dots read as one more signal among the
            // highlights; a dot says only that a line changed, the panel
            // says how
            "outline-panel bg-brand absolute z-10 size-2 rounded-full shadow-sm outline-2 transition-transform hover:z-20 hover:scale-125",
            "focus-visible:outline-brand focus-visible:outline-2 focus-visible:outline-offset-1",
            dot.lit && "ring-brand scale-125 ring-2 ring-offset-1",
          )}
          style={{
            left: `calc(${(12 / size.width) * 100}% + ${nth * 7}px)`,
            top: `calc(${(box.y0 / size.height) * 100}% + 4px)`,
          }}
        />
      );
    });
}

/** An overlaid line's box, in PDF points, and how far the page under it
 *  moves. */
type Live = Pick<RenderBox, "x0" | "y0" | "x1" | "y1"> & { by: number };

/** Two neighbours on one page, `a` above `b`, as their tops and bottoms in
 *  PDF points: a move on its way trades their strips of the page. */
export type Strip = { page: number; a: [number, number]; b: [number, number] };

/** Where a box sits once these strips have traded places, in order. */
export function afterStrips<T extends RenderBox>(box: T, strips: Strip[]): T {
  let { y0, y1 } = box;
  for (const { page, a, b } of strips) {
    if (page !== box.page) continue;
    const by =
      y0 >= a[0] - 0.5 && y1 <= a[1] + 0.5
        ? b[1] - a[1]
        : y0 >= b[0] - 0.5 && y1 <= b[1] + 0.5
          ? a[0] - b[0]
          : 0;
    y0 += by;
    y1 += by;
  }
  return { ...box, y0, y1 };
}

/** The drawing with each strip pair traded, in order: `b` moves up to `a`'s
 *  top, then the gap that sat between them, then `a`. */
function traded(drawn: HTMLCanvasElement, strips: Strip[], scale: number) {
  let current = drawn;
  for (const strip of strips) {
    const [a0, a1, b0, b1] = [...strip.a, ...strip.b].map((v) => Math.round(v * scale));
    const next = document.createElement("canvas");
    next.width = current.width;
    next.height = current.height;
    const context = next.getContext("2d")!;
    context.drawImage(current, 0, 0);
    context.fillStyle = "#fff";
    context.fillRect(0, a0, next.width, b1 - a0);
    context.drawImage(current, 0, b0, next.width, b1 - b0, 0, a0, next.width, b1 - b0);
    context.drawImage(current, 0, a0, next.width, a1 - a0, 0, a0 + b1 - a1, next.width, a1 - a0);
    current = next;
  }
  return current;
}

/** The page's drawing onto the shown canvas: as drawn, with the moves on
 *  their way traded (`strips`), then each overlaid line (`lives`, top to
 *  bottom) cleared and everything under it moved by its `by`, the moves
 *  adding up down the page. The paper is white in either theme, as pdf.js
 *  paints it. */
function compose(
  shown: HTMLCanvasElement,
  pdfDrawn: HTMLCanvasElement,
  strips: Strip[],
  lives: Live[],
  scale: number,
) {
  const drawn = strips.length ? traded(pdfDrawn, strips, scale) : pdfDrawn;
  shown.width = drawn.width;
  shown.height = drawn.height;
  const context = shown.getContext("2d")!;
  context.drawImage(drawn, 0, 0);
  context.fillStyle = "#fff";
  const px = (points: number) => Math.round(points * scale);
  let moved = 0;
  for (const live of lives) {
    const [x0, y0, x1, y1, by] = [live.x0, live.y0, live.x1, live.y1, live.by].map(px);
    context.fillRect(x0, y0 + moved, x1 - x0, y1 - y0);
    if (by === 0) continue;
    // Everything under this line, drawn again where it now sits
    moved += by;
    const below = drawn.height - y1;
    context.fillRect(0, y1 + moved - by, drawn.width, drawn.height);
    context.drawImage(drawn, 0, y1, drawn.width, below, 0, y1 + moved, drawn.width, below);
  }
}

/** One page, redrawn at the canvas's own width in device pixels. Each draw
 *  paints a hidden canvas and copies it over the shown one in one step:
 *  sizing a canvas blanks it, and a new PDF's page blanked the shown one
 *  for the whole pdf.js draw, a dark flash after every edit (KAN-391). The
 *  hidden canvas is kept, so a change to `lives` composes again with no
 *  draw, but only onto this `pdf`'s drawing: a new PDF's lines composed
 *  onto the old drawing would clear and move the wrong lines. */
function PageCanvas({
  pdf,
  page,
  size,
  lives,
  strips,
  onPainted,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  size: Size;
  lives: Live[];
  strips: Strip[];
  onPainted: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawnCanvas = useRef<{ pdf: PDFDocumentProxy; canvas: HTMLCanvasElement } | null>(null);
  const latest = useRef({ lives, strips });
  const layoutKey = JSON.stringify([lives.map((l) => [l.x0, l.y0, l.x1, l.y1, l.by]), strips]);
  useEffect(() => {
    latest.current = { lives, strips };
    const shown = canvas.current;
    const drawn = drawnCanvas.current;
    if (shown && drawn?.pdf === pdf) {
      compose(shown, drawn.canvas, strips, lives, drawn.canvas.width / size.width);
    }
  }, [layoutKey, pdf, size.width]); // eslint-disable-line react-hooks/exhaustive-deps
  const painted = useRef(onPainted);
  useEffect(() => {
    painted.current = onPainted;
  });

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let task: RenderTask | null = null;
    let width = 0;
    let first = true;

    async function draw() {
      const target = Math.round(element!.clientWidth * window.devicePixelRatio);
      if (target === 0 || target === width) return;
      width = target;
      task?.cancel();
      try {
        const proxy = await pdf.getPage(page);
        const viewport = proxy.getViewport({ scale: target / size.width });
        const hidden = document.createElement("canvas");
        hidden.width = Math.round(viewport.width);
        hidden.height = Math.round(viewport.height);
        task = proxy.render({ canvas: hidden, viewport });
        await task.promise;
        drawnCanvas.current = { pdf, canvas: hidden };
        compose(
          element!,
          hidden,
          latest.current.strips,
          latest.current.lives,
          hidden.width / size.width,
        );
      } catch {
        return; // cancelled by a newer draw, or the document was replaced
      }
      if (first) {
        first = false;
        painted.current();
      }
    }

    const observer = new ResizeObserver(() => void draw());
    observer.observe(element);
    return () => {
      observer.disconnect();
      task?.cancel();
    };
  }, [pdf, page, size.width]);

  return <canvas ref={canvas} aria-hidden className="absolute inset-0 size-full" />;
}
