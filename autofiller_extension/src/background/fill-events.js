// Fill numbers (KAN-476, decided in KAN-454): after every fill, single or
// batch, one event goes to POST /fill-events, so the team sees how often each
// job system fills (the website's /admin/fill-health). The page's fill
// (content/fill-event.js) counts its fields; this side adds what the page
// can't be trusted to say (the job system, the versions, whether the tab is
// a batch's) and keeps only those parts: never a value, an answer or the
// page's link. On for everyone; the panel's settings have the opt-out
// (Send fill numbers). Kept 90 days by the backend's daily purge.

import { sendFillEvent } from "./api.js";
import { ENGINE_VERSION, jobOf } from "./engine.js";
import "../shared/report-parts.js";

const { ERRORS } = globalThis.WIA.reportParts;
// Whether fill numbers are sent (true unless the student turned them off).
const ON_KEY = "fill_numbers";
const COUNTS = ["fields", "filled", "guessed", "needs_you", "failed"];

/** Whether the student lets the extension send fill numbers. */
export async function fillNumbersOn() {
  return (await chrome.storage.local.get(ON_KEY))[ON_KEY] !== false;
}

/** Keeps the student's choice. */
export async function setFillNumbers(on) {
  await chrome.storage.local.set({ [ON_KEY]: Boolean(on) });
  return { fillNumbers: Boolean(on) };
}

const count = (value) => Math.max(0, Math.min(10_000, Math.round(Number(value) || 0)));

/**
 * The event for one fill: `counts` as the page's fill.js gave them, each part
 * forced to its shape, with `site` (the page's Plan's job system) checked
 * against the engine's reading of the frame. Null for a fill with nothing
 * in it (no field, no error), which is no fill at all (a closed job's page).
 */
export function eventOf(url, counts = {}, batch = false) {
  const site = /^[a-z][a-z0-9_-]{0,23}$/.test(counts.site ?? "") ? counts.site : jobOf(url)?.site;
  if (!site) return null;
  const errors = {};
  for (const [name, n] of Object.entries(counts.errors ?? {})) if (ERRORS.includes(name) && count(n)) errors[name] = count(n);
  const event = {
    job_system: site,
    engine_version: ENGINE_VERSION,
    extension_version: chrome.runtime.getManifest().version,
    mode: batch ? "batch" : "single",
    ...Object.fromEntries(COUNTS.map((part) => [part, count(counts[part])])),
    errors,
    duration_ms: Math.min(3_600_000, count(counts.duration_ms) || 1),
  };
  if (!event.fields && !Object.keys(errors).length) return null;
  return event;
}

/** Sends one fill's event, unless the student turned fill numbers off. Never throws: a lost event is only a lost number. */
export async function sendFill(url, counts, batch) {
  try {
    if (!(await fillNumbersOn())) return { sent: false };
    const event = eventOf(url, counts, batch);
    if (!event) return { sent: false };
    await sendFillEvent(event);
    return { sent: true };
  } catch (error) {
    console.warn("[fill] the fill's numbers weren't sent:", error.message);
    return { sent: false };
  }
}
