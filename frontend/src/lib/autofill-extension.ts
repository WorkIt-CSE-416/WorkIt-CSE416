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
 * and is someone signed in". Never the profile itself; see
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
