// Batch apply (KAN-512): a batch tab the student closes before WorkIt saw a
// submit is not applied. Its application keeps the stage its fill gave it,
// and `run/status` names its job in `closed`, so Up Next can say "Tab Closed,
// Not Submitted" instead of losing it. A sent application stays applied, a
// tab WorkIt closes itself is not counted, and a closed job picked again
// opens again, even while other tabs of its batch are open.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Handler, type Loaded, menuItem } from "./loaded-extension";

let loaded: Loaded | undefined;
const profiles: string[] = [];
test.afterEach(async () => {
  await loaded?.close();
  loaded = undefined;
  for (const profile of profiles.splice(0)) rmSync(profile, { recursive: true, force: true });
});

// Real job ids: run/open takes only UUIDs.
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

async function openWebapp(): Promise<Page> {
  const page = loaded!.context.pages()[0] ?? (await loaded!.context.newPage());
  await page.goto("http://localhost:3000/auto-apply");
  return page;
}

type Status = { jobIds: string[]; closed?: string[] };
const status = async (webappPage: Page) => (await sendFromWebapp(webappPage, { type: "run/status" })) as Status;

/** Closes the tab showing `url`, as the student's click on its cross does. */
async function closeTab(url: string): Promise<void> {
  await loaded!.worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    await chrome.tabs.remove(tab.id!);
  }, url);
}

test("a Ready or Needs you tab the student closes stays unapplied, shows as closed, and opens again when picked mid-batch", async () => {
  test.setTimeout(150_000);
  const names = ["greenhouse-arc", "greenhouse-purestorage"];
  const forms = new SavedForms(names);
  const api = new FakeApi().queue(...names.map((name, n) => ({ id: id(n), apply_url: forms.url(name) })));
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const webappPage = await openWebapp();
  await sendFromWebapp(webappPage, { type: "run/open", jobIds: [id(0), id(1)] });
  // Arc's form is Ready (queued), Pure Storage's needs the student.
  await expect.poll(() => api.stages.get(id(1)), { timeout: 60_000 }).toBe("needs_you");
  await expect.poll(() => api.calls.some((c) => c.endsWith(`/${id(0)}/fill`)), { timeout: 60_000 }).toBe(true);

  await closeTab(forms.url("greenhouse-arc"));

  await expect.poll(async () => (await status(webappPage)).closed).toEqual([id(0)]);
  expect((await status(webappPage)).jobIds).toEqual([id(1)]);
  // Not applied: it waits as its fill left it.
  expect(api.stages.get(id(0))).toBe("queued");

  // Picked again while Pure Storage's tab is still open, it opens again and is no longer closed.
  expect(await sendFromWebapp(webappPage, { type: "run/open", jobIds: [id(0)] })).toMatchObject({ ok: true, opened: true });
  await expect.poll(async () => (await status(webappPage)).jobIds.sort()).toEqual([id(0), id(1)]);
  expect((await status(webappPage)).closed).toEqual([]);

  // The Needs you tab closed: the same, its stage still needs_you.
  await closeTab(forms.url("greenhouse-purestorage"));
  await expect.poll(async () => (await status(webappPage)).closed).toEqual([id(1)]);
  expect(api.stages.get(id(1))).toBe("needs_you");
  expect(forms.submissions).toEqual([]);
});

test("a tab closed after its submit was seen stays applied, and one Up Next's Remove closes is not counted as closed", async () => {
  test.setTimeout(120_000);
  const names = ["greenhouse-arc", "greenhouse-purestorage"];
  const forms = new SavedForms(names);
  const api = new FakeApi().queue(...names.map((name, n) => ({ id: id(n), apply_url: forms.url(name) })));
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const webappPage = await openWebapp();
  await sendFromWebapp(webappPage, { type: "run/open", jobIds: [id(0), id(1)] });
  await expect.poll(async () => (await status(webappPage)).jobIds.length, { timeout: 60_000 }).toBe(2);
  await expect.poll(() => api.calls.filter((c) => c.endsWith("/fill")).length, { timeout: 60_000 }).toBe(2);

  // Arc's application is marked sent (the panel's I submitted this, as a detected submit marks it).
  const arc = loaded.context.pages().find((p) => p.url() === forms.url("greenhouse-arc"))!;
  await arc.bringToFront();
  await (await menuItem(arc.locator("#workit-autofiller-overlay-host"), "I submitted this")).click();
  await expect.poll(() => api.stages.get(id(0))).toBe("applied");
  await closeTab(forms.url("greenhouse-arc"));

  // Up Next's Remove closes Pure Storage's tab before it dequeues the job.
  expect(await sendFromWebapp(webappPage, { type: "run/close", jobId: id(1) })).toMatchObject({ ok: true, closed: true });

  await expect.poll(async () => (await status(webappPage)).jobIds).toEqual([]);
  expect((await status(webappPage)).closed).toEqual([]);
  expect(api.stages.get(id(0))).toBe("applied");
});

test("a finished tab Chrome didn't restore after it closed counts as closed, unapplied", async () => {
  test.setTimeout(150_000);
  const forms = new SavedForms(["greenhouse-arc"]);
  const api = new FakeApi().queue({ id: id(0), apply_url: forms.url("greenhouse-arc") });
  const handlers: Handler[] = [api.handler, webapp, forms.handler];
  const profile = mkdtempSync(join(tmpdir(), "workit-extension-"));
  profiles.push(profile);
  // No "Continue where you left off": Chrome opens again with none of the batch's tabs.
  loaded = await loadExtension(handlers, { profile });
  await signIn(loaded.context);
  await sendFromWebapp(await openWebapp(), { type: "run/open" });
  await expect.poll(() => api.calls.some((c) => c.endsWith(`/${id(0)}/fill`)), { timeout: 60_000 }).toBe(true);

  await loaded.context.close();
  loaded = await loadExtension(handlers, { profile });
  await signIn(loaded.context);
  const webappPage = await openWebapp();

  await expect.poll(async () => (await status(webappPage)).closed, { timeout: 30_000 }).toEqual([id(0)]);
  expect(api.stages.get(id(0))).toBe("queued");
});
