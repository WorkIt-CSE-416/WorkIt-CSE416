// A Workable form in a batch tab: Workable restores an unsent draft of the form
// from local storage as it opens (an earlier fill's, or the student's own
// visit), and the engine fills only an empty form. The batch forgets the draft
// first. The WorkIt API is faked (fake-api.ts); the form is the Fill engine's
// saved one, served by its FakeWorkable.
import { expect, test } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedWorkable } from "./fake-job-systems";
import { CONTENT_SCRIPT_FILES, ENGINE_FILES } from "../src/shared/content-scripts.js";
import { loadExtension, sendFromWebapp, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

/** `form`'s handler, with its page leaving a stale draft (an entry and a last name) the first time it opens. */
function withDraft(form: SavedWorkable): Handler {
  const draft = JSON.stringify({ lastname: "Stale", experience: [{ id: "section-3", title: "Stale Title" }] });
  const seed = `if (!sessionStorage.getItem("seeded")) { localStorage.setItem("evergreen-persistence-D309E69A5B", ${JSON.stringify(draft)}); sessionStorage.setItem("seeded", "1"); }`;
  return async (request) => {
    const reply = await form.handler(request);
    if (!reply || request.method !== "GET" || request.url.href !== form.url) return reply;
    return { ...reply, body: String(reply.body).replace("<head>", `<head><script>${seed}</script>`) };
  };
}

test("a Workable form opened with a restored draft is filled from empty, not refused for its entries", async () => {
  test.setTimeout(90_000);
  const form = new SavedWorkable("workable-perryhomes");
  const api = new FakeApi().queue({ id: "job-0", apply_url: form.url });
  loaded = await loadExtension([api.handler, webapp, withDraft(form)]);
  await signIn(loaded.context);
  const webappPage = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await webappPage.goto("http://localhost:3000/auto-apply");

  await sendFromWebapp(webappPage, { type: "run/open" });
  // The tab reloads once the draft is forgotten: a read during it is retried.
  const tab = async () => loaded.context.pages().find((p) => p.url().startsWith(form.url));
  await expect.poll(async () => (await tab())?.evaluate(() => (document.querySelector("#lastname") as HTMLInputElement | null)?.value).catch(() => null), { timeout: 60_000 })
    .toBe("Person");
  const page = (await tab())!;
  await expect(page.locator("[data-ui=experience] li")).toHaveCount(0);
  expect(form.server.submissions).toEqual([]);
});

test("the student's own Autofill on a Workable form with a restored draft forgets it and fills from empty", async () => {
  test.setTimeout(90_000);
  const form = new SavedWorkable("workable-perryhomes");
  loaded = await loadExtension([new FakeApi().handler, webapp, withDraft(form)]);
  await signIn(loaded.context);
  await (await loaded.context.newPage()).goto(form.url);
  // Autofill This Page (popup.js's injectFill), outside any batch.
  await loaded.worker.evaluate(async ([engine, scripts, url]) => {
    const [{ id }] = await chrome.tabs.query({ url: `${url}*` });
    await chrome.scripting.executeScript({ target: { tabId: id! }, world: "MAIN", files: engine });
    void chrome.scripting.executeScript({ target: { tabId: id! }, files: scripts });
  }, [ENGINE_FILES, CONTENT_SCRIPT_FILES, form.url] as const);

  const tab = async () => loaded.context.pages().find((p) => p.url().startsWith(form.url));
  await expect.poll(async () => (await tab())?.evaluate(() => (document.querySelector("#lastname") as HTMLInputElement | null)?.value).catch(() => null), { timeout: 60_000 })
    .toBe("Person");
  await expect((await tab())!.locator("[data-ui=experience] li")).toHaveCount(0);
  expect(form.server.submissions).toEqual([]);
});

test("a Workable form opened with no draft is filled without a reload", async () => {
  // Every fresh Workable form writes an empty index ("evergreen-meta-peristence": {}), which is no draft:
  // reloading for it was a second page load, about a second live.
  test.setTimeout(90_000);
  const form = new SavedWorkable("workable-perryhomes");
  let loads = 0;
  const counted: Handler = async (request) => {
    if (request.method === "GET" && request.url.href === form.url) loads += 1;
    return form.handler(request);
  };
  const api = new FakeApi().queue({ id: "job-0", apply_url: form.url });
  loaded = await loadExtension([api.handler, webapp, counted]);
  await signIn(loaded.context);
  const webappPage = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await webappPage.goto("http://localhost:3000/auto-apply");

  await sendFromWebapp(webappPage, { type: "run/open" });
  const tab = async () => loaded.context.pages().find((p) => p.url().startsWith(form.url));
  await expect.poll(async () => (await tab())?.evaluate(() => (document.querySelector("#lastname") as HTMLInputElement | null)?.value).catch(() => null), { timeout: 60_000 })
    .toBe("Person");
  expect(loads).toBe(1);
  expect(form.server.submissions).toEqual([]);
});
