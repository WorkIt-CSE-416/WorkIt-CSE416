"use server";

import { applicantCall, encodeId, type Result } from "@/lib/applicant-call";

import type { RunStage } from "./actions";
import { RUN_STAGES, type Application } from "./applications";

/**
 * WorkIt Desktop's routes (KAN-323, auto-apply/desktop.md), as the Auto
 * Apply page uses them: Desktop's status, an application's review, Approve
 * & Submit and Skip, and the poll that keeps Live Activity current. Desktop
 * itself claims, fills and submits; the page only reads and decides. Every
 * export of a "use server" file is a public POST endpoint: these take a job
 * id at most, and the applicant is always the session's own. Types mirror
 * the contract's JSON shapes.
 */

/** Where an answer came from, so the seeker knows what to check: the
 *  profile, the answer bank, written for this job, or nothing to go on. */
export type AnswerSource = "profile" | "answer_bank" | "written" | "missing";

/** One question on the form and what Desktop filled in, in form order. */
export type ReviewAnswer = {
  question: string;
  answer: string;
  source: AnswerSource;
  /** Free text written for this job. */
  essay: boolean;
  /** The bank facts an essay's claims came from. */
  facts: string[];
};

/** What Desktop filled for one application, stopped before Submit. */
export type Review = {
  answers: ReviewAnswer[];
  resume: { name: string; sent_resume_id: string | null } | null;
  cover_letter: string | null;
  /** Why it needs a look: an unsupported claim, a missing fact, a read-back
   *  mismatch. */
  flags: string[];
  /** Desktop's one-line summary. */
  note: string | null;
  filled_at: string;
};

/** Share of the seeker's Claude plan used, in percent (0-100). */
export type DesktopUsage = { five_hour: number; weekly: number };

/** Whether WorkIt Desktop is running: `online` is a heartbeat in the last
 *  45 seconds. */
export type DesktopStatus = {
  online: boolean;
  last_seen: string | null;
  workers: number;
  busy: number;
  usage: DesktopUsage | null;
};

type StageAnswer = { stage: RunStage };

/** GET .../desktop. Any failure reads as offline at the caller: the
 *  extension is then the way to apply, as before Desktop. */
export async function getDesktopStatus(): Promise<Result<DesktopStatus>> {
  return applicantCall<DesktopStatus>("/desktop");
}

/** GET .../applications/{job_id}/review: 404 while none was filed. */
export async function getReview(jobId: string): Promise<Result<Review>> {
  return applicantCall<Review>(`/applications/${encodeId(jobId)}/review`);
}

/** Approve & Submit: POST .../approve with the edited answers (empty keeps
 *  the review's). Review moves to approved, and Desktop submits it. */
export async function approveApplication(
  jobId: string,
  answers: ReviewAnswer[],
): Promise<Result<StageAnswer>> {
  return applicantCall<StageAnswer>(`/applications/${encodeId(jobId)}/approve`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}

/** Skip: POST .../finish with outcome skipped. Nothing is submitted. */
export async function skipApplication(jobId: string): Promise<Result<StageAnswer>> {
  return applicantCall<StageAnswer>(`/applications/${encodeId(jobId)}/finish`, {
    method: "POST",
    body: JSON.stringify({ outcome: "skipped" }),
  });
}

/** Live Activity's poll: every run stage, unscored (a score can embed the
 *  bank, too slow every 3 seconds), newest first as the API answers. The
 *  page keeps the scores from its own scored read. */
export async function pollApplications(): Promise<Result<Application<RunStage>[]>> {
  const params = new URLSearchParams(RUN_STAGES.map((stage) => ["stage", stage]));
  return applicantCall<Application<RunStage>[]>(`/applications?${params}`);
}
