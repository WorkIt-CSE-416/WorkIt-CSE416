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
 * `field` draws the selected line's text field over its first box (KAN-218);
 * each page is a size container, so the field's type can be set in `cqw` to
 * match the PDF's at any width. On Tailor's review, `dots` puts a small
 * dot in the page's left margin beside each changed line, in its mark's
 * colour (green added, blue reworded, amber moved); `marks` highlights the lines of the card in focus or open, and
 * `focus` brings the first of them into view (./tailor-review.tsx).
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

/** A margin dot's fill, by the line's mark: the highlight's dark shade, the
 *  colour its type has in the Suggestions panel. */
const DOT_FILL: Record<Mark, string> = {
  added: "bg-positive-ink",
  reworded: "bg-advanced",
  moved: "bg-warning-strong",
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
  field,
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
  /** The text field for the selected line, laid over its first box. */
  field?: (box: RenderBox) => ReactNode;
  /** Shown until pdf.js has read the PDF: the editor's PageSkeleton, so
   *  its skeleton holds until the canvas. A line of text by default. */
  placeholder?: ReactNode;
  /** Tailor's changed lines, by box key, while their changes are untouched. */
  marks?: Map<string, Mark>;
  /** The lines of the Suggestions card in focus, by box key. */
  focus?: string[];
  /** Tailor's margin dots, by box key, and what a click on one does. */
  dots?: Map<string, Dot>;
  onDot?: (key: string) => void;
}) {
  const first = boxes.find((b) => boxKey(b) === selected);
  const typing = first && field?.(first);
  const [doc, setDoc] = useState<{ pdf: PDFDocumentProxy; sizes: Size[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const painted = useRef(new Set<number>());
  const drawn = useRef(onDrawn);
  useEffect(() => {
    drawn.current = onDrawn;
  });
  // The focused card's first line comes into view, if it is not already
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
      setDoc({ pdf: loaded, sizes });
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
            onPainted={() => {
              painted.current.add(i);
              if (painted.current.size === doc.sizes.length) drawn.current?.();
            }}
          />
          {boxes
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
                    top: `${(box.y0 / size.height) * 100}%`,
                    width: `${((box.x1 - box.x0) / size.width) * 100}%`,
                    height: `${((box.y1 - box.y0) / size.height) * 100}%`,
                  }}
                />
              );
            })}
          {dots && <MarginDots boxes={boxes} page={i + 1} size={size} dots={dots} onDot={onDot} />}
          {first?.page === i + 1 && typing && (
            <div
              className="absolute z-10"
              style={{
                left: `${(first.x0 / size.width) * 100}%`,
                top: `${(first.y0 / size.height) * 100}%`,
                minWidth: `${((first.x1 - first.x0) / size.width) * 100}%`,
              }}
            >
              {typing}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** One page's margin dots: one per changed line, at its first box's top, in
 *  the left margin. Dots on one row (skills on one line) stack like coins,
 *  8px apart, each ringed in white, so they stay inside the margin. */
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
            "outline-panel absolute z-10 size-2.5 rounded-full shadow-sm outline-2 transition-transform hover:z-20 hover:scale-125",
            "focus-visible:outline-brand focus-visible:outline-2 focus-visible:outline-offset-1",
            DOT_FILL[dot.mark],
            dot.lit && "ring-brand scale-125 ring-2 ring-offset-1",
          )}
          style={{
            left: `calc(${(12 / size.width) * 100}% + ${nth * 8}px)`,
            top: `calc(${(box.y0 / size.height) * 100}% + 3px)`,
          }}
        />
      );
    });
}

/** One page, redrawn at the canvas's own width in device pixels. */
function PageCanvas({
  pdf,
  page,
  size,
  onPainted,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  size: Size;
  onPainted: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
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
        element!.width = Math.round(viewport.width);
        element!.height = Math.round(viewport.height);
        task = proxy.render({ canvas: element!, viewport });
        await task.promise;
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
