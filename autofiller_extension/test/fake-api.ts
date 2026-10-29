// The WorkIt API (backend/app/routers) as the extension calls it, for the
// loaded extension (loaded-extension.ts): one signed-in test student (dummy
// data, extension.ts's STUDENT) and an auto-apply queue held in memory, with
// the stage rules of backend/app/auto_apply/pipeline.py.
import { STUDENT } from "./extension";
import type { Handler } from "./loaded-extension";

export type Stage = "queued" | "needs_you" | "skipped" | "applied";
/** `form_url`: the employer's form the API names (KAN-376); its apply_url when left out, as for a hiring system's posting. */
export type Posting = {
  id: string; apply_url: string; form_url?: string | null; title?: string; company?: string;
  // The job card's parts (KAN-395), as JobListing names them: shown when known.
  location_label?: string; logo_url?: string; salary_min?: number; salary_max?: number; salary_period?: string;
  // The Match score GET .../applications?scored=true gives it (null: none).
  match?: number | null;
};
/** A question a batch tab's form needs written, and the answer the student's Claude saved (KAN-377). */
export type Written = {
  name: string; label: string; required: boolean; max_length: number | null; answer: string | null;
  // The pre-submit review (backend/app/auto_apply/review.py): whether it read this answer, and why it flagged it.
  reviewed?: boolean; flag?: string | null; flag_quote?: string | null; flag_hard?: boolean;
  // A fact the student's Claude asked the student for (KAN-369), and the experience entry it joins.
  ask?: string | null; ask_about?: string | null;
};
/** One flag save_review gives: its reason, or the reason with the sentence it means and whether it names the wrong company. */
export type Flag = string | { reason: string; quote?: string; hard?: boolean };

const RESUME_ID = "00000000-0000-0000-0000-0000000000r1";

export class FakeApi {
  /** Each queued job's stage, in queue order. */
  readonly stages = new Map<string, Stage>();
  /** Each application's finish outcome as the extension sent it (POST .../finish), by job. */
  readonly outcomes = new Map<string, string>();
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
  /** The saved answers the student took back with Undo (DELETE .../answers?name=, KAN-369), in order. */
  readonly undone: { jobId: string; name: string }[] = [];
  /** Set to refuse the next edits of a filled answer (not own) with these reasons, as WorkIt's checks do (422). */
  refuseEdits: string[] | null = null;
  /** The answers the student pasted in a waiting row's card (PUT .../written-answers, KAN-385's paste route), in order. */
  readonly pasted: { jobId: string; name: string; answer: string }[] = [];
  /** Set to refuse the next pastes with these reasons, as WorkIt's checks do (422, reasons by question). */
  refusePastes: string[] | null = null;
  /** The problem reports the extension sent (POST /fill-reports, KAN-403), each as its body, in order. */
  readonly reports: unknown[] = [];
  /** The job system requests the popup sent (POST /job-system-requests, KAN-369), each as its body, in order. */
  readonly systemRequests: unknown[] = [];
  /** In order: "next:<job>" when GET .../applications/next hands a job out (its tab opens), "questions:<job>" when its questions arrive. */
  readonly events: string[] = [];

  /** The connector's save (backend/app/connector/tools.py): the student's Claude answered one question. */
  /** The student's Claude asks the student for a fact one question's answer needs (KAN-369, save_fact_question). */
  askFact(jobId: string, name: string, ask: string | null, about: string | null = null): void {
    const question = this.written.get(jobId)?.find((q) => q.name === name);
    if (!question) throw new Error(`Job ${jobId} has no question ${name}`);
    Object.assign(question, { ask, ask_about: about });
  }

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

  /** The tabs' flag cards' answers (POST .../review/keep|rewrite, review.py), and Rewrite's (redo, with its steer), in order. */
  readonly flagAnswers: { jobId: string; action: string; name: string; steer?: string }[] = [];

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

  /** What the student brought from Apply (GET .../fill-profile, profiles.py), when set: a 404 otherwise. */
  fillProfile: { profile: object; policies: object } | null = null;

  /** The student's built resumes (GET .../built-resumes), each with its PDF (.../render, base64) and its Keyword match
   * against any posting (.../keyword-match), as keywords. */
  readonly builtResumes: { id: string; name: string; job_posting_id: string | null; is_default?: boolean; pdf: string;
    match?: { matched: string[]; missing: string[] } }[] = [];

  /** The résumés uploaded from the panel (POST .../resumes, multipart), by the file's name; the file's bytes are the
   * whole request body. A file named as STUDENT's resume is a duplicate (the route's 409, naming that resume). */
  readonly uploads: { id: string; filename: string }[] = [];

  /** Whether the student's Claude has signed in to WorkIt's connector (GET .../connector). */
  connectorAdded = false;
  /** How many reads of the Claude connection fail (a server error) before one answers. */
  connectorDown = 0;

