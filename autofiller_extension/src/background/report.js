// Report a problem (KAN-403) and fix reports (KAN-369; content/report.js
// draws the card): what a report names about the page, the report the card
// previews, and the one place it is sent (POST /fill-reports).
//
// The background, not the page, says which job system, link, versions and
// browser a report is for. The card hands it a draft (each field's parts, the
// fill's timeline, the form's HTML, its values already out); the background
// keeps only the allowed parts (report-parts.js FIELD_PARTS, TIMELINE_PARTS),
// takes the profile's values out once more (the student's name, email, phone,
// links, address: the card doesn't hold the profile), and keeps the result in
// chrome.storage.session for that tab and frame. The card shows exactly that;
// Send sends that, with the student's marks and note (finalize), nothing
// the page could add after the preview.

import { getAutofillProfile, sendFillReport } from "./api.js";
import { ENGINE_VERSION, jobOf } from "./engine.js";
import "../shared/report-parts.js";

const { ERRORS, NOTE_MAX, HTML_MAX, FIELD_PARTS, TIMELINE_PARTS, TRIGGERS, redactor, finalize } = globalThis.WIA.reportParts;
const KEPT_FIELD_PARTS = ["kind", "label_shape", "error"];

// The query parts that name a posting, by job system: an embedded Greenhouse form's for and token, a
// careers page's gh_jid, and the posting ids other job systems put in the query. The backend's fill-report
// schema accepts these only, each a plain id.
const POSTING_PARAMS = ["for", "token", "gh_jid", "jobId", "job_id", "jobid", "jobReqId", "career_job_req_id"];
const PLAIN_ID = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * The posting's public link: the page's address with only the query parts in
 * POSTING_PARAMS (a plain id each), without the rest of the query, the
 * fragment or a user:password, which can carry the student's ids.
 */
function postingUrl(url) {
  const parsed = new URL(url);
  const kept = new URLSearchParams();
  for (const [name, value] of parsed.searchParams) if (POSTING_PARAMS.includes(name) && PLAIN_ID.test(value) && !kept.has(name)) kept.set(name, value);
  const query = kept.toString();
  return `${parsed.origin}${parsed.pathname}${query ? `?${query}` : ""}`;
}

/** What a report says about this page before any field: its job system, posting link and engine. */
export function reportOf(url) {
  return { job_system: jobOf(url)?.site ?? "unsupported", posting_url: postingUrl(url), engine_version: ENGINE_VERSION };
}

/** "Chrome 141": the browser's brand and major version, nothing that tells one computer from another. */
function browserName() {
  const brand = globalThis.navigator?.userAgentData?.brands?.find((b) => /Chrome|Chromium|Edge|Brave|Opera/.test(b.brand));
  if (brand) return `${brand.brand.replace(/^Google /, "")} ${brand.version}`.slice(0, 120);
  const match = /(Chrome|Chromium)\/(\d+)/.exec(globalThis.navigator?.userAgent ?? "");
  return match ? `${match[1]} ${match[2]}` : "unknown";
}

/** The engine's jobOf of the page: its job system, whether it is the form, and the posting's ids (plain ids only). */
function recognitionOf(url) {
  const job = jobOf(url);
  if (!job) return null;
  const ids = {};
  for (const [key, value] of Object.entries(job)) {
    if (["site", "form", "onForm"].includes(key) || typeof value !== "string") continue;
    if (/^[A-Za-z_]{1,24}$/.test(key) && PLAIN_ID.test(value) && Object.keys(ids).length < 8) ids[key] = value;
  }
  return { site: job.site, on_form: Boolean(job.onForm), ids };
}

/** Where, with what and when: the backend's ReportContext. */
function contextOf(url, frame) {
  return {
    extension_version: chrome.runtime.getManifest().version,
    browser: browserName(),
    captured_at: new Date().toISOString(),
    recognition: recognitionOf(url),
    page_url: postingUrl(url),
    frame: frame === "iframe" ? "iframe" : "top",
  };
}

/** The profile's personal values, for the redactor: names, contact, links, address, file names. */
async function profileWords() {
  let profile;
  try {
    profile = await getAutofillProfile();
  } catch {
    return [];
  }
  const answers = profile?.answers ?? {};
  return [
    profile.full_name, profile.first_name, profile.middle_name, profile.last_name, profile.email, profile.phone_number, profile.headline, profile.location,
    profile.linkedin_url, profile.portfolio_url, profile.github_url, profile.other_url, answers.address_line1, answers.postal_code,
    profile.resume?.filename, profile.transcript?.filename,
  ].filter((value) => typeof value === "string" && value.trim());
}

