"use server";

import { apiFetch, errorMessage } from "@/lib/auth";
import { encodeId, OFFLINE } from "@/lib/applicant-call";
import { getApplicantSession } from "@/lib/session";

/**
 * The Written Answers page's one write (KAN-385): an answer the student wrote
 * or pasted, saved to one question of one application
 * (PUT .../applications/{job_id}/written-answers). The API saves it through
 * the connector's own step, so it passes the same checks as an answer from
 * the student's Claude except copying from their own samples, and the open
 * batch tab fills it the same way. Every
 * export of a "use server" file is a public POST endpoint: the applicant is
 * always the session's own.
 */

export type SaveResult =
  | { saved: true; left: number }
  /** `reasons`: what WorkIt's checks found, each a sentence; empty when the
   *  save failed for another reason, which `error` says. */
  | { saved: false; reasons: string[]; error: string };

const SIGNED_OUT = "You're signed out. Sign in again to continue.";

export async function saveWrittenAnswer(
  jobId: string,
  name: string,
  answer: string,
): Promise<SaveResult> {
  let session;
  try {
    session = await getApplicantSession();
  } catch {
    return { saved: false, reasons: [], error: SIGNED_OUT };
  }
  try {
    const res = await apiFetch(
      `/applicants/${encodeId(session.id)}/applications/${encodeId(jobId)}/written-answers`,
      { method: "PUT", body: JSON.stringify({ answers: [{ name, answer }] }) },
      session.token,
    );
    const body = await res.json().catch(() => null);
    if (res.ok) return { saved: true, left: (body as { left: number }).left };
    const reasons = (body as { detail?: { reasons?: Record<string, string[]> } } | null)?.detail
      ?.reasons;
    return { saved: false, reasons: reasons?.[name] ?? [], error: errorMessage(body) };
  } catch {
    return { saved: false, reasons: [], error: OFFLINE };
  }
}
