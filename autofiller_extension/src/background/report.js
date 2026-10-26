// Report a problem (KAN-403; content/report.js draws the card): what a report
// names about the page, and the one place it is sent (POST /fill-reports).
//
// The background, not the page, says which job system and link a report is
// for, and sends only the allowed parts the card showed: a page's script can
// put nothing else in it. No value, reason or page text is ever a part.

import { sendFillReport } from "./api.js";
import { ENGINE_VERSION, jobOf } from "./engine.js";
import "../shared/report-parts.js";

const FIELD_PARTS = ["kind", "label_shape", "error"];
const { NOTE_MAX } = globalThis.WIA.reportParts;

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

/** Sends the student's report for the page at `url`: the page's parts, each field's allowed parts, and the note. */
export async function sendReport(url, report) {
  const fields = (Array.isArray(report?.fields) ? report.fields : []).map((field) => Object.fromEntries(FIELD_PARTS.map((part) => [part, String(field?.[part] ?? "")])));
  const note = typeof report?.note === "string" && report.note.trim() ? report.note.trim().slice(0, NOTE_MAX) : null;
  return sendFillReport({ ...reportOf(url), fields, note });
}
