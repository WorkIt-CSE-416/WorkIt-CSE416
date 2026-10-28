"use server";

import { apiFetch, errorMessage } from "@/lib/auth";
import { encodeId, OFFLINE } from "@/lib/applicant-call";
import { getApplicantSession } from "@/lib/session";

/**
 * The Written Answers page's writes. Its save (KAN-385): an answer the student wrote
 * or pasted, saved to one question of one application
 * (PUT .../applications/{job_id}/written-answers). The API saves it through
 * the connector's own step, so it passes the same checks as an answer from
 * the student's Claude except copying from their own samples, and the open
 * batch tab fills it the same way. Its fact save (KAN-369): the student's
 * answer to a fact their Claude asked for, which joins their experience.
 * Its delete (KAN-369): one of the
 * student's own answers in Your Answers taken back
 * (DELETE .../applications/{job_id}/answers?name=). Every
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

export type FactResult = { saved: true; entry: string } | { saved: false; error: string };

/**
 * The student's answer to the fact their Claude asked for one question
 * (KAN-369, PUT .../applications/{job_id}/essay-facts): saved as a bullet of
 * the experience entry it is about, after which their Claude writes the
 * answer on its next run.
 */
export async function saveEssayFact(
  jobId: string,
  name: string,
  answer: string,
): Promise<FactResult> {
  let session;
  try {
    session = await getApplicantSession();
  } catch {
    return { saved: false, error: SIGNED_OUT };
  }
  try {
    const res = await apiFetch(
      `/applicants/${encodeId(session.id)}/applications/${encodeId(jobId)}/essay-facts`,
      { method: "PUT", body: JSON.stringify({ name, answer }) },
      session.token,
    );
    const body = await res.json().catch(() => null);
    if (res.ok) return { saved: true, entry: (body as { entry: string }).entry };
    return { saved: false, error: errorMessage(body) };
  } catch {
    return { saved: false, error: OFFLINE };
  }
}

/** `error` says why the delete failed; null when it went through. */
export type DeleteResult = { error: string | null };

/**
 * Takes back the saved answer `name` on one application, whoever wrote it
 * (`own_only=false`): the student's own, one pasted with Check and Save, or
 * their Claude's, so later forms no longer fill it. Not own limits reuse,
 * not removal. The API answers 204 also when nothing was saved. The name is
 * a query parameter: form field names can hold slashes and brackets.
 */
export async function deleteAnswer(jobId: string, name: string): Promise<DeleteResult> {
  let session;
  try {
    session = await getApplicantSession();
  } catch {
    return { error: SIGNED_OUT };
  }
  try {
    const res = await apiFetch(
      `/applicants/${encodeId(session.id)}/applications/${encodeId(jobId)}/answers?name=${encodeURIComponent(name)}&own_only=false`,
      { method: "DELETE" },
      session.token,
    );
    if (res.ok) return { error: null };
    return { error: errorMessage(await res.json().catch(() => null)) };
  } catch {
    return { error: OFFLINE };
  }
}
