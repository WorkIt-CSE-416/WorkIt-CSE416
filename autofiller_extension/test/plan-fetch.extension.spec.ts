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
  const slowed: Handler = async (request) => {
    const asked = Date.now();
    const reply = await handler(request);
    if (!reply) return reply;
    await new Promise((done) => setTimeout(done, SLOW_MS));
    log.push({ call: `${request.method} ${request.url.pathname}`, asked, answered: Date.now() });
    return reply;
  };
  return { handler: slowed, log };
}

let loaded: Loaded;
test.afterEach(() => loaded?.close());

/** One queued Greenhouse posting, started as Start Auto Apply does, until its tab is filled (in a tab group). */
async function batchOfOne() {
  const forms = new SavedForms(["greenhouse-arc"]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url("greenhouse-arc") });
  const slowed = slow(api.handler);
  loaded = await loadExtension([slowed.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const app = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await app.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(app, { type: "run/open" });
  const grouped = () => loaded.worker.evaluate(async () => (await chrome.tabGroups.query({})).length);
  await expect.poll(grouped, { timeout: 60_000 }).toBeGreaterThan(0);
  return { api, log: slowed.log, forms };
}

test("a tab that plans while the profile is still being fetched waits for that fetch, not a second one", async () => {
  const { api, forms } = await batchOfOne();
  // The profile is read once a session: its parts (the bank here) are asked once, though write early and the tab both want it.
  expect(api.calls.filter((c) => /^GET \/applicants\/[^/]+\/bank$/.test(c))).toHaveLength(1);
  expect(forms.submissions).toEqual([]);
});
