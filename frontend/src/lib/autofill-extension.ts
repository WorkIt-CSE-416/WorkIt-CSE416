"use client";

import { useSyncExternalStore } from "react";

/**
 * The WorkIt Chrome extension's id, which autofiller_extension/manifest.json's
 * `key` (a public key, safe to check in) decides for the dev build and the
 * Store item alike. Not edited by hand: after changing that key, run
 * `node autofiller_extension/store/extension-id.mjs --write`
 * (autofiller_extension/test/extension-id.spec.ts fails until this matches).
 */
const EXTENSION_ID = "cpklhdkoafegnndlafmiceehfloodjgi";

/**
 * Sends one message to the extension and resolves to its answer, or to
 * undefined when there is no extension: `chrome.runtime` not existing, or
 * no extension at this id, are both just "no extension here", not errors a
 * caller needs to handle specially. Never throws.
 */
function sendToExtension(message: {
  type: string;
  jobId?: string;
  urls?: string[];
}): Promise<unknown> {
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
 * autofiller_extension/src/background/batch.js), onboarding's two for the
 * practice batch, Settings' `workday/signup-open` (opens the extension's
 * Workday Sign-Up page; its password never crosses), and `ping`. Never the profile itself;
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
 *
 * `picked`: the jobs the student picked in Up Next. They open first, and a
 * batch started from them opens nothing else (batch.js, "PICKED JOBS GO
 * FIRST"). Without them the whole queue opens.
 */
export async function openNextApplication(picked?: string[]): Promise<OpenApplicationResult> {
  const r = (await sendToExtension({
    type: "run/open",
    ...(picked?.length ? { jobIds: picked } : {}),
  })) as
    | ({ ok: true } & Exclude<OpenApplicationResult, { reason: "not_installed" | "error" }>)
    | { ok: false; error: string }
    | undefined;
  if (r === undefined) return { opened: false, reason: "not_installed" };
  if (!r.ok) return { opened: false, reason: "error", error: r.error };
  // The ids at once, then each tab's state: the new tabs read Filling until the extension says more.
  setBrowserJobs(r.opened ? r.jobIds.map((jobId) => ({ jobId, state: "filling" as const })) : []);
  if (r.opened) void refreshBrowserJobs();
  if (!r.opened) return { opened: false, reason: r.reason };
  const { jobId, jobIds, url, fill } = r;
  return { opened: true, jobId, jobIds, url, fill };
}

/** Closes the batch's tab showing `jobId` (Up Next's Remove on a row open
 *  in a tab). The application keeps its stage. False when there was
 *  no such tab or the extension failed to answer. */
export async function closeRunTab(jobId: string): Promise<boolean> {
  const r = (await sendToExtension({ type: "run/close", jobId })) as
    { ok: true; closed: boolean } | { ok: false } | undefined;
  void refreshBrowserJobs();
  return Boolean(r?.ok && r.closed);
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

/** Where one batch tab's form is (autofiller_extension/src/background/
 *  batch-store.js, `TabState`): still filling, every field answered, fields
 *  waiting on the student, a fill that went wrong, or sent. */
export type BatchTabState = "filling" | "ready" | "needs_you" | "failed" | "applied";

/**
 * WHICH JOB POSTINGS THE BATCH'S TABS SHOW, AND HOW EACH TAB'S FORM STANDS,
 * shared by every caller on the page: each job card's Auto Apply and Up
 * Next read one value, so the extension is asked once, not once per card.
 * Asked on the first subscriber and again whenever this tab gets focus,
 * since the student closes batch tabs and comes back here. While Up Next
 * shows (`useBrowserTabs`), also every few seconds while this tab is
 * visible, so a row turns from Filling to Ready to Submit on its own. Empty
 * with no extension, no batch, or before the first answer (and on the
 * server). It changes only on the extension's answer (run/open,
 * run/status), never on a failed one.
 */
const NO_TABS: ReadonlyMap<string, BatchTabState> = new Map();
const NONE: ReadonlySet<string> = new Set();
let browserTabs: ReadonlyMap<string, BatchTabState> = NO_TABS;
let browserJobs: ReadonlySet<string> = NONE;
let watching = false;
const listeners = new Set<() => void>();
/** How often Up Next asks while it shows. */
const LIVE_EVERY_MS = 4000;
let live = 0;
let liveTimer: ReturnType<typeof setInterval> | null = null;

function setBrowserJobs(jobs: { jobId: string; state: BatchTabState }[]) {
  if (
    jobs.length === browserTabs.size &&
    jobs.every((job) => browserTabs.get(job.jobId) === job.state)
  )
    return;
  browserTabs = new Map(jobs.map((job) => [job.jobId, job.state]));
  browserJobs = new Set(browserTabs.keys());
  for (const listener of listeners) listener();
}

async function refreshBrowserJobs() {
  const r = (await sendToExtension({ type: "run/status" })) as
    | { ok: true; jobIds?: string[]; jobs?: { jobId: string; state: BatchTabState }[] }
    | { ok: false }
    | undefined;
  // Only a real answer changes it. A failed one (an extension that predates
  // run/status, a worker that errored) once turned Working in Browser back
  // to Queued each time the student came back from the run's tab. An
  // extension that answers ids alone counts each tab as filling.
  if (r?.ok) {
    setBrowserJobs(
      r.jobs ?? (r.jobIds ?? []).map((jobId) => ({ jobId, state: "filling" as const })),
    );
  }
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

/** Like `subscribe`, and asks again every few seconds while this tab shows. */
function subscribeLive(listener: () => void) {
  const stop = subscribe(listener);
  live += 1;
  liveTimer ??= setInterval(() => {
    if (document.visibilityState === "visible") void refreshBrowserJobs();
  }, LIVE_EVERY_MS);
  return () => {
    stop();
    live -= 1;
    if (live === 0 && liveTimer) {
      clearInterval(liveTimer);
      liveTimer = null;
    }
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

/** Each batch tab's state by job posting id, kept current while it is used (Up Next). */
export function useBrowserTabs(): ReadonlyMap<string, BatchTabState> {
  return useSyncExternalStore(
    subscribeLive,
    () => browserTabs,
    () => NO_TABS,
  );
}

/**
 * Opens the extension's Workday Sign-Up page (KAN-369), where the student
 * sets one email and password for every company's Workday. The password is
 * typed there and kept in the browser only, so this page never sees it.
 * False when there is no extension to open it.
 */
export async function openWorkdaySignup(): Promise<boolean> {
  const r = (await sendToExtension({ type: "workday/signup-open" })) as { ok: boolean } | undefined;
  return Boolean(r?.ok);
}

/** What onboarding's install step reads (KAN-378): whether the extension is
 *  here, whether it sees the student's session, and whether it is pinned to
 *  the toolbar (null where Chrome can't say). */
export type ExtensionState =
  { installed: false } | { installed: true; signedIn: boolean; pinned: boolean | null };

/** Asks the extension whether it is installed, signed in and pinned. Never throws. */
export async function extensionState(): Promise<ExtensionState> {
  const r = (await sendToExtension({ type: "ping" })) as
    { ok: true; installed: true; signedIn: boolean; pinned?: boolean | null } | undefined;
  if (!r?.ok) return { installed: false };
  return { installed: true, signedIn: r.signedIn, pinned: r.pinned ?? null };
}

/** Where one practice job is (autofiller_extension/src/background/batch.js,
 *  `practiceStatus`). */
export type PracticeState = "waiting" | "filling" | "ready" | "needs_you" | "submitted" | "closed";

export type PracticeStart =
  | { opened: true; jobIds: string[] }
  | { opened: false; reason: "not_installed" | "signed_out" | "batch_running" }
  | { opened: false; reason: "error"; error: string };

/**
 * Starts onboarding's practice batch (KAN-378): the extension opens `urls`,
 * WorkIt's own practice forms (lib/practice-form), as a batch's background
 * tabs and sorts them into Ready and Needs you. It takes only practice forms
 * on this page's own site. Never throws.
 */
export async function startPractice(urls: string[]): Promise<PracticeStart> {
  const r = (await sendToExtension({ type: "practice/open", urls })) as
    | ({ ok: true } & (
        | { opened: true; jobIds: string[] }
        | { opened: false; reason: "signed_out" | "batch_running" }
      ))
    | { ok: false; error: string }
    | undefined;
  if (r === undefined) return { opened: false, reason: "not_installed" };
  if (!r.ok) return { opened: false, reason: "error", error: r.error };
  return r.opened ? { opened: true, jobIds: r.jobIds } : { opened: false, reason: r.reason };
}

/** Each practice job's state, by job id; empty with no practice batch or no extension. */
export async function practiceStatus(): Promise<Record<string, PracticeState>> {
  const r = (await sendToExtension({ type: "practice/status" })) as
    { ok: true; jobs: { jobId: string; state: PracticeState }[] } | { ok: false } | undefined;
  if (!r?.ok) return {};
  return Object.fromEntries(r.jobs.map((j) => [j.jobId, j.state]));
}
