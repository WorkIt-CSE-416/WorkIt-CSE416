"use client";

import { useSyncExternalStore } from "react";

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
 * Sends one message to the extension and resolves to its answer, or to
 * undefined when there is no extension: `chrome.runtime` not existing, or
 * no extension at this id, are both just "no extension here", not errors a
 * caller needs to handle specially. Never throws.
 */
function sendToExtension(message: { type: string }): Promise<unknown> {
  const runtime = (window as typeof window & { chrome?: { runtime?: { sendMessage?: unknown } } })
    .chrome?.runtime;

  if (!runtime?.sendMessage) return Promise.resolve(undefined);

  return new Promise((resolve) => {
    try {
      (
        runtime.sendMessage as (
          id: string,
          message: unknown,
          cb: (response: unknown) => void,
        ) => void
      )(EXTENSION_ID, message, (response) => {
        // No extension at this id (by far the common case, since almost
        // no visitor has it installed) sets lastError rather than
        // throwing — reading it here is what keeps that silent instead
        // of an "Unchecked runtime.lastError" console warning on every
        // job listing for everyone who doesn't have the extension.
        void (runtime as { lastError?: unknown }).lastError;
        resolve(response);
      });
    } catch {
      resolve(undefined);
    }
  });
}

/**
 * Talks to the extension through manifest.json's `externally_connectable`
 * — the one, deliberately narrow channel a web page gets: "are you here,
 * and is someone signed in", plus the runner's three messages below (open
 * the next queued application, which job its window shows, bring that
 * window to the front). Never the profile itself; see
 * autofiller_extension/src/background/background.js's own comment on why
 * that line is drawn where it is.
 *
 * Resolves to `{ installed: false, signedIn: false }` for anyone without
 * the extension (the overwhelmingly common case) rather than throwing.
 */
export async function pingAutofillExtension(): Promise<PingResponse> {
  const r = (await sendToExtension({ type: "ping" })) as PingResponse | undefined;
  return r?.installed
    ? { installed: true, signedIn: Boolean(r.signedIn) }
    : { installed: false, signedIn: false };
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
 * URL: the runner reads the queue from the API itself. A window already on
 * that application is left as it is. Resolves once the page has loaded, or
 * with why nothing opened; never throws. Updates `useRunnerJob`.
 */
export async function openNextApplication(): Promise<OpenApplicationResult> {
  const r = (await sendToExtension({ type: "run/open" })) as
    | ({ ok: true } & Exclude<OpenApplicationResult, { reason: "not_installed" | "error" }>)
    | { ok: false; error: string }
    | undefined;
  if (r === undefined) return { opened: false, reason: "not_installed" };
  if (!r.ok) return { opened: false, reason: "error", error: r.error };
  setRunnerJob(r.opened ? r.jobId : null);
  return r.opened
    ? { opened: true, jobId: r.jobId, url: r.url }
    : { opened: false, reason: r.reason };
}

/** Brings the run's window to the front. False when it was closed (and
 *  `useRunnerJob` drops the job) or the extension failed to answer (it
 *  keeps the job). */
export async function showRunWindow(): Promise<boolean> {
  const r = (await sendToExtension({ type: "run/show" })) as
    { ok: true; shown: boolean } | { ok: false } | undefined;
  if (!r?.ok) return false;
  if (!r.shown) setRunnerJob(null);
  return r.shown;
}

/**
 * WHICH JOB POSTING THE RUN'S WINDOW SHOWS, shared by every caller on the
 * page: each job card's Auto Apply and Live Activity read one value, so the
 * extension is asked once, not once per card. Asked on the first
 * subscriber and again whenever this tab gets focus, since the student
 * closes the run's window in another window and comes back here. Null with
 * no extension, no window, or before the first answer (and on the server).
 * It goes back to null only when the extension says the window is gone
 * (run/status, run/show), never on a failed answer.
 */
let runnerJob: string | null = null;
let watching = false;
const listeners = new Set<() => void>();

function setRunnerJob(jobId: string | null) {
  if (jobId === runnerJob) return;
  runnerJob = jobId;
  for (const listener of listeners) listener();
}

async function refreshRunnerJob() {
  const r = (await sendToExtension({ type: "run/status" })) as
    { ok: true; jobId: string | null } | { ok: false } | undefined;
  // Only a real answer changes it. A failed one (an extension that predates
  // run/status, a worker that errored) once turned Working in Browser back
  // to Queued each time the student came back from the run's window.
  if (r?.ok) setRunnerJob(r.jobId);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!watching) {
    watching = true;
    void refreshRunnerJob();
    window.addEventListener("focus", refreshRunnerJob);
  }
  return () => {
    listeners.delete(listener);
  };
}

/** The job posting id open in the run's window, or null. */
export function useRunnerJob(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => runnerJob,
    () => null,
  );
}
