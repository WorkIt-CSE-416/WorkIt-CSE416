// Saved job-system forms for the loaded extension (loaded-extension.ts): the
// Fill engine's own fakes and fixtures (the fill-engine submodule's
// FakeJobServer, which replays a form's saved HAR and records any submit),
// answered from the fake network instead of Playwright's routing, plus each
// Greenhouse job's Job Board API answer, which the extension's service worker
// fetches.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeJobServer, FORMS, boardAndJob, loadHar, type Options } from "../fill-engine/test/fake-job-server";
import { FakeWorkday, type Step } from "../fill-engine/test/fake-workday";
import { FakeWorkable } from "../fill-engine/test/fake-workable";
import type { Handler, Reply, Request } from "./loaded-extension";

// Where Greenhouse's presigned uploads (the résumé) go: answered here, as the engine's fake upload store answers them.
const UPLOADS = "https://uploads.fake-storage.test";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST" };

/** A company's own application page, on a site the Fill engine has no Filler for. */
export const uncoveredForm = (n: number) => `https://careers.example.com/jobs/${n}/apply`;

export class SavedForms {
  private servers: { name: string; url: string; server: FakeJobServer }[];

  /** `names`: fixture folders in fill-engine/test/fixtures/forms (Greenhouse and Ashby forms).
   * `submitReply`: how Greenhouse answers the applicant's submit, when not OK. */
  constructor(names: string[], { submitReply }: Options = {}) {
    this.servers = names.map((name) => ({ name, url: loadHar(name).log.entries[0].request.url, server: new FakeJobServer(name, { submitReply }) }));
  }

  /** The saved form's own link, as a posting's apply_url gives it. */
  url(name: string): string {
    return this.servers.find((s) => s.name === name)!.url;
  }

  /** Every submit any saved form received (the extension must never send one). */
  get submissions(): unknown[] {
    return this.servers.flatMap((s) => s.server.submissions);
  }

  readonly handler: Handler = async (request) => {
    const { url, method } = request;
    if (url.origin === UPLOADS) return { status: method === "OPTIONS" ? 204 : 201, headers: CORS };
    if (url.host === "careers.example.com") {
      return { headers: { "content-type": "text/html" }, body: "<!doctype html><title>Apply</title><form><label>First name <input name=first></label></form>" };
    }
    if (url.host === "boards-api.greenhouse.io") return this.jobBoardApi(url);
    // The job board posts the application to boards.greenhouse.io from job-boards.greenhouse.io, after a CORS preflight.
    if (method === "OPTIONS" && url.host === "boards.greenhouse.io") return { status: 204, headers: CORS };
    // The page Greenhouse's job board opens once it has the application.
    if (url.host.endsWith("greenhouse.io") && url.pathname.endsWith("/confirmation")) {
      return { headers: { "content-type": "text/html" }, body: "<!doctype html><title>Thank you</title><p>Thank you for applying." };
    }
    // The first saved form that has an answer: each server refuses (aborts) what it didn't save.
    for (const { server } of this.servers) {
      const reply = await replay(server, request);
      if (reply) return reply;
    }
    return undefined;
  };

  /** Greenhouse's Job Board API for a saved form's job: its questions.json. */
  private jobBoardApi(url: URL): Reply | undefined {
    const [, board, job] = /\/boards\/([^/]+)\/jobs\/(\d+)/.exec(url.pathname) ?? [];
    const saved = this.servers.find((s) => s.url.includes("greenhouse") && boardAndJob(s.url).join("/") === `${board}/${job}`);
    if (!saved) return undefined;
    return { headers: { "content-type": "application/json" }, body: readFileSync(join(FORMS, saved.name, "questions.json")) };
  }
}

/** Asks one FakeJobServer for `request`, as its Playwright route handler would answer it. */
async function replay(server: FakeJobServer | FakeWorkday | FakeWorkable, request: Request): Promise<Reply | undefined> {
  let reply: Reply | undefined;
  const route = {
    request: () => ({
      url: () => request.url.href,
      method: () => request.method,
      postData: () => request.body.toString(),
      postDataJSON: () => JSON.parse(request.body.toString()),
    }),
    fulfill: async ({ status = 200, contentType, body, json }: { status?: number; contentType?: string; body?: string | Buffer; json?: unknown }) => {
      reply = json !== undefined ? { status, json } : { status, headers: contentType ? { "content-type": contentType } : {}, body };
    },
    abort: async () => {},
    continue: async () => {},
  };
  // `handle` is the server's own route handler (TypeScript-private only).
  await (server as any).handle(route, UPLOADS);
  return reply;
}

/**
 * Workday applications for the loaded extension: the Fill engine's FakeWorkday
 * steps (fill-engine/test/fake-workday.ts), each on a saved Workday form's
 * tenant host, answered from the fake network.
 */
export class FakeWorkdays {
  private tenants: FakeWorkday[];

  /** `names`: saved Workday forms (fill-engine/test/fixtures/forms), one tenant each. */
  constructor(names: string[], steps: Step[] = [["My Information", [
    { key: "legalName--firstName", label: "First Name", kind: "text", required: true },
    { key: "legalName--lastName", label: "Last Name", kind: "text", required: true },
  ]]]) {
    this.tenants = names.map((name) => new FakeWorkday(name, { steps }));
  }

  /** The application's first step (or step `step`) on the n-th tenant; the first is what a posting's apply_url gives. */
  url(n: number, step = 1): string {
    return this.tenants[n].stepUrl(step);
  }

