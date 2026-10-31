// Written answers in the Autofill list (KAN-424, src/content/card-written.js;
// the Answers tab before it, KAN-400): once filled, each written question's
// row sits in the Written Answers box with its answer's first lines and who
// wrote it; one the student's Claude wrote has Rewrite (a round icon: Shorter,
// More specific, More formal, or their words), which sends it back with that
// steer, and Undo rewrite puts the earlier answer back. Lumen's practice form,
// queued as a real application, asks one written question; Workable's saved
// form has a cover letter box. Nothing is submitted. The WorkIt API is faked
// (fake-api.ts). Dummy data only.
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
const writtenBox = (page: Page) => hostOf(page).locator('.box[data-box="written"]');
const rowOf = (page: Page, name: string) => hostOf(page).locator(`.row[data-key="${name}"]`);

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
  await expect(hostOf(form).locator(`.row[data-key="${name}"]`)).toHaveAttribute("data-mark", "waiting", { timeout: 30_000 });
  return { name, form };
}

test("an answer the student's Claude wrote shows in Written Answers with its first lines; Rewrite sends it back with a steer, and Undo rewrite puts it back", async () => {
  test.setTimeout(150_000);
  const api = new FakeApi().queue({ id: "job-0", apply_url: LUMEN });
  const { name, form } = await openLumen(api);
  // Waiting: in the blue box, not Written Answers.
  await expect(writtenBox(form)).toHaveCount(0);
  await expect(hostOf(form).locator(".tabs")).toBeHidden();

  api.saveAnswer("job-0", name, ANSWER);
  const row = writtenBox(form).locator(`.row[data-key="${name}"]`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(writtenBox(form).locator(".box-head")).toHaveText("1 Written Answer");
  await expect(row.locator(".written-preview")).toHaveText(ANSWER);
  await expect(row.locator(".source")).toHaveText("Claude");
  await expect(form.locator(`[name='${name}']`)).toHaveValue(ANSWER);

  // Rewrite: the steers, then Shorter sends it back to their Claude.
  await row.getByRole("button", { name: "Rewrite" }).click();
  await expect(row.locator(".steer").getByRole("button")).toHaveText(["Shorter", "More specific", "More formal", "Rewrite", "Cancel"]);
  await row.locator(".steer").getByRole("button", { name: "Shorter" }).click();
  await expect.poll(() => api.flagAnswers).toEqual([{ jobId: "job-0", action: "redo", name, steer: "Make it shorter." }]);
  const waiting = rowOf(form, name);
  await expect(waiting).toHaveAttribute("data-mark", "waiting");

  // Undo rewrite: the earlier answer goes back in the field and is saved again.
  await waiting.getByRole("button", { name: "Undo rewrite" }).click();
  await expect(form.locator(`[name='${name}']`)).toHaveValue(ANSWER);
  await expect(writtenBox(form).locator(`.row[data-key="${name}"]`)).toBeVisible();
  await expect.poll(() => api.pasted.map((p) => p.answer)).toEqual([ANSWER]);
  await expect(writtenBox(form).getByRole("button", { name: "Undo rewrite" })).toHaveCount(0);
});

test("the student's own words to a written question show as You, with no Rewrite", async () => {
  test.setTimeout(150_000);
  const api = new FakeApi().queue({ id: "job-0", apply_url: LUMEN });
  const { name, form } = await openLumen(api);
  const own = "I want to help clinics reach patients sooner, and I have built data pipelines before.";
  await form.locator(`[name='${name}']`).fill(own);
  const row = writtenBox(form).locator(`.row[data-key="${name}"]`);
  await expect(row.locator(".source")).toHaveText("You", { timeout: 15_000 });
  await expect(row.locator(".written-preview")).toHaveText(own);
  await expect(row.getByRole("button", { name: "Rewrite" })).toHaveCount(0);
});

test("a typed steer goes to the student's Claude as written", async () => {
  test.setTimeout(150_000);
  const api = new FakeApi().queue({ id: "job-0", apply_url: LUMEN });
  const { name, form } = await openLumen(api);
  api.saveAnswer("job-0", name, ANSWER);
  const row = writtenBox(form).locator(`.row[data-key="${name}"]`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: "Rewrite" }).click();
  await row.getByRole("textbox", { name: "What to change" }).fill("Mention my clinic volunteering.");
  await row.locator(".steer").getByRole("button", { name: "Rewrite" }).click();
  await expect.poll(() => api.flagAnswers.map((a) => a.steer)).toEqual(["Mention my clinic volunteering."]);
});

test("a form with a cover letter box waits for it like any written question", async () => {
  test.setTimeout(150_000);
  const form = new SavedWorkable("workable-scout");
  const api = new FakeApi().queue({ id: "job-0", apply_url: form.url });
  loaded = await loadExtension([api.handler, plainWebapp, form.handler]);
  await signIn(loaded.context);
  const page = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await page.goto(`${WEB}/auto-apply`);
  await sendFromWebapp(page, { type: "run/open" });
  await expect.poll(() => api.written.get("job-0")?.find((q) => /cover letter/i.test(q.label))?.name, { timeout: 60_000 }).toBeTruthy();
  const letter = api.written.get("job-0")!.find((q) => /cover letter/i.test(q.label))!.name;
  const tabPage = loaded.context.pages().find((p) => p.url().startsWith(form.url))!;
  await expect(hostOf(tabPage).locator(`.box[data-box="waiting"] .row[data-key="${letter}"]`)).toBeVisible({ timeout: 30_000 });
  expect(form.server.submissions).toEqual([]);
});
