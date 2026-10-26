// The WorkIt API (backend/app/routers) as the extension calls it, for the
// loaded extension (loaded-extension.ts): one signed-in test student (dummy
// data, extension.ts's STUDENT) and an auto-apply queue held in memory, with
// the stage rules of backend/app/auto_apply/pipeline.py.
import { STUDENT } from "./extension";
import type { Handler } from "./loaded-extension";

export type Stage = "queued" | "needs_you" | "skipped" | "applied";
/** `form_url`: the employer's form the API names (KAN-376); its apply_url when left out, as for a hiring system's posting. */
export type Posting = { id: string; apply_url: string; form_url?: string | null; title?: string; company?: string };
/** A question a batch tab's form needs written, and the answer the student's Claude saved (KAN-377). */
export type Written = {
  name: string; label: string; required: boolean; max_length: number | null; answer: string | null;
  // The pre-submit review (backend/app/auto_apply/review.py): whether it read this answer, and why it flagged it.
  reviewed?: boolean; flag?: string | null; flag_quote?: string | null; flag_hard?: boolean;
};
/** One flag save_review gives: its reason, or the reason with the sentence it means and whether it names the wrong company. */
export type Flag = string | { reason: string; quote?: string; hard?: boolean };

const RESUME_ID = "00000000-0000-0000-0000-0000000000r1";

export class FakeApi {
  /** Each queued job's stage, in queue order. */
  readonly stages = new Map<string, Stage>();
  /** The resume each job's application names as sent (PUT .../resume), by job. */
  readonly sentResumes = new Map<string, Record<string, string>>();
  /** Every call, as "METHOD /path?query". */
  readonly calls: string[] = [];
  private postings = new Map<string, Posting>();
  /** Each job's questions that need writing, as the tab sent them, with the saved answers. */
  readonly written = new Map<string, Written[]>();
  /** The answer bank every job's form may reuse (GET .../answer-bank, KAN-379), by question wording. */
  readonly bank: Record<string, { answer: string; own: boolean }> = {};
  /** The student's answers the tabs saved (PUT .../answers, KAN-379), in order: `own` for their own words,
   * false for an edit of an answer WorkIt filled. */
  readonly own: { jobId: string; name: string; label: string; answer: string; own: boolean }[] = [];
  /** Set to refuse the next edits of a filled answer (not own) with these reasons, as WorkIt's checks do (422). */
  refuseEdits: string[] | null = null;
  /** The answers the student pasted in a waiting row's card (PUT .../written-answers, KAN-385's paste route), in order. */
  readonly pasted: { jobId: string; name: string; answer: string }[] = [];
  /** Set to refuse the next pastes with these reasons, as WorkIt's checks do (422, reasons by question). */
  refusePastes: string[] | null = null;
  /** In order: "next:<job>" when GET .../applications/next hands a job out (its tab opens), "questions:<job>" when its questions arrive. */
  readonly events: string[] = [];

  /** The connector's save (backend/app/connector/tools.py): the student's Claude answered one question. */
  saveAnswer(jobId: string, name: string, answer: string): void {
    const question = this.written.get(jobId)?.find((q) => q.name === name);
    if (!question) throw new Error(`Job ${jobId} has no question ${name}`);
    question.answer = answer;
    // A new answer is one the review hasn't read (review.py's snapshot).
    question.reviewed = false;
    question.flag = null;
  }

  /** The connector's save_review: the student's Claude re-read the job's answers and found `flags` wrong (by name). */
  saveReview(jobId: string, flags: Record<string, Flag>): void {
    for (const q of this.written.get(jobId) ?? []) {
      if (q.answer === null) continue;
      const flag = typeof flags[q.name] === "string" ? { reason: flags[q.name] as string } : (flags[q.name] as Exclude<Flag, string>);
      q.reviewed = true;
      q.flag = flag?.reason ?? null;
      q.flag_quote = flag?.quote ?? null;
      q.flag_hard = Boolean(flag?.hard);
    }
  }

  /** The tabs' flag cards' answers (POST .../review/keep|rewrite, review.py), in order. */
  readonly flagAnswers: { jobId: string; action: string; name: string }[] = [];

  /** The student's autofill answers (GET and PATCH .../autofill-answers), STUDENT's unless `profile` names others. */
  readonly answers: Record<string, string | null>;
  /** Every PATCH .../autofill-answers body, in order. */
  readonly answersSaved: Record<string, string | null>[] = [];

  /** The student's writing samples (GET .../writing-samples). */
  samples: { id: string; text: string }[] = [];

  /** Set to answer the profile with a server error, so a tab's fill can't plan. */
  profileDown = false;

  /** The student's transcript (GET .../documents, .../documents/transcript/bytes, KAN-369), or none. */
  transcript: { filename: string; base64: string } | null = null;

