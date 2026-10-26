// What a batch tab asks WorkIt's API before its first field, with the API
// answering slowly as a live one does: the unpacked extension loaded headless
// (loaded-extension.ts), one queued posting on a saved Greenhouse form, the
// API faked (fake-api.ts) with each answer held back.
import { expect, test } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

// A live API's round trip, roughly.
const SLOW_MS = 300;

/** `handler`'s answers held back SLOW_MS each, with when each call was asked and answered. */
function slow(handler: Handler) {
  const log: { call: string; asked: number; answered: number }[] = [];
  // Calls held back longer still: a path pattern and its extra ms.
  const held: { pattern?: RegExp; ms: number } = { ms: 0 };
  const slowed: Handler = async (request) => {
    const asked = Date.now();
    const reply = await handler(request);
    if (!reply) return reply;
    const extra = held.pattern?.test(request.url.pathname) ? held.ms : 0;
    await new Promise((done) => setTimeout(done, SLOW_MS + extra));
    log.push({ call: `${request.method} ${request.url.pathname}`, asked, answered: Date.now() });
    return reply;
  };
  return { handler: slowed, log, held };
}

let loaded: Loaded;
test.afterEach(() => loaded?.close());

/** One queued Greenhouse posting, started as Start Auto Apply does, until its tab is filled (in a tab group). */
async function batchOfOne() {
  const forms = new SavedForms(["greenhouse-arc", "greenhouse-coinbase"]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url("greenhouse-arc") });
  const slowed = slow(api.handler);
  // When each saved form's page was asked for: its tab had opened.
  const pages: number[] = [];
  const pageAsked: Handler = (request) => {
    if (request.method === "GET" && [forms.url("greenhouse-arc"), forms.url("greenhouse-coinbase")].includes(request.url.href)) pages.push(Date.now());
    return forms.handler(request);
  };
  loaded = await loadExtension([slowed.handler, webapp, pageAsked]);
  await signIn(loaded.context);
  const app = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await app.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(app, { type: "run/open" });
  const grouped = () => loaded.worker.evaluate(async () => (await chrome.tabGroups.query({})).length);
  await expect.poll(grouped, { timeout: 60_000 }).toBeGreaterThan(0);
  return { api, log: slowed.log, held: slowed.held, forms, pages };
}

test("a tab that plans while the profile is still being fetched waits for that fetch, not a second one", async () => {
  const { api, forms } = await batchOfOne();
  // The profile is read once a session: its parts (the bank here) are asked once, though write early and the tab both want it.
  expect(api.calls.filter((c) => /^GET \/applicants\/[^/]+\/bank$/.test(c))).toHaveLength(1);
  expect(forms.submissions).toEqual([]);
});

test("the profile's parts are asked at once, not one after another", async () => {
  const { log } = await batchOfOne();
  // Each part's first ask (the Résumé tab lists the résumés again once the tab is filled).
  const parts = log.filter((l) => /^GET \/applicants\/[^/]+\/(profile|bank|preferences|autofill-answers|resumes|documents|fill-profile)(\/|$)/.test(l.call))
    .filter((l, i, all) => all.findIndex((m) => m.call === l.call) === i);
  expect(parts.map((p) => p.call.replace(/\/applicants\/[^/]+/, ""))).toHaveLength(8);
  // One after another, the eight (the resume's bytes after its list) take eight round trips; at once,
  // about three (a list, its bytes, and the browser's six connections to one host).
  const took = Math.max(...parts.map((p) => p.answered)) - Math.min(...parts.map((p) => p.asked));
  expect(took).toBeLessThan(4 * SLOW_MS);
});

test("a batch asks who is signed in once, not before each of its calls", async () => {
  // Each GET /auth/me was a round trip before the call that needed it: three after every fill alone.
  const { api, forms } = await batchOfOne();
  await expect.poll(() => api.calls.some((c) => c.startsWith("PUT ") && c.endsWith("/fill")), { timeout: 30_000 }).toBe(true);
  expect(api.calls.filter((c) => c === "GET /auth/me")).toHaveLength(1);
  expect(forms.submissions).toEqual([]);
});

