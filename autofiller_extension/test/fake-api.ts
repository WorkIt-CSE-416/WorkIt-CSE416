// The WorkIt API (backend/app/routers) as the extension calls it, for the
// loaded extension (loaded-extension.ts): one signed-in test student (dummy
// data, extension.ts's STUDENT) and an auto-apply queue held in memory, with
// the stage rules of backend/app/auto_apply/pipeline.py.
import { STUDENT } from "./extension";
import type { Handler } from "./loaded-extension";

export type Stage = "queued" | "needs_you" | "skipped" | "applied";
export type Posting = { id: string; apply_url: string; title?: string; company?: string };

const RESUME_ID = "00000000-0000-0000-0000-0000000000r1";

export class FakeApi {
  /** Each queued job's stage, in queue order. */
  readonly stages = new Map<string, Stage>();
  /** Every call, as "METHOD /path?query". */
  readonly calls: string[] = [];
  private postings = new Map<string, Posting>();

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
      const { phone_number, headline, linkedin_url, portfolio_url, github_url, other_url } = STUDENT;
      return { json: { contact_email: null, phone_number, headline, linkedin_url, portfolio_url, github_url, other_url } };
    }
    if (route === "/bank") return { json: STUDENT.bank };
    if (route === "/preferences") return { json: { visa: null } };
    if (route === "/autofill-answers") return { json: STUDENT.answers };
    if (route === "/resumes") return { json: [{ id: RESUME_ID, is_default: true, original_filename: STUDENT.resume.filename }] };
    if (route === `/resumes/${RESUME_ID}/bytes`) return { headers: { "content-type": "application/pdf" }, body: Buffer.from(STUDENT.resume.base64, "base64") };
    if (route === "/built-resumes") return { json: [] };

    if (route === "/applications/next" && method === "GET") {
      const skip = new Set(url.searchParams.getAll("skip"));
      const next = [...this.stages].find(([id, stage]) => stage === "queued" && !skip.has(id));
      return { json: next ? this.application(next[0]) : null };
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
    const finish = /^\/applications\/([^/]+)\/finish$/.exec(route);
    if (finish && method === "POST") {
      const stage = this.stages.get(finish[1]);
      if (!stage) return { status: 404, json: { detail: "No application for that job." } };
      if (stage !== "queued" && stage !== "needs_you") return { status: 409, json: { detail: `That application is ${stage}` } };
      const outcome: string = JSON.parse(body.toString()).outcome;
      const next: Stage = outcome === "submitted" ? "applied" : outcome === "skipped" ? "skipped" : "needs_you";
      this.stages.set(finish[1], next);
      return { json: { job_id: finish[1], stage: next } };
    }
    return { status: 404, json: { detail: `The fake API has no ${method} ${route}` } };
  };

  /** An Application as GET .../applications/next answers it (the parts the extension reads). */
  private application(id: string) {
    const posting = this.postings.get(id)!;
    return {
      job: { id, apply_url: posting.apply_url, title: posting.title ?? "Intern", company_name: posting.company ?? "Acme" },
      stage: this.stages.get(id),
      open: true,
    };
  }
}