  /** Whether the student's Claude has signed in to WorkIt's connector (GET .../connector). */
  connectorAdded = false;

  /** `profile`: the student's profile fields that differ from STUDENT's. */
  constructor(private profile: Partial<Omit<typeof STUDENT, "answers">> & { answers?: Record<string, string | null> } = {}) {
    this.answers = { ...(profile.answers ?? STUDENT.answers) };
  }

  /** Queues the postings in this order, as Start Auto Apply or the job cards do. */
  queue(...postings: Posting[]): this {
    for (const posting of postings) {
      this.postings.set(posting.id, posting);
      this.stages.set(posting.id, "queued");
    }
    return this;
  }

  readonly handler: Handler = ({ url, method, headers, body }) => {
    if (url.host !== "localhost:8000") return undefined;
    const path = url.pathname;
    this.calls.push(`${method} ${path}${url.search}`);
    if (path === "/health") return { json: { status: "ok" } };
    if (headers.authorization !== "Bearer test-access-token") return { status: 401, json: { detail: "Not signed in" } };
    if (path === "/auth/me") return { json: { id: STUDENT.id, email: STUDENT.email, full_name: STUDENT.full_name, account_type: "applicant" } };

    const me = `/applicants/${STUDENT.id}`;
    if (!path.startsWith(`${me}/`)) return { status: 403, json: { detail: "Not yours" } };
    const route = path.slice(me.length);
    if (route === "/profile") {
      if (this.profileDown) return { status: 500, json: { detail: "Internal Server Error" } };
      const { phone_number, headline, linkedin_url, portfolio_url, github_url, other_url } = { ...STUDENT, ...this.profile };
      return { json: { contact_email: null, phone_number, headline, linkedin_url, portfolio_url, github_url, other_url } };
    }
    if (route === "/bank") return { json: STUDENT.bank };
    if (route === "/preferences") return { json: { visa: null } };
    if (route === "/autofill-answers") {
      if (method === "PATCH") {
        const changed = JSON.parse(body.toString());
        this.answersSaved.push(changed);
        Object.assign(this.answers, changed);
      }
      return { json: this.answers };
    }
    if (route === "/resumes") return { json: [{ id: RESUME_ID, is_default: true, original_filename: STUDENT.resume.filename }] };
    if (route === `/resumes/${RESUME_ID}/bytes`) return { headers: { "content-type": "application/pdf" }, body: Buffer.from(STUDENT.resume.base64, "base64") };
    if (route === "/built-resumes") return { json: [] };
    if (route === "/documents") return { json: this.transcript ? [{ kind: "transcript", original_filename: this.transcript.filename }] : [] };
    if (route === "/documents/transcript/bytes" && this.transcript) {
      return { headers: { "content-type": "application/pdf" }, body: Buffer.from(this.transcript.base64, "base64") };
    }
    if (route === "/connector") return { json: { added: this.connectorAdded } };
    if (route === "/writing-samples" && method === "GET") return { json: { samples: this.samples, style_card: null } };

    if (route === "/applications/next" && method === "GET") {
      const skip = new Set(url.searchParams.getAll("skip"));
      const next = [...this.stages].find(([id, stage]) => stage === "queued" && !skip.has(id));
      if (next) this.events.push(`next:${next[0]}`);
      return { json: next ? this.application(next[0]) : null };
    }
    // The queued applications, newest first, as GET .../applications?stage=queued answers them.
    if (route === "/applications" && method === "GET" && url.searchParams.get("stage") === "queued") {
      return { json: [...this.stages].filter(([, stage]) => stage === "queued").map(([id]) => this.application(id)).reverse() };
    }
    const bank = /^\/applications\/([^/]+)\/answer-bank$/.exec(route);
    if (bank && method === "GET" && this.stages.has(bank[1])) return { json: this.bank };
    // A form outside a batch (no application) gets the same bank.
    if (route === "/answer-bank" && method === "GET") return { json: this.bank };
    const own = /^\/applications\/([^/]+)\/answers$/.exec(route);
    if (own && method === "PUT" && this.stages.has(own[1])) {
      const { name, label, answer, own: isOwn } = JSON.parse(body.toString());
      if (typeof isOwn !== "boolean") return { status: 422, json: { detail: "own is required" } };
      if (!isOwn && this.refuseEdits) return { status: 422, json: { detail: `Not saved: ${this.refuseEdits.join(" ")}` } };
      this.own.push({ jobId: own[1], name, label, answer, own: isOwn });
      // It is now the question's answer (queries.py's save_own_written): the student's own words count as reviewed,
      // an edit of one WorkIt filled waits for the review again (review.py).
      const question = this.written.get(own[1])?.find((q) => q.name === name);
      if (question) Object.assign(question, { answer, reviewed: isOwn, flag: null });
      return { json: { answer, own: isOwn } };
    }
    // The flag card (review.py keep / rewrite): Keep clears the flag; Rewrite with Claude clears the answer for Claude.
    const flagged = /^\/applications\/([^/]+)\/review\/(keep|rewrite)$/.exec(route);
    if (flagged && method === "POST") {
      const { name } = JSON.parse(body.toString());
      const question = this.written.get(flagged[1])?.find((q) => q.name === name);
      if (!question?.answer) return { status: 422, json: { detail: "That answer isn't flagged." } };
      this.flagAnswers.push({ jobId: flagged[1], action: flagged[2], name });
      if (flagged[2] === "keep") Object.assign(question, { flag: null, flag_quote: null, flag_hard: false });
      else Object.assign(question, { answer: null, reviewed: false, flag: null, flag_quote: null, flag_hard: false });
      return { status: 204, body: "" };
      }
    // A pasted answer (backend/app/routers/pasted_answers.py): checked as Claude's, saved as the question's answer.
    const paste = /^\/applications\/([^/]+)\/written-answers$/.exec(route);
    if (paste && method === "PUT" && this.stages.has(paste[1])) {
      const answers: { name: string; answer: string }[] = JSON.parse(body.toString()).answers;
      if (this.refusePastes) {
        const reasons = Object.fromEntries(answers.map((a) => [a.name, this.refusePastes!]));
        return { status: 422, json: { detail: { message: "WorkIt didn't save these answers.", reasons } } };
      }
      for (const { name, answer } of answers) {
        this.pasted.push({ jobId: paste[1], name, answer });
        this.saveAnswer(paste[1], name, answer);
      }
      const left = (this.written.get(paste[1]) ?? []).filter((q) => q.answer === null).length;
      return { json: { saved: answers.length, left } };
    }
    const fill = /^\/applications\/([^/]+)\/fill$/.exec(route);
    if (fill && method === "PUT") {
      const stage = this.stages.get(fill[1]);
      if (!stage) return { status: 404, json: { detail: "No application for that job." } };
      if (stage !== "queued" && stage !== "needs_you") return { status: 409, json: { detail: `That application is ${stage}` } };
      const { state } = JSON.parse(body.toString());
      const next: Stage = state === "needs_you" ? "needs_you" : "queued";
      this.stages.set(fill[1], next);
      return { json: { job_id: fill[1], stage: next } };
    }
    const questions = /^\/applications\/([^/]+)\/questions$/.exec(route);
    if (questions && this.stages.has(questions[1])) {
      const saved = this.written.get(questions[1]) ?? [];
      if (method === "PUT") {
        this.events.push(`questions:${questions[1]}`);
        for (const q of JSON.parse(body.toString()).questions) {
          const known = saved.find((s) => s.name === q.name);
          if (known) Object.assign(known, q);
          else saved.push({ ...q, answer: null });
        }
        this.written.set(questions[1], saved);
      }
      return { json: saved };
    }
    const resume = /^\/applications\/([^/]+)\/resume$/.exec(route);
    if (resume && method === "PUT") {
      const refused = this.refuseUnlessOpen(resume[1]);
      if (refused) return refused;
      this.sentResumes.set(resume[1], JSON.parse(body.toString()));
      return { json: { id: `sent-${resume[1]}` } };
    }
    const finish = /^\/applications\/([^/]+)\/finish$/.exec(route);
    if (finish && method === "POST") {
      const refused = this.refuseUnlessOpen(finish[1]);
      if (refused) return refused;
      const { outcome } = JSON.parse(body.toString());
      const next: Stage = ({ submitted: "applied", skipped: "skipped", failed: "needs_you" } as const)[outcome as "submitted"];
      this.stages.set(finish[1], next);
      return { json: { job_id: finish[1], stage: next } };
    }
    return { status: 404, json: { detail: `The fake API has no ${method} ${route}` } };
  };

  /** pipeline.py's stage check: only a queued or needs_you application is still open. */
  private refuseUnlessOpen(id: string) {
    const stage = this.stages.get(id);
    if (!stage) return { status: 404, json: { detail: "No application for that job." } };
    if (stage !== "queued" && stage !== "needs_you") return { status: 409, json: { detail: `That application is ${stage}` } };
    return undefined;
  }

  /** An Application as GET .../applications/next answers it (the parts the extension reads). */
  private application(id: string) {
    const posting = this.postings.get(id)!;
    return {
      job: {
        id,
        apply_url: posting.apply_url,
        form_url: posting.form_url === undefined ? posting.apply_url : posting.form_url,
        title: posting.title ?? "Intern", company_name: posting.company ?? "Acme" },
      stage: this.stages.get(id),
      open: true,
    };
  }
}
