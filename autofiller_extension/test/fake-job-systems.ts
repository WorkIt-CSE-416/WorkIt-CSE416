// Saved job-system forms for the loaded extension (loaded-extension.ts): the
// Fill engine's own fakes and fixtures (the fill-engine submodule's
// FakeJobServer, which replays a form's saved HAR and records any submit),
// answered from the fake network instead of Playwright's routing, plus each
// Greenhouse job's Job Board API answer, which the extension's service worker
// fetches.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeJobServer, FORMS, boardAndJob, loadHar, type Options } from "../fill-engine/test/fake-job-server";
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
async function replay(server: FakeJobServer, request: Request): Promise<Reply | undefined> {
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
