// A batch tab's Plan reads (KAN-369): the job's questions, names and text
// come from its job system's public API, not the page, so they are asked as
// the tab opens (batch.js) and are there when its first Plan comes, instead
// of being asked only once the page has loaded and its fill has started.

import { readJobAhead } from "./engine.js";

/** The background's fetch of a job system's public API (the engine's `fetchText`). */
export async function fetchText(url, init) {
  const response = await fetch(url, init && { ...init, headers: { "Content-Type": "application/json" } });
  if (!response.ok) throw new Error(`${new URL(url).hostname} answered ${response.status}`);
  return response.text();
}

// Reads older than this are asked again: a tab that waited this long (a human check) plans afresh.
const FRESH_MS = 60_000;

/** The reads started for each tab still to plan, by tab id: `fetchText` answering each URL (and body) once. */
const ahead = new Map();

/**
 * Starts the job reads for a tab just opened on `url`, kept for its first
 * Plan (planReads). A read that fails is forgotten, so the Plan asks it again.
 * @param {number} tabId
 * @param {string} url
 */
export function readAhead(tabId, url) {
  for (const [id, kept] of ahead) if (Date.now() - kept.at >= FRESH_MS) ahead.delete(id);
  const asked = new Map();
  const fetchOnce = (url, init) => {
    const key = `${url}\n${init?.body ?? ""}`;
    if (!asked.has(key)) {
      const read = fetchText(url, init);
      asked.set(key, read);
      read.catch(() => asked.get(key) === read && asked.delete(key));
    }
    return asked.get(key);
  };
  if (readJobAhead(url, fetchOnce)) ahead.set(tabId, { fetchText: fetchOnce, at: Date.now() });
}

/**
 * The `fetchText` for a tab's Plan: its first takes the reads started as the
 * tab opened (once, while fresh); every later one (a Workday step, an
 * Eightfold follow-up) reads afresh.
 * @param {number} tabId
 */
export function planReads(tabId) {
  const kept = ahead.get(tabId);
  ahead.delete(tabId);
  return kept && Date.now() - kept.at < FRESH_MS ? kept.fetchText : fetchText;
}
