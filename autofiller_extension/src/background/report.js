// Report a problem (KAN-403; content/report.js draws the card): what a report
// names about the page, and the one place it is sent (POST /fill-reports).
//
// The background, not the page, says which job system and link a report is
// for, and sends only the allowed parts the card showed: a page's script can
// put nothing else in it. No value, reason or page text is ever a part.

import { sendFillReport } from "./api.js";
import { jobOf } from "./engine.js";

// The Fill engine this extension ships (the fill-engine submodule's pin, as
// `git -C fill-engine describe --tags` names it). Change it when the pin
// moves: test/report.extension.spec.ts fails until you do.
export const ENGINE_VERSION = "v0.3.2-116-g3fb95d0";

const FIELD_PARTS = ["kind", "label_shape", "error"];
const NOTE_MAX = 1000;

/** The posting's public link: the page's address without its query or fragment, which can carry the student's ids. */
function postingUrl(url) {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
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
