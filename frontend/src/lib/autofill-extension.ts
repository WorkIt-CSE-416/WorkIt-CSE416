"use client";

/**
 * The WorkIt Autofiller Chrome extension's id — stable because
 * autofiller_extension/manifest.json pins a dev signing key (its own
 * comment explains why that's safe to check in: it's the public half).
 * Prototype-only; a real published extension would get this from its
 * Chrome Web Store listing instead of a hardcoded constant.
 */
const EXTENSION_ID = "cpklhdkoafegnndlafmiceehfloodjgi";

type PingResponse = { installed: boolean; signedIn: boolean };

/**
 * Talks to the extension through manifest.json's `externally_connectable`
 * — the one, deliberately narrow channel a web page gets: "are you here,
 * and is someone signed in", plus asking the runner to open the next
 * queued application (`openNextApplication`, below). Never the profile
 * itself; see
 * autofiller_extension/src/background/background.js's own comment on why
 * that line is drawn where it is.
 *
 * Resolves to `{ installed: false, signedIn: false }` for anyone without
 * the extension (the overwhelmingly common case) rather than throwing —
 * `chrome.runtime` not existing, or the extension not existing, are both
 * just "no extension here", not errors a caller needs to handle specially.
 */
export function pingAutofillExtension(): Promise<PingResponse> {
  const runtime = (window as typeof window & { chrome?: { runtime?: { sendMessage?: unknown } } })
    .chrome?.runtime;

  if (!runtime?.sendMessage) {
    return Promise.resolve({ installed: false, signedIn: false });
  }

  return new Promise((resolve) => {
    try {
      (
        runtime.sendMessage as (
          id: string,
          message: unknown,
          cb: (response: unknown) => void,
        ) => void
      )(EXTENSION_ID, { type: "ping" }, (response) => {
        // No extension at this id (by far the common case, since almost
        // no visitor has it installed) sets lastError rather than
        // throwing — reading it here is what keeps that silent instead
        // of an "Unchecked runtime.lastError" console warning on every
        // job listing for everyone who doesn't have the extension.
        void (runtime as { lastError?: unknown }).lastError;
        const r = response as PingResponse | undefined;
        resolve(
          r?.installed
            ? { installed: true, signedIn: Boolean(r.signedIn) }
            : { installed: false, signedIn: false },
        );
      });
    } catch {
      resolve({ installed: false, signedIn: false });
    }
  });
}

/** What the extension's runner did with `run/open`. */
export type OpenApplicationResult =
  | { opened: true; jobId: string; url: string }
  | { opened: false; reason: "not_installed" | "queue_empty" | "signed_out" }
  | { opened: false; reason: "error"; error: string };

/**
 * Asks the extension's runner to open the next queued application's
 * apply_url in its own window, behind this one
 * (autofiller_extension/src/background/runner.js). The message carries no
 * URL: the runner reads the queue from the API itself. Resolves once the
 * page has loaded, or with why nothing opened; never throws.
 */
export function openNextApplication(): Promise<OpenApplicationResult> {
  const runtime = (window as typeof window & { chrome?: { runtime?: { sendMessage?: unknown } } })
    .chrome?.runtime;

  if (!runtime?.sendMessage) {
    return Promise.resolve({ opened: false, reason: "not_installed" });
  }

  return new Promise((resolve) => {
    try {
      (
        runtime.sendMessage as (
          id: string,
          message: unknown,
          cb: (response: unknown) => void,
        ) => void
      )(EXTENSION_ID, { type: "run/open" }, (response) => {
        // No extension at this id sets lastError and answers undefined.
        void (runtime as { lastError?: unknown }).lastError;
        const r = response as
          | ({ ok: true } & Exclude<OpenApplicationResult, { reason: "not_installed" | "error" }>)
          | { ok: false; error: string }
          | undefined;
        if (r === undefined) resolve({ opened: false, reason: "not_installed" });
        else if (!r.ok) resolve({ opened: false, reason: "error", error: r.error });
        else
          resolve(
            r.opened
              ? { opened: true, jobId: r.jobId, url: r.url }
              : { opened: false, reason: r.reason },
          );
      });
    } catch {
      resolve({ opened: false, reason: "not_installed" });
    }
  });
}