const pick = (object, parts) => Object.fromEntries(parts.filter((part) => object?.[part] !== undefined && object[part] !== null).map((part) => [part, object[part]]));
const text = (value, max, redact) => (typeof value === "string" ? redact(value).slice(0, max) : undefined);

/** A field as a report may carry it: the allowed parts only, each of its type, its texts redacted once more. */
function fieldOf(draft, redact) {
  const field = pick(draft, FIELD_PARTS);
  for (const part of ["kind", "label_shape", "error", "name", "source", "planned", "status", "readback", "shows", "selector"]) if (field[part] !== undefined) field[part] = String(field[part]);
  field.kind = field.kind ?? "unknown";
  field.label_shape = field.label_shape ?? "";
  if (field.error !== undefined && !ERRORS.includes(field.error)) field.error = "Error";
  if (field.label !== undefined) field.label = text(field.label, 300, redact);
  if (field.reason !== undefined) field.reason = text(field.reason, 500, redact);
  if (field.selector !== undefined) field.selector = text(field.selector, 500, redact);
  if (field.options !== undefined) field.options = Array.isArray(field.options) ? field.options.slice(0, 100).map((o) => text(String(o), 200, redact)) : undefined;
  for (const part of ["required", "visible", "edited"]) if (field[part] !== undefined) field[part] = Boolean(field[part]);
  if (!field.edited) delete field.edited;
  return field;
}

function stepOf(draft, redact) {
  const step = pick(draft, TIMELINE_PARTS);
  step.t = Math.max(0, Math.min(86_400_000, Math.round(Number(step.t) || 0)));
  step.kind = String(step.kind ?? "note");
  if (step.field !== undefined) step.field = String(step.field).slice(0, 200);
  if (step.status !== undefined) step.status = String(step.status);
  if (step.message !== undefined) step.message = text(String(step.message), 500, redact);
  if (step.stack !== undefined) step.stack = text(String(step.stack), 4000, redact);
  return step;
}

const previewKey = (sender) => `report:${sender.tab?.id ?? "none"}:${sender.frameId ?? 0}`;

/**
 * The report the card previews for `draft` (content/report.js's collect):
 * the page's parts, its context, each field's allowed parts, the timeline
 * and the form's HTML, the profile's values out. Kept for Send.
 */
export async function previewReport(sender, draft = {}) {
  const url = sender.url ?? "";
  const redact = redactor(await profileWords());
  const report = {
    ...reportOf(url),
    trigger: TRIGGERS.includes(draft.trigger) ? draft.trigger : "menu",
    context: contextOf(url, draft.frame),
    fields: (Array.isArray(draft.fields) ? draft.fields : []).slice(0, 300).map((field) => fieldOf(field, redact)),
    timeline: (Array.isArray(draft.timeline) ? draft.timeline : []).slice(-400).map((step) => stepOf(step, redact)),
    ...(typeof draft.html === "string" && draft.html ? { html: redact(draft.html).slice(0, HTML_MAX) } : {}),
  };
  if (typeof draft.step === "string" && draft.step) report.context.step = redact(draft.step).slice(0, 120);
  await chrome.storage.session.set({ [previewKey(sender)]: report });
  return { report };
}

/** Sends the report this tab's card previewed, with the fields the student marked wrong and their note; the preview is then gone. */
export async function sendPreviewed(sender, { marked = [], note = null } = {}) {
  const key = previewKey(sender);
  const { [key]: report } = await chrome.storage.session.get(key);
  if (!report) throw new Error("Open the report again: its preview is gone.");
  const names = Array.isArray(marked) ? marked.filter((name) => typeof name === "string") : [];
  await sendFillReport(finalize(report, { marked: names, note: typeof note === "string" ? note.slice(0, NOTE_MAX) : null }));
  await chrome.storage.session.remove(key);
  return {};
}

/** Sends the popup's report for the page at `url`: the page's parts, its context, each field's KAN-403 parts, and the note. */
export async function sendReport(url, report) {
  const fields = (Array.isArray(report?.fields) ? report.fields : []).map((field) => Object.fromEntries(KEPT_FIELD_PARTS.map((part) => [part, String(field?.[part] ?? "")])));
  const note = typeof report?.note === "string" && report.note.trim() ? report.note.trim().slice(0, NOTE_MAX) : null;
  return sendFillReport({ ...reportOf(url), trigger: "menu", context: contextOf(url, "top"), fields, note });
}