  /**
   * The n-th tenant's Create Account page (or its Sign In page), where an
   * application starts for a candidate who isn't signed in.
   */
  signInUrl(n: number, view: "create" | "signin" = "create"): string {
    return `https://${this.tenants[n].host}/__fake__/signin?view=${view}`;
  }

  /** The n-th tenant's job posting: no form, only Apply, which loads the Create Account page. */
  postingUrl(n: number): string {
    return `https://${this.tenants[n].host}/__fake__/job`;
  }

  /** Each Create Account and Sign In the student sent: the tenant's host, the view, the email and the password. */
  readonly signIns: { host: string; view: string; email: string; password: string }[] = [];

  /** Whether each Create Account sent had its terms box ticked, in order. */
  readonly agreed: boolean[] = [];

  /**
   * Workday's answer to a Create Account or Sign In, by tenant host and view:
   * the words of the message it shows on the page instead of going on to the
   * application (a verification email, a wrong password).
   */
  readonly alerts: Record<string, Partial<Record<"create" | "signin", string>>> = {};

  /** Every submit any tenant received (the extension must never send one). */
  get submissions(): unknown[] {
    return this.tenants.flatMap((t) => t.submissions);
  }

  readonly handler: Handler = async (request) => {
    for (const tenant of this.tenants) {
      if (request.url.hostname !== tenant.host) continue;
      if (request.url.pathname === "/__fake__/job") {
        const apply = `<a data-automation-id="adventureButton" href="/__fake__/signin?view=create">Apply</a>`;
        return { headers: { "content-type": "text/html" }, body: `<!doctype html><title>Intern</title><h2>Software Engineering Intern</h2>${apply}` };
      }
      if (request.url.pathname === "/__fake__/signin") return { headers: { "content-type": "text/html" }, body: signInPage(request.url.searchParams.get("view")!) };
      if (request.url.pathname === "/__fake__/account" && request.method === "POST") {
        const { agreed, ...sent } = JSON.parse(request.body.toString());
        this.signIns.push({ host: tenant.host, ...sent });
        if (sent.view === "create") this.agreed.push(agreed);
        const alert = this.alerts[tenant.host]?.[sent.view as "create" | "signin"];
        return { json: alert ? { alert } : { next: tenant.stepUrl(1) } };
      }
      return replay(tenant, request);
    }
    return undefined;
  };
}

/**
 * A Workday tenant's Create Account / Sign In page, in the shape of the live
 * one (the automation ids Workday's own pages use): the form, a link to the
 * other view, and the button, which Workday covers with a `click_filter`
 * that takes the click. The step bar names the sign-in as the first step.
 * A Create Account or Sign In that Workday refuses (`alerts`) shows its
 * message above the form, as Workday's `errorMessage` alert, and stays.
 * The link switches views in the page, as live Workday does: the form is
 * drawn again, its boxes empty, a moment after it changes title (Xcel
 * Energy's, live 2026-10-25).
 */
function signInPage(view: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Workday</title>
<ol data-automation-id="progressBar"><li data-automation-id="progressBarActiveStep"><label>current step 1 of 3</label><label>Create Account/Sign In</label></li></ol>
<div data-automation-id="signInContent"></div>
<script>
let view = ${JSON.stringify(view)};
const box = (id, label, type = "password") => '<label>' + label + '<input type="' + type + '" data-automation-id="' + id + '"></label>';
function draw() {
  const create = view === "create";
  document.querySelector("[data-automation-id=signInContent]").innerHTML =
    '<h2 id="authViewTitle">' + (create ? "Create Account" : "Sign In") + '</h2>' +
    '<form data-automation-id="signInFormo" onsubmit="return false">' + box("email", "Email Address", "text") + box("password", "Password") +
    (create ? box("verifyPassword", "Verify New Password") + '<label><input type="checkbox" data-automation-id="createAccountCheckbox">I agree to the terms</label>' : "") +
    '<div role="button" aria-label="' + (create ? "Create Account" : "Sign In") + '" data-automation-id="click_filter" style="width:200px;height:40px;background:#ddd"></div></form>' +
    '<button data-automation-id="' + (create ? "signInLink" : "createAccountLink") + '">' + (create ? "Sign In" : "Create Account") + '</button>';
}
draw();
document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-automation-id$=Link]")) {
    view = view === "create" ? "signin" : "create";
    draw();
    // Drawn again a moment later, emptying what was typed meanwhile.
    setTimeout(draw, 400);
    return;
  }
  if (!event.target.closest("[data-automation-id=click_filter]")) return;
  const value = (id) => document.querySelector("[data-automation-id=" + id + "]").value;
  const agreed = Boolean(document.querySelector("[data-automation-id=createAccountCheckbox]")?.checked);
  const answer = await (await fetch("/__fake__/account", { method: "POST", body: JSON.stringify({ view, email: value("email"), password: value("password"), agreed }) })).json();
  if (!answer.alert) return void (location.href = answer.next);
  const alert = document.createElement("div");
  alert.setAttribute("data-automation-id", "errorMessage");
  alert.setAttribute("role", "alert");
  alert.textContent = answer.alert;
  document.querySelector("[data-automation-id=signInFormo]").prepend(alert);
});
</script>`;
}

/** A saved Workable form (fill-engine/test/fixtures/forms/workable-*) for the loaded extension: the Fill engine's FakeWorkable, answered from the fake network. */
export class SavedWorkable {
  readonly server: FakeWorkable;

  constructor(name: string) {
    this.server = new FakeWorkable(name);
  }

  /** The form's own link, as a posting's apply_url gives it. */
  get url(): string {
    return this.server.url;
  }

  readonly handler: Handler = (request) => replay(this.server, request);
}
