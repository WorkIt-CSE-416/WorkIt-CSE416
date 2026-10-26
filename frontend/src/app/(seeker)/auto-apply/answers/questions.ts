import "server-only";

import { connection } from "next/server";

import { applicantCall, type Result } from "@/lib/applicant-call";

/**
 * The questions the student's open batch tabs need written and have no
 * answer for, by job posting (GET /applicants/{id}/written-questions,
 * backend/app/routers/pasted_answers.py, KAN-385). Server-only: the
 * Written Answers page and the Auto Apply page read it on the server.
 * Also the questions already answered, each with the company brief fact
 * its answer names (GET /applicants/{id}/written-answers, KAN-369).
 */

/** One question, as the extension sent it from the live form. */
export type WrittenQuestion = {
  /** The form field's name: what the answer is saved under and filled into. */
  name: string;
  label: string;
  required: boolean;
  /** The form's own limit in characters, or null. */
  max_length: number | null;
  /** A one-off choice (KAN-369): "choice" takes one of `options`, "choices" one or more. Null when written in words. */
  kind: "choice" | "choices" | null;
  /** The choice's options, as the form words them; null when written in words. */
  options: string[] | null;
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

/** The company brief fact an answer uses: its sentence and the page that states it. */
export type NamedFact = { fact: string; url: string };

/** A written question answered, with the brief fact its answer names, or null. */
export type AnsweredQuestion = {
  name: string;
  label: string;
  answer: string;
  /** The student's own words, not their Claude's. */
  own: boolean;
  named_fact: NamedFact | null;
  /** When it was last saved (ISO), by which the page marks the student's own answers New (./new-answers.ts). */
  answered_at: string | null;
};

/** One application's answered written questions, newest application first. */
export type PostingAnswers = {
  job_id: string;
  company: string | null;
  title: string | null;
  questions: AnsweredQuestion[];
};

export async function getAnsweredQuestions(): Promise<Result<PostingAnswers[]>> {
  await connection();
  return applicantCall<PostingAnswers[]>("/written-answers");
}
