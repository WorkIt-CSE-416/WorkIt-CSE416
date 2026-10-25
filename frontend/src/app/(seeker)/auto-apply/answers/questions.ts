import "server-only";

import { connection } from "next/server";

import { applicantCall, type Result } from "@/lib/applicant-call";

/**
 * The questions the student's open batch tabs need written and have no
 * answer for, by job posting (GET /applicants/{id}/written-questions,
 * backend/app/routers/pasted_answers.py, KAN-385). Server-only: the
 * Written Answers page and the Auto Apply page read it on the server.
 */

/** One question, as the extension sent it from the live form. */
export type WrittenQuestion = {
  /** The form field's name: what the answer is saved under and filled into. */
  name: string;
  label: string;
  required: boolean;
  /** The form's own limit in characters, or null. */
  max_length: number | null;
};

/** One open application's unanswered questions, oldest application first. */
export type PostingQuestions = {
  job_id: string;
  company: string | null;
  title: string | null;
  questions: WrittenQuestion[];
};

export async function getWrittenQuestions(): Promise<Result<PostingQuestions[]>> {
  // Request time, not build time, as every live fetch (frontend/CLAUDE.md).
  await connection();
  return applicantCall<PostingQuestions[]>("/written-questions");
}
