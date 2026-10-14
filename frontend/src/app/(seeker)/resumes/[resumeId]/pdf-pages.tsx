"use client";

import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { RenderBox } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";

/**
 * The rendered PDF drawn with pdf.js, one canvas per page, with a click
 * target over each line from the render's boxes (KAN-209). pdf.js is
 * imported inside an effect, so it never runs on the server and loads only
 * where this component mounts: the editor page. Targets are placed in
 * percent of the page, so they need no redraw to follow the canvas's size.
 * `field` draws the selected line's text field over its first box (KAN-218);
 * each page is a size container, so the field's type can be set in `cqw` to
 * match the PDF's at any width.
 */

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

export function PdfPages({
  pdf,
  boxes,
  selected,
  onSelect,
  onDrawn,
  field,
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
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc ||= new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
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
  if (!doc) return <p className="text-body text-ink-meta">Drawing the PDF…</p>;

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
              return (
                <button
                  key={`${key}.${box.page}`}
                  type="button"
                  aria-label={`${kindLabel(box.kind)}, page ${box.page}`}
                  aria-pressed={selected === key}
                  onClick={() => onSelect(key)}
                  className={cn(
                    "absolute rounded-[2px] outline-offset-1 transition-colors",
                    "hover:bg-brand/5 focus-visible:outline-brand focus-visible:outline-2",
                    selected === key && "bg-brand/10 outline-brand outline-2",
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
