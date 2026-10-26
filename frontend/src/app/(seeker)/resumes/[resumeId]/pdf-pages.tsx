"use client";

import { ArrowUUpLeftIcon } from "@phosphor-icons/react/ssr";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Skeleton } from "@/components/shadcn/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { Button } from "@/components/ui/button";
import type { RenderBox } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";

import type { Mark, RevertTarget } from "./tailor-review";

/**
 * The rendered PDF drawn with pdf.js, one canvas per page, with a click
 * target over each line from the render's boxes (KAN-209). pdf.js is
 * imported inside an effect (loadPdfjs), so it never runs on the server and
 * loads only where this component mounts: the editor page and an upload's
 * page. Targets are placed in
 * percent of the page, so they need no redraw to follow the canvas's size.
 * `field` draws the selected line's text field over its first box (KAN-218);
 * each page is a size container, so the field's type can be set in `cqw` to
 * match the PDF's at any width. `marks` tints Tailor's changed lines and
 * `reverts` gives each change an inline action (./tailor-review.tsx).
 */

const MARK_TINT: Record<Mark, string> = {
  changed: "bg-positive/35",
  moved: "bg-warning-fill/25",
};

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
  reverts,
  onRevert,
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
  /** Tailor changes that can be reverted from their line. */
  reverts?: Map<string, RevertTarget>;
  onRevert?: (target: RevertTarget) => void;
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
    <div className="flex flex-col gap-4">
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
              const revert = reverts?.get(key);
              const mark = marks?.get(key);
              // A reworded bullet (green) shows the wording it replaced on hover
              const before =
                mark === "changed" && revert?.edit.kind === "reword" ? revert.edit.before : null;
              const target = {
                type: "button" as const,
                "aria-label": `${kindLabel(box.kind)}, page ${box.page}`,
                "aria-pressed": selected === key,
                onClick: () => onSelect(key),
                className: cn(
                  "absolute inset-0 rounded-[2px] outline-offset-1 transition-colors",
                  !mark && "hover:bg-brand/5",
                  mark && MARK_TINT[mark],
                  "focus-visible:outline-brand focus-visible:outline-2",
                  selected === key &&
                    (mark ? "outline-brand outline-2" : "bg-brand/10 outline-brand outline-2"),
                ),
              };
              return (
                <div
                  key={`${key}.${box.page}`}
                  className="group/marked absolute"
                  style={{
                    left: `${(box.x0 / size.width) * 100}%`,
                    top: `${(box.y0 / size.height) * 100}%`,
                    width: `${((box.x1 - box.x0) / size.width) * 100}%`,
                    height: `${((box.y1 - box.y0) / size.height) * 100}%`,
                  }}
                >
                  {before ? (
                    <Tooltip>
                      <TooltipTrigger {...target} />
                      <TooltipContent
                        side="right"
                        sideOffset={8}
                        className="block max-w-[min(20rem,calc(100vw-2rem))] text-left break-words whitespace-normal"
                      >
                        <span className="mb-0.5 block font-semibold">Before</span>
                        {before}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <button {...target} />
                  )}
                  {/* No Revert while a line is open: a click on one would throw
                      away what the student is typing, and a hover elsewhere
                      would crowd the line being edited. */}
                  {revert && onRevert && selected === null && (
                    <Button
                      variant="secondary"
                      size="xs"
                      aria-label={`Revert Tailor's change to ${kindLabel(box.kind).toLowerCase()}`}
                      onClick={() => onRevert(revert)}
                      className={cn(
                        "absolute right-0 bottom-full z-10 opacity-0 transition-opacity",
                        "pointer-events-none group-hover/marked:pointer-events-auto",
                        "group-focus-within/marked:pointer-events-auto group-hover/marked:opacity-100",
                        "group-focus-within/marked:opacity-100",
                      )}
                    >
                      <ArrowUUpLeftIcon aria-hidden /> Revert
                    </Button>
                  )}
                </div>
              );
            })}
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
