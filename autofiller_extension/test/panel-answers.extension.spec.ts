// The panel's Answers tab (KAN-400, src/content/answers-tab.js): this
// application's written questions, each with where its answer came from
// (Yours, Written by your Claude, Waiting for your Claude, Pasted) and See
// answer, the preview of what the form holds (letter-preview.js). Write with
// Claude sits at the top only while an answer waits for the student's Claude.
// A form with no cover letter field says so. Lumen's practice form, queued as
// a real application, asks one written question and no cover letter;
// Workable's saved form has a cover letter box. Nothing is submitted. The
// WorkIt API is faked (fake-api.ts). Dummy data only.
import { expect, test, type Page } from "@playwright/test";
import { PRACTICE_JOBS, practiceFormUrl, practicePage } from "../../frontend/src/lib/practice-form";
import { FakeApi } from "./fake-api";
import { SavedWorkable } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp as plainWebapp, type Handler, type Loaded } from "./loaded-extension";

const WEB = "http://localhost:3000";
const LUMEN = practiceFormUrl(WEB, PRACTICE_JOBS[1]);
const WHY = "Why do you want to intern at Lumen Health?";
const ANSWER = "I want to build data pipelines that help clinics call the right patients.";

const webapp: Handler = ({ url }) => {
  if (url.host !== "localhost:3000") return undefined;
  const html = { "content-type": "text/html; charset=utf-8" };
  const [, company, job, page] = /^\/practice\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url.pathname) ?? [];
  if (company) return { headers: html, body: practicePage(company, job, page) ?? "" };
  return { headers: html, body: "<!doctype html><title>WorkIt</title><p>WorkIt" };
};

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");
/** The Answers tab's body, opened. */
async function answersTab(page: Page) {
  const host = hostOf(page);
  await host.getByRole("tab", { name: "Answers" }).click();
  return host.locator('.tab[data-tab="answers"]');
}
/** The Answers tab's row for the question labelled `label`. */
const answerRow = (tab: ReturnType<Page["locator"]>, label: string | RegExp) => tab.locator(".answer").filter({ has: tab.page().locator(".answer-label", { hasText: label }) });

/** Opens the batch `api` queues and waits for Lumen's tab to send its written question: its form, and the question's name. */
async function openLumen(api: FakeApi) {
  loaded = await loadExtension([api.handler, webapp]);
  await signIn(loaded.context);
  const page = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await page.goto(`${WEB}/auto-apply`);
  await sendFromWebapp(page, { type: "run/open" });
  await expect.poll(() => api.written.get("job-0")?.length, { timeout: 60_000 }).toBe(1);
  const name = api.written.get("job-0")![0].name;
  const form = loaded.context.pages().find((p) => p.url() === LUMEN)!;
  await expect(hostOf(form).locator(`[data-key="${name}"] .waiting`)).toBeVisible({ timeout: 30_000 });
  return { name, form };
}

test("a question waiting for the student's Claude, then written by it, with Write with Claude only while it waits", async () => {
  test.setTimeout(150_000);
  const api = new FakeApi().queue({ id: "job-0", apply_url: LUMEN });
  const { name, form } = await openLumen(api);
  const tab = await answersTab(form);
  const row = answerRow(tab, WHY);
  await expect(row.locator(".answer-status")).toHaveText("Waiting for your Claude");
  await expect(tab.getByRole("link", { name: "Write with Claude" })).toHaveCount(1);
  await expect(answerRow(tab, "Cover letter").locator(".answer-status")).toHaveText("No cover letter field");

  api.saveAnswer("job-0", name, ANSWER);
  await expect(row.locator(".answer-status")).toHaveText("Written by your Claude", { timeout: 30_000 });
  await expect(tab.getByRole("link", { name: "Write with Claude" })).toHaveCount(0);
  await row.getByRole("button", { name: "See answer" }).click();
  await expect(row.locator(".letter-text")).toHaveText(ANSWER);
  await expect(form.locator(`[name='${name}']`)).toHaveValue(ANSWER);
});

test("an answer the student writes on the form is Yours, and See answer shows their words", async () => {
  test.setTimeout(150_000);
  const api = new FakeApi().queue({ id: "job-0", apply_url: LUMEN });
  const { name, form } = await openLumen(api);
  const own = "I want to help clinics reach patients sooner, and I have built data pipelines before.";
  await form.locator(`[name='${name}']`).fill(own);
  const tab = await answersTab(form);
  const row = answerRow(tab, WHY);
  await expect(row.locator(".answer-status")).toHaveText("Yours", { timeout: 15_000 });
  await expect(tab.getByRole("link", { name: "Write with Claude" })).toHaveCount(0);
  await row.getByRole("button", { name: "See answer" }).click();
  await expect(row.locator(".letter-text")).toHaveText(own);
});

test("an answer pasted in the waiting card is Pasted", async () => {
  test.setTimeout(150_000);
  const api = new FakeApi().queue({ id: "job-0", apply_url: LUMEN });
  const { name, form } = await openLumen(api);
  const card = hostOf(form).locator(`[data-key="${name}"] .waiting`);
  await card.getByRole("textbox", { name: "Paste an answer" }).fill(ANSWER);
  await card.getByRole("button", { name: "Save answer" }).click();
  await expect(form.locator(`[name='${name}']`)).toHaveValue(ANSWER, { timeout: 5_000 });
  const tab = await answersTab(form);
  await expect(answerRow(tab, WHY).locator(".answer-status")).toHaveText("Pasted");
});

test("a form with a cover letter box lists it, with no 'No cover letter field' row", async () => {
  test.setTimeout(150_000);
  const form = new SavedWorkable("workable-scout");
  const api = new FakeApi().queue({ id: "job-0", apply_url: form.url });
  loaded = await loadExtension([api.handler, plainWebapp, form.handler]);
  await signIn(loaded.context);
  const page = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await page.goto(`${WEB}/auto-apply`);
  await sendFromWebapp(page, { type: "run/open" });
  await expect.poll(() => api.written.get("job-0")?.find((q) => /cover letter/i.test(q.label))?.name, { timeout: 60_000 }).toBeTruthy();
  const tabPage = loaded.context.pages().find((p) => p.url().startsWith(form.url))!;
  const tab = await answersTab(tabPage);
  await expect(answerRow(tab, /^Cover letter/i).locator(".answer-status")).toHaveText("Waiting for your Claude", { timeout: 30_000 });
  await expect(tab).not.toContainText("No cover letter field");
  expect(form.server.submissions).toEqual([]);
});
