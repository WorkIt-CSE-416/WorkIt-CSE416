"use client";

import { useEffect, useRef, useState } from "react";

import type { LatexOp } from "@/lib/latex-actions";

/**
 * The editor's live preview: the source and its pending edits compiled to a
 * PDF (app/api/latex/preview), about a second after typing stops. A compile
 * costs the API about a second, so one per pause, never one per keystroke;
 * a newer request aborts the one in flight. A compile that fails keeps the
 * last good PDF on screen beside the error, so a typo never blanks the page
 * the applicant is reading.
 */

const PAUSE_MS = 1200;

type Preview = { url: string | null; pages: number; error: string | null; compiling: boolean };

async function messageOf(res: Response) {
  const body: unknown = await res.json().catch(() => null);
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && typeof detail[0]?.msg === "string") return detail[0].msg as string;
  return "The preview couldn't be compiled.";
}

export function usePreview(body: { source: string; ops: LatexOp[] }): Preview {
  const [state, setState] = useState<Preview>({
    url: null,
    pages: 0,
    error: null,
    compiling: false,
  });
  const first = useRef(true);
  const key = JSON.stringify(body);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        setState((s) => ({ ...s, compiling: true }));
        try {
          const res = await fetch("/api/latex/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: key,
            signal: controller.signal,
          });
          if (!res.ok) {
            const error = await messageOf(res);
            setState((s) => ({ ...s, error, compiling: false }));
            return;
          }
          const url = URL.createObjectURL(await res.blob());
          const pages = Number(res.headers.get("X-Pages") ?? "1") || 1;
          setState((s) => {
            if (s.url) URL.revokeObjectURL(s.url);
            return { url, pages, error: null, compiling: false };
          });
        } catch {
          if (controller.signal.aborted) return;
          setState((s) => ({ ...s, error: "Could not reach the server.", compiling: false }));
        }
      },
      // The first compile is the page opening: no pause to wait for
      first.current ? 0 : PAUSE_MS,
    );
    first.current = false;
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  // The last PDF's blob is freed with the editor
  const latest = useRef(state.url);
  useEffect(() => {
    latest.current = state.url;
  }, [state.url]);
  useEffect(
    () => () => {
      if (latest.current) URL.revokeObjectURL(latest.current);
    },
    [],
  );

  return state;
}
