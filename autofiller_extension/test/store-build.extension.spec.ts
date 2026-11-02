// The Store build (KAN-463, store/build.mjs) loaded into Chromium, as a student installs it: it talks only
// to WorkIt's deployed site and API, even with something answering on localhost:8000 as the dev API does
// (a student's own FastAPI app, say), and the deployed site's ping and Start batch still reach it.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { startFakeNet, type FakeNet, type Handler } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";
let out: string;
let net: FakeNet;
let context: BrowserContext;
let profile: string;

test.beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), "workit-store-build-"));
  execFileSync("node", [join(__dirname, "..", "store", "build.mjs"), out]);
});
test.afterEach(async () => {
  await context?.close();
  net?.close();
  if (profile) rmSync(profile, { recursive: true, force: true });
});
test.afterAll(() => rmSync(out, { recursive: true, force: true }));

/** The fake API, answering on WorkIt's deployed API host instead of localhost:8000. */
const deployed = (api: FakeApi): Handler => (request) =>
  request.url.host === "api.workitjobs.ai" ? api.handler({ ...request, url: new URL(`${request.url.pathname}${request.url.search}`, "http://localhost:8000") }) : undefined;
/** What answers on localhost:8000: anything at all, /health included. */
const localApp: Handler = ({ url }) => (url.host === "localhost:8000" ? { json: { status: "ok" } } : undefined);
const site: Handler = ({ url }) =>
  url.host === "workitjobs.ai" ? { headers: { "content-type": "text/html" }, body: "<!doctype html><title>WorkIt</title><p>WorkIt" } : undefined;

async function loadStoreBuild(handlers: Handler[]): Promise<{ id: string; page: Page }> {
  net = await startFakeNet(handlers, join(out, "extension"));
  profile = mkdtempSync(join(tmpdir(), "workit-extension-"));
  context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, args: net.args });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  // The deployed site's session cookie, as test/loaded-extension.ts's signIn sets the dev one.
  const session = { access_token: "test-access-token", refresh_token: "test-refresh-token", expires_at: Math.floor(Date.now() / 1000) + 3600 };
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  await context.addCookies([{ name: "sb-zhdrvdrojipkluhzgsea-auth-token", value, url: "https://workitjobs.ai/" }]);
  const page = await context.newPage();
  await page.goto("https://workitjobs.ai/onboarding");
  return { id: new URL(worker.url()).host, page };
}

const send = (page: Page, id: string, message: unknown) =>
  page.evaluate(([id, message]) => new Promise<any>((resolve) => (window as any).chrome.runtime.sendMessage(id, message, resolve)), [id, message] as const);

test("with something answering on localhost:8000, the Store build sends it nothing and calls WorkIt's API", async () => {
  const api = new FakeApi();
  const { id, page } = await loadStoreBuild([localApp, deployed(api), site]);
  // The webapp's ping signs the student in and fetches their profile (background.js, warmProfile).
  expect(await send(page, id, { type: "ping" })).toMatchObject({ ok: true, installed: true, signedIn: true });
  await expect.poll(() => api.calls.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(net.asked.filter((url) => url.includes("localhost"))).toEqual([]);
});

test("the deployed site's Start batch opens the queued job's form in the Store build", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([ANDURIL]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(ANDURIL) });
  const { id, page } = await loadStoreBuild([localApp, deployed(api), site, forms.handler]);
  expect(await send(page, id, { type: "run/open" })).toMatchObject({ ok: true });
  await expect.poll(() => context.pages().some((p) => p.url() === forms.url(ANDURIL)), { timeout: 30_000 }).toBe(true);
  expect(forms.submissions).toEqual([]);
  expect(net.asked.filter((url) => url.includes("localhost"))).toEqual([]);
});

test("the Store build has no test hooks on its service worker's global", async () => {
  await loadStoreBuild([site]);
  const worker = context.serviceWorkers()[0];
  expect(await worker.evaluate(() => [typeof (globalThis as any).workitToolbar, typeof (globalThis as any).workitCommand])).toEqual(["undefined", "undefined"]);
});
