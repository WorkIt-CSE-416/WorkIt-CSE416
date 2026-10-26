// The waiting card (KAN-369): a batch tab's row waiting for the student's Claude carries a card with how long
// it has waited, Write with Claude, a paste box that saves through the Written Answers paste route (the same
// checks as Claude's; backend/app/routers/pasted_answers.py, faked in fake-api.ts) and Write it myself.
// Lumen's practice form, queued as a real application, asks one written question.
import { expect, test, type Page } from "@playwright/test";
import { PRACTICE_JOBS, practiceFormUrl, practicePage } from "../../frontend/src/lib/practice-form";
import { FakeApi } from "./fake-api";
import { loadExtension, sendFromWebapp, signIn, type Handler, type Loaded } from "./loaded-extension";

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

const panelOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");

/** Opens the batch `api` queues and waits for Lumen's tab to send its written question: its form, and the question's name. */
async function openLumen(api: FakeApi, handlers: Handler[] = []) {
  loaded = await loadExtension([api.handler, webapp, ...handlers]);
  await signIn(loaded.context);
  const page = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await page.goto(`${WEB}/auto-apply`);
  await sendFromWebapp(page, { type: "run/open" });
  await expect.poll(() => api.written.get("job-0")?.length, { timeout: 60_000 }).toBe(1);
  const name = api.written.get("job-0")![0].name;
  const form = loaded.context.pages().find((p) => p.url() === LUMEN)!;
  const card = panelOf(form).locator(`[data-key="${name}"] .waiting`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  return { name, form, card };
}

test("an answer pasted in the waiting card is saved through WorkIt's checks and fills the form", async () => {
  test.setTimeout(120_000);
  const api = new FakeApi().queue({ id: "job-0", apply_url: LUMEN });
  const { name, form, card } = await openLumen(api);
  await expect(card.locator("[data-waited]")).toHaveText(/^Waiting (under a minute|\d+ min)$/);
  await expect(panelOf(form).locator(".summary")).toContainText("1 waiting on Claude");

  await card.getByRole("textbox", { name: "Paste an answer" }).fill(ANSWER);
  await card.getByRole("button", { name: "Save answer" }).click();
  // Saved at once (no wait for the tab's next poll), and in the form.
  await expect.poll(() => api.pasted, { timeout: 5_000 }).toEqual([{ jobId: "job-0", name, answer: ANSWER }]);
  await expect(form.locator(`[name='${name}']`)).toHaveValue(ANSWER, { timeout: 5_000 });
  await expect(card).toHaveCount(0);
  await expect(panelOf(form).locator(".summary")).not.toContainText("waiting on Claude");
});

test("a pasted answer WorkIt's checks refuse shows why, and the row keeps waiting", async () => {
  test.setTimeout(120_000);
  const api = new FakeApi().queue({ id: "job-0", apply_url: LUMEN });
  const reason = "It names a company other than Lumen Health.";
  api.refusePastes = [reason];
  const { name, form, card } = await openLumen(api);

  await card.getByRole("textbox", { name: "Paste an answer" }).fill("I want to build data pipelines at Stripe for its many clinics.");
  await card.getByRole("button", { name: "Save answer" }).click();
  await expect(card.locator("[data-refused]")).toHaveText(reason, { timeout: 5_000 });
  expect(api.pasted).toEqual([]);
  await expect(form.locator(`[name='${name}']`)).toHaveValue("");
  // The draft stays for the student to fix.
  await expect(card.getByRole("textbox", { name: "Paste an answer" })).toHaveValue("I want to build data pipelines at Stripe for its many clinics.");
});
