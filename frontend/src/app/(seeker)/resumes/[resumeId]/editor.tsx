"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { renderResumePdf, type RenderedPdf } from "@/lib/built-resume-actions";

import { boxKey, kindLabel, PdfPages } from "./pdf-pages";

/**
 * The editor overlay proof (KAN-209): the built resume's own PDF, with a
 * click target over each line. A click selects a line; Escape clears it.
 * There is no editing yet (KAN-218). "Render Again" times the round trip a
 * saved edit will take, from the request to the new PDF on screen, and drops
 * a response older than the latest request, as the editor's saves will.
 */
export function Editor({ resumeId, initial }: { resumeId: string; initial: RenderedPdf }) {
  const [rendered, setRendered] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const latest = useRef(0);
  const started = useRef<number | null>(null);

  useEffect(() => {
    const clear = (event: KeyboardEvent) => event.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", clear);
    return () => window.removeEventListener("keydown", clear);
  }, []);

  async function renderAgain() {
    const request = ++latest.current;
    started.current = performance.now();
    setBusy(true);
    setError(null);
    const { data, error } = await renderResumePdf(resumeId);
    if (request !== latest.current) return; // a newer request owns the page
    setBusy(false);
    if (!data) return setError(error);
    setRendered(data);
  }

  const box = rendered.boxes.find((b) => boxKey(b) === selected);

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-ink-muted" aria-live="polite">
          {box
            ? `Selected: ${kindLabel(box.kind)}, page ${box.page}`
            : "Click a line to select it."}
        </p>
        <div className="flex items-center gap-3">
          {elapsed != null && (
            <span className="text-note text-ink-meta">Round trip {elapsed} ms</span>
          )}
          <Button variant="secondary" size="sm" onClick={renderAgain} disabled={busy}>
            <RefreshCw /> {busy ? "Rendering…" : "Render Again"}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-note text-danger">
          {error}
        </p>
      )}
      <PdfPages
        pdf={rendered.pdf}
        boxes={rendered.boxes}
        selected={selected}
        onSelect={(key) => setSelected((current) => (current === key ? null : key))}
        onDrawn={() => {
          if (started.current == null) return;
          setElapsed(Math.round(performance.now() - started.current));
          started.current = null;
        }}
      />
    </div>
  );
}