  /** `profile`: the student's profile fields that differ from STUDENT's. */
  constructor(private profile: Partial<Omit<typeof STUDENT, "answers">> & { answers?: Record<string, string | null> } = {}) {
    this.answers = { ...(profile.answers ?? STUDENT.answers) };
  }

  /** When each application was marked applied (ISO), by job. */
  readonly appliedAt = new Map<string, string>();

  /** A posting the student applied to already, `at` (ISO): its application is at the applied stage. */
  applied(posting: Posting, at: string): this {
    this.postings.set(posting.id, posting);
    this.stages.set(posting.id, "applied");
    this.appliedAt.set(posting.id, at);
    return this;
  }

  /** Postings in WorkIt's feed the student has no application for (Save to WorkIt finds them by link). */
  listed(...postings: Posting[]): this {
    for (const posting of postings) this.postings.set(posting.id, posting);
    return this;
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
    if (path === "/fill-reports" && method === "POST") {
      this.reports.push(JSON.parse(body.toString()));
      return { status: 201, json: { stored: true } };
    }
    if (path === "/job-system-requests" && method === "POST") {
      this.systemRequests.push(JSON.parse(body.toString()));
      return { status: 201, json: { id: "request-1" } };
    }
    if (path === "/jobs/saved-by-link" && method === "POST") {
      // applications.py's Save to WorkIt by the page's link (KAN-401): the feed's job whose apply link it is.
      const bare = (link: string) => link.split("#")[0].split("?")[0].replace(/\/+$/, "");
      const { url: link } = JSON.parse(body.toString());
      const found = [...this.postings.values()].find((posting) => bare(posting.apply_url) === bare(link));
      if (!found) return { status: 404, json: { detail: "WorkIt doesn't list this job yet." } };
      if (!this.stages.has(found.id)) this.stages.set(found.id, "saved");
      return { json: { job_id: found.id, stage: this.stages.get(found.id) } };
    }
    // Track on WorkIt (KAN-424): the listed job a link is, with the student's stage (writes nothing);
    // the job kept saved (a stage it has stays); and marked applied, as the website's Applied button does.
    const byLink = path === "/jobs/listed-by-link" && method === "POST";
    if (byLink) {
      const bare = (link: string) => link.split("#")[0].split("?")[0].replace(/\/+$/, "");
      const { url: link } = JSON.parse(body.toString());
      const found = [...this.postings.values()].find((posting) => bare(posting.apply_url) === bare(link));
      if (!found) return { status: 404, json: { detail: "WorkIt doesn't list this job yet." } };
      return { json: { job_id: found.id, stage: this.stages.get(found.id) ?? null } };
    }
    const jobMark = /^\/jobs\/([^/]+)\/(saved|applied)$/.exec(path);
    if (jobMark && method === "POST") {
      const [, id, what] = jobMark;
      if (!this.postings.has(id)) return { status: 404, json: { detail: "That job isn't open any more." } };
      if (what === "saved") {
        if (!this.stages.has(id)) this.stages.set(id, "saved");
        return { json: { stage: this.stages.get(id) } };
      }
      this.stages.set(id, "applied");
      this.appliedAt.set(id, new Date().toISOString());
      return { json: { applied_at: this.appliedAt.get(id), sent_resume_id: null } };
    }
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
    if (route === "/fill-profile" && this.fillProfile) return { json: this.fillProfile };
    if (route === "/preferences") return { json: { visa: null } };
    if (route === "/autofill-answers") {
      if (method === "PATCH") {
        const changed = JSON.parse(body.toString());
        this.answersSaved.push(changed);
        Object.assign(this.answers, changed);
      }
      return { json: this.answers };
    }
    if (route === "/resumes" && method === "POST") {
      const filename = /filename="([^"]+)"/.exec(body.toString("latin1"))?.[1] ?? "resume.pdf";
      if (filename === STUDENT.resume.filename) return { status: 409, json: { detail: { message: `Duplicate Resume found: ${filename}`, resume_id: RESUME_ID } } };
      const id = `00000000-0000-0000-0000-00000000up${String(this.uploads.length).padStart(2, "0")}`;
      this.uploads.push({ id, filename });
      return { json: { id, original_filename: filename, is_default: false } };
    }
    if (route === "/resumes") {
      return { json: [{ id: RESUME_ID, is_default: true, original_filename: STUDENT.resume.filename }, ...this.uploads.map((u) => ({ id: u.id, is_default: false, original_filename: u.filename }))] };
    }
    if (this.uploads.some((u) => route === `/resumes/${u.id}/bytes`)) {
      return { headers: { "content-type": "application/pdf" }, body: Buffer.from(STUDENT.resume.base64, "base64") };
    }
    if (route === `/resumes/${RESUME_ID}/bytes`) return { headers: { "content-type": "application/pdf" }, body: Buffer.from(STUDENT.resume.base64, "base64") };
    if (route === "/built-resumes") {
      return { json: this.builtResumes.map(({ pdf: _pdf, match: _match, ...r }) => ({ template: "classic", is_default: false, ...r })) };
    }
    const built = /^\/built-resumes\/([^/]+)\/(render|keyword-match)$/.exec(route);
    const builtResume = built && this.builtResumes.find((r) => r.id === built[1]);
    if (built && !builtResume) return { status: 404, json: { detail: "Resume not found" } };
    if (built && built[2] === "render") return { json: { pdf: builtResume!.pdf, missing_glyphs: [] } };
    if (built) {
      const posting = url.searchParams.get("job_posting_id") ?? builtResume!.job_posting_id;
      const kind = (keyword: string) => ({ keyword, kind: "required" });
      const match = builtResume!.match ?? { matched: [], missing: [] };
      return { json: { job_posting_id: posting, matched: match.matched.map(kind), missing: match.missing.map(kind), uses_left: 5 } };
    }
    if (route === "/documents") return { json: this.transcript ? [{ kind: "transcript", original_filename: this.transcript.filename }] : [] };
    if (route === "/documents/transcript/bytes" && this.transcript) {
      return { headers: { "content-type": "application/pdf" }, body: Buffer.from(this.transcript.base64, "base64") };
    }
    if (route === "/connector" && method === "DELETE") {
      this.connectorAdded = false;
      return { status: 204, body: "" };
    }
    if (route === "/connector" && this.connectorDown > 0) {
      this.connectorDown--;
      return { status: 500, json: {} };
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
    // Every application, newest first; ?scored=true adds each one's Match score (KAN-395's job card).
    if (route === "/applications" && method === "GET" && !url.searchParams.has("stage")) {
      const scored = url.searchParams.get("scored") === "true";
      return { json: [...this.stages.keys()].map((id) => ({ ...this.application(id), match: scored ? this.postings.get(id)!.match ?? null : null })).reverse() };
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
    if (own && method === "DELETE" && this.stages.has(own[1])) {
      this.undone.push({ jobId: own[1], name: url.searchParams.get("name") ?? "" });
      return { status: 204 };
    }
    // The flag card (review.py keep / rewrite): Keep clears the flag; Rewrite with Claude clears the answer for Claude.
    // A written answer's Rewrite (redo, KAN-424): any answer, flagged or not, cleared for Claude with the steer.
    const flagged = /^\/applications\/([^/]+)\/review\/(keep|rewrite|redo)$/.exec(route);
    if (flagged && method === "POST") {
      const { name, steer } = JSON.parse(body.toString());
      const question = this.written.get(flagged[1])?.find((q) => q.name === name);
      if (!question?.answer) return { status: 422, json: { detail: "That answer isn't flagged." } };
      this.flagAnswers.push({ jobId: flagged[1], action: flagged[2], name, ...(steer ? { steer } : {}) });
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
    if (finish && method === "POST" && JSON.parse(body.toString()).outcome === "unsubmitted") {
      // pipeline.py's way back (KAN-401): only an applied application, its date cleared, to the
      // stage its tab had ("state": ready → queued, needs_you → needs_you; none → needs_you).
      if (this.stages.get(finish[1]) !== "applied") return { status: 409, json: { detail: "That application wasn't marked applied." } };
      const back = JSON.parse(body.toString()).state === "ready" ? "queued" : "needs_you";
      this.stages.set(finish[1], back);
      this.appliedAt.delete(finish[1]);
      return { json: { job_id: finish[1], stage: back } };
    }
    if (finish && method === "POST") {
      const refused = this.refuseUnlessOpen(finish[1]);
      if (refused) return refused;
      const { outcome } = JSON.parse(body.toString());
      this.outcomes.set(finish[1], outcome);
      // closed (a batch tab found the job closed): skipped, as pipeline.py does, with its posting marked closed.
      const next: Stage = ({ submitted: "applied", skipped: "skipped", failed: "needs_you", closed: "skipped" } as const)[outcome as "submitted"];
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
        title: posting.title ?? "Intern", company: posting.company ?? "Acme", company_name: posting.company ?? "Acme",
        location_label: posting.location_label ?? null, logo_url: posting.logo_url ?? null,
        salary_min: posting.salary_min ?? null, salary_max: posting.salary_max ?? null, salary_currency: posting.salary_min ? "USD" : null,
        salary_period: posting.salary_period ?? null },
      stage: this.stages.get(id),
      applied_at: this.appliedAt.get(id) ?? null,
      open: true,
    };
  }
}
