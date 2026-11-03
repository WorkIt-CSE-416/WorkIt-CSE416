// The per-job-system off switch (KAN-467): WorkIt's admins turn off a job
// system whose handler broke (backend routers/extension_config.py), and the
// extension fills none of it until it is on again, with no Chrome Web Store
// release. Remote config is data (a JSON list), which Manifest V3 allows;
// never code.
//
// The list is read from GET /extension/config at the worker's start and
// again once the copy kept in chrome.storage.local is 15 minutes old, at the
// next fill or panel that asks: a job system turned off stops filling within
// 15 minutes. A read that fails keeps the last copy; with no copy at all,
// every job system fills as before.

import { publicFetch } from "./api.js";
import { jobOf } from "./engine.js";

const KEY = "workit_remote_config";
export const REFRESH_MS = 15 * 60 * 1000;
/** The read under way, if any: its callers share it. */
let reading = null;

async function read() {
  try {
    const config = await publicFetch("/extension/config");
    if (!Array.isArray(config?.disabled_job_systems)) throw new Error("no disabled_job_systems");
    await chrome.storage.local.set({ [KEY]: { at: Date.now(), config } });
    return config;
  } catch (error) {
    console.warn("[config] WorkIt's config wasn't read; the last copy holds:", error.message);
    return null;
  }
}

/** The remote config: the kept copy under 15 minutes old, else a fresh read, else the last copy, else null. */
export async function remoteConfig() {
  const kept = (await chrome.storage.local.get(KEY))[KEY];
  if (kept && Date.now() - kept.at < REFRESH_MS) return kept.config;
  reading ??= read().finally(() => (reading = null));
  return (await reading) ?? kept?.config ?? null;
}

/**
 * The name of the job system at `url` ("Workday") when WorkIt turned it
 * off, else null (a job system that is on, or a page of none). Onboarding's
 * practice forms are WorkIt's own, though shaped as Lever's: never off.
 * @param {string} url
 */
export async function turnedOff(url) {
  const job = jobOf(url);
  const site = job?.practice ? null : job?.site;
  if (!site) return null;
  const off = (await remoteConfig())?.disabled_job_systems ?? [];
  return off.find((system) => system.job_system === site)?.name ?? null;
}