test("the profile is asked as the batch starts, while its tab opens, not once the page has loaded", async () => {
  const { log, forms, pages } = await batchOfOne();
  const asked = (pattern: RegExp) => Math.min(...log.filter((l) => pattern.test(l.call)).map((l) => l.asked));
  const tabOpened = pages[0];
  expect(asked(/^GET \/applicants\/[^/]+\/bank$/)).toBeLessThan(tabOpened);
  expect(forms.submissions).toEqual([]);
});

test("a profile past its ten minutes is used at once and fetched again behind", async () => {
  const { api, log, held, forms } = await batchOfOne();
  await expect.poll(() => api.calls.some((c) => c.startsWith("PUT ") && c.endsWith("/fill")), { timeout: 30_000 }).toBe(true);
  // Eleven minutes on: the cached profile is old.
  await loaded.worker.evaluate(async () => {
    const { workit_autofill_profile: cached } = await chrome.storage.local.get("workit_autofill_profile");
    await chrome.storage.local.set({ workit_autofill_profile: { ...cached, fetched_at: Date.now() - 11 * 60_000 } });
  });
  const from = log.length;
  // The profile fetched again answers slowly, as a cold API does.
  Object.assign(held, { pattern: /^\/applicants\/[^/]+\/bank$/, ms: 4_000 });
  api.queue({ id: "job-1", apply_url: forms.url("greenhouse-coinbase") });
  const app = loaded.context.pages().find((p) => p.url().startsWith("http://localhost:3000"))!;
  await sendFromWebapp(app, { type: "run/open" });
  await expect.poll(() => log.slice(from).some((l) => /\/applications\/job-1\/answer-bank$/.test(l.call)), { timeout: 30_000 }).toBe(true);
  const refetch = () => log.slice(from).filter((l) => /^GET \/applicants\/[^/]+\/bank$/.test(l.call));
  await expect.poll(() => refetch().length, { timeout: 30_000 }).toBe(1);
  const later = log.slice(from);
  const refetched = refetch();
  // The Plan's saved answers need the profile in hand: asked before the profile fetched again was in.
  const bank = later.find((l) => /\/applications\/job-1\/answer-bank$/.test(l.call))!;
  expect(bank.asked).toBeLessThan(refetched[0].answered);
});

test("a batch tab's job questions are asked as its tab opens, while its page is still loading, and once", async () => {
  const forms = new SavedForms(["greenhouse-arc"]);
  const form = forms.url("greenhouse-arc");
  const api = new FakeApi().queue({ id: "job-0", apply_url: form });
  // The form's page answers slowly, as a heavy careers page loads; when it was answered, and when the job's questions were asked.
  let pageAnswered = Infinity;
  const questionsAsked: number[] = [];
  const slowPage: Handler = async (request) => {
    if (request.url.host === "boards-api.greenhouse.io" && request.url.searchParams.has("questions")) questionsAsked.push(Date.now());
    const reply = await forms.handler(request);
    if (request.url.href === form) {
      await new Promise((done) => setTimeout(done, 1_500));
      pageAnswered = Math.min(pageAnswered, Date.now());
    }
    return reply;
  };
  loaded = await loadExtension([api.handler, webapp, slowPage]);
  await signIn(loaded.context);
  const app = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await app.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(app, { type: "run/open" });
  const grouped = () => loaded.worker.evaluate(async () => (await chrome.tabGroups.query({})).length);
  await expect.poll(grouped, { timeout: 60_000 }).toBeGreaterThan(0);
  // Asked before its page came, and not again by its Plan.
  expect(questionsAsked).toHaveLength(1);
  expect(questionsAsked[0]).toBeLessThan(pageAnswered);
  expect(forms.submissions).toEqual([]);
});
