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

/**
 * Sends one message to the extension and resolves to its answer, or to
 * undefined when there is no extension: `chrome.runtime` not existing, or
 * no extension at this id, are both just "no extension here", not errors a
 * caller needs to handle specially. Never throws.
 */
function sendToExtension(message: { type: string; jobId?: string }): Promise<unknown> {
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

/* The extension talks to this page through manifest.json's
 * `externally_connectable`, the one, deliberately narrow channel a web page
 * gets: batch apply's three messages below (start or top up the batch,
 * which jobs its tabs show, switch to one of them;
 * autofiller_extension/src/background/batch.js). Never the profile itself;
 * see autofiller_extension/src/background/background.js's own comment on
 * why that line is drawn where it is. */

/** Whether `run/open` opened new tabs (started) or found the batch's
 *  window already full (kept: nothing reloaded or filled again). */
export type FillStart = { fill: "started" | "kept" };

/** What the extension's batch did with `run/open`: `jobIds` are the jobs
 *  its tabs show, `jobId` the first. */
export type OpenApplicationResult =
  | ({ opened: true; jobId: string; jobIds: string[]; url: string } & FillStart)
  | { opened: false; reason: "not_installed" | "queue_empty" | "signed_out" }
  | { opened: false; reason: "error"; error: string };

/**
 * Starts batch apply (KAN-370), or tops up the batch running: the extension
 * opens the queued applications in background tabs in this window, at most
 * five filling at once, and sorts each into its "Ready" or "Needs you" tab
 * group (autofiller_extension/src/background/batch.js). The message carries
 * no URL: the extension reads the queue from the API itself. Tabs already
 * open are left as they are. Resolves once the tabs have opened, or with
 * why nothing opened; never throws. No answer means no extension, or one
 * turned off. Updates `useBrowserJobs`.
 */
export async function openNextApplication(): Promise<OpenApplicationResult> {
  const r = (await sendToExtension({ type: "run/open" })) as
    | ({ ok: true } & Exclude<OpenApplicationResult, { reason: "not_installed" | "error" }>)
    | { ok: false; error: string }
    | undefined;
  if (r === undefined) return { opened: false, reason: "not_installed" };
  if (!r.ok) return { opened: false, reason: "error", error: r.error };
  setBrowserJobs(r.opened ? r.jobIds : []);
  if (!r.opened) return { opened: false, reason: r.reason };
  const { jobId, jobIds, url, fill } = r;
  return { opened: true, jobId, jobIds, url, fill };
}

/** Switches to the batch's tab showing `jobId`. False when it was closed
 *  (and `useBrowserJobs` asks again) or the extension failed to answer. */
export async function showRunTab(jobId: string): Promise<boolean> {
  const r = (await sendToExtension({ type: "run/show", jobId })) as
    { ok: true; shown: boolean } | { ok: false } | undefined;
  if (!r?.ok) return false;
  if (!r.shown) void refreshBrowserJobs();
  return r.shown;
}

/**
 * WHICH JOB POSTINGS THE BATCH'S TABS SHOW, shared by every caller on the
 * page: each job card's Auto Apply and Live Activity read one value, so the
 * extension is asked once, not once per card. Asked on the first
 * subscriber and again whenever this tab gets focus, since the student
 * closes batch tabs and comes back here. Empty with no extension, no batch,
 * or before the first answer (and on the server). It changes only on the
 * extension's answer (run/open, run/status), never on a failed one.
 */
const NONE: ReadonlySet<string> = new Set();
let browserJobs: ReadonlySet<string> = NONE;
let watching = false;
const listeners = new Set<() => void>();

function setBrowserJobs(jobIds: string[]) {
  if (jobIds.length === browserJobs.size && jobIds.every((id) => browserJobs.has(id))) return;
  browserJobs = new Set(jobIds);
  for (const listener of listeners) listener();
}

async function refreshBrowserJobs() {
  const r = (await sendToExtension({ type: "run/status" })) as
    { ok: true; jobIds?: string[] } | { ok: false } | undefined;
  // Only a real answer changes it. A failed one (an extension that predates
  // run/status, a worker that errored) once turned Working in Browser back
  // to Queued each time the student came back from the run's tab.
  if (r?.ok) setBrowserJobs(r.jobIds ?? []);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!watching) {
    watching = true;
    void refreshBrowserJobs();
    window.addEventListener("focus", refreshBrowserJobs);
  }
  return () => {
    listeners.delete(listener);
  };
}

/** The job posting ids open in the batch's tabs. */
export function useBrowserJobs(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => browserJobs,
    () => NONE,
  );
}
