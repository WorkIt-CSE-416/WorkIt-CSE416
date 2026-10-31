/**
 * The uninstall survey's one question (KAN-471) and what an answer sends to
 * `POST /uninstall-answers`. The values are the API's
 * (backend/app/schemas/uninstall_answers.py and the table's CHECK): change
 * them together. Imports nothing, so its test runs under `node --test`.
 */

export const REASONS = [
  { value: "bad_fills", label: "It Filled My Forms Wrong" },
  { value: "missing_sites", label: "It Doesn't Work on the Sites I Use" },
  { value: "found_job", label: "I Found a Job, or I'm Done Applying" },
  { value: "other_tool", label: "I Use Another Tool" },
  { value: "privacy", label: "I Was Worried About My Data" },
  { value: "other", label: "Something Else" },
] as const;

export type Reason = (typeof REASONS)[number]["value"];

/** The API's limit on the student's own line. */
export const DETAIL_MAX = 500;

export type AnswerBody = { reason: Reason; detail?: string; version?: string };

/** The form's answer as the API takes it; null with no reason the page offers. */
export function answerBody(form: FormData): AnswerBody | null {
  const reason = REASONS.find((r) => r.value === form.get("reason"))?.value;
  if (!reason) return null;
  const body: AnswerBody = { reason };
  const detail = String(form.get("detail") ?? "")
    .trim()
    .slice(0, DETAIL_MAX);
  if (detail) body.detail = detail;
  // manifest.json's version, from the extension's uninstall link (?v=).
  const version = String(form.get("version") ?? "");
  if (/^\d{1,5}(\.\d{1,5}){0,3}$/.test(version)) body.version = version;
  return body;
}
