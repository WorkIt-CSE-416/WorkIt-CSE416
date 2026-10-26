// The waiting card (KAN-369): a batch tab's row waiting for the student's Claude carries a card with how long
// it has waited, Write with Claude, a paste box that saves through the Written Answers paste route (the same
// checks as Claude's; backend/app/routers/pasted_answers.py, faked in fake-api.ts) and Write it myself.
// Next Thing That Needs You visits rows waiting on Claude after everything else, and an answer that just
// arrived from Claude stays in the walk until the student has seen it once. Lumen's practice form, queued as a
// real application, asks one written question; Arc's saved Greenhouse form has a name box that drops its answer.
import { expect, test, type Page, type Worker } from "@playwright/test";
import { PRACTICE_JOBS, practiceFormUrl, practicePage } from "../../frontend/src/lib/practice-form";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
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
  const waiting = panelOf(form).locator('.group[data-group="waiting"]');
  await expect(waiting.locator(".group-head")).toHaveText("Waiting for your Claude 1");

  await card.getByRole("textbox", { name: "Paste an answer" }).fill(ANSWER);
  await card.getByRole("button", { name: "Save answer" }).click();
  // Saved at once (no wait for the tab's next poll), and in the form.
  await expect.poll(() => api.pasted, { timeout: 5_000 }).toEqual([{ jobId: "job-0", name, answer: ANSWER }]);
  await expect(form.locator(`[name='${name}']`)).toHaveValue(ANSWER, { timeout: 5_000 });
  await expect(card).toHaveCount(0);
  await expect(panelOf(form).locator(".summary")).not.toContainText("waiting on Claude");
  await expect(waiting).toHaveCount(0);
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

// The name box silently rejects what is typed in it, so Arc's first name is a failed field.
const DROPS_FIRST_NAME = `window.addEventListener("input", (e) => {
  if (e.target.id !== "first_name") return;
  e.stopImmediatePropagation();
  e.target.value = "";
}, true);`;

/** Lumen (job-0, waiting on Claude) then Arc (job-1, a failed name box): both tabs open and grouped. */
async function lumenThenArc() {
  const forms = new SavedForms(["greenhouse-arc"]);
  const arcForm: Handler = async (request) => {
    const reply = await forms.handler(request);
    if (!reply || request.method !== "GET" || request.url.href !== forms.url("greenhouse-arc")) return reply;
    return { ...reply, body: String(reply.body).replace("<head>", `<head><script>${DROPS_FIRST_NAME}</script>`) };
  };
  const api = new FakeApi().queue({ id: "job-0", apply_url: LUMEN }, { id: "job-1", apply_url: forms.url("greenhouse-arc") });
  const { name } = await openLumen(api, [arcForm]);
  const arc = forms.url("greenhouse-arc");
  await expect.poll(() => groupOf(loaded.worker, arc), { timeout: 60_000 }).toBe("Needs you");
  return { api, name, arc };
}

async function groupOf(worker: Worker, url: string): Promise<string | null | undefined> {
  return worker.evaluate(async (url) => {
    const groups = new Map((await chrome.tabGroups.query({})).map((g) => [g.id, g.title!]));
    const tab = (await chrome.tabs.query({})).find((t) => t.url === url);
    return tab ? groups.get(tab.groupId) ?? null : undefined;
  }, url);
}

/** Presses Next Thing That Needs You from `at`'s tab until it says nothing is left: each [tab url, row key]. */
async function walk(at: string, most = 12): Promise<[string, string][]> {
  const page = (url: string) => loaded.context.pages().find((p) => p.url() === url)!;
  const shown = async () => {
    const said = panelOf(page(at)).locator("[data-said]");
    if (await said.isVisible()) return "done";
    const url = (await worker(loaded.worker)).url!;
    const row = panelOf(page(url)).locator("[data-current]");
    return (await row.count()) ? JSON.stringify([url, await row.getAttribute("data-key")]) : "waiting";
  };
  const walked: [string, string][] = [];
  for (let n = 0; n < most; n++) {
    const before = JSON.stringify(walked.at(-1) ?? null);
    await panelOf(page(at)).getByRole("button", { name: "Next Thing That Needs You" }).click();
    await expect.poll(async () => { const s = await shown(); return s === before ? "waiting" : s; }).not.toBe("waiting");
    const step = await shown();
    if (step === "done") return walked;
    walked.push(JSON.parse(step));
    at = walked.at(-1)![0];
  }
  return walked;
}
const worker = (w: Worker) => w.evaluate(async () => (await chrome.tabs.query({ active: true }))[0]);

test("Next Thing visits a row waiting on Claude after everything else in the batch", async () => {
  test.setTimeout(150_000);
  const { name, arc } = await lumenThenArc();
  const walked = await walk(arc);
  // Lumen opened first, but its only row waits on Claude: Arc's name box comes before it, and it comes last.
  expect(walked.map(([, key]) => key)).toContain("first_name");
  expect(walked.at(-1)).toEqual([LUMEN, name]);
  expect(walked.findIndex(([, key]) => key === "first_name")).toBeLessThan(walked.length - 1);
});

test("an answer that just arrived from Claude stays in the walk until the student has seen it once", async () => {
  test.setTimeout(150_000);
  const { api, name, arc } = await lumenThenArc();
  api.saveAnswer("job-0", name, ANSWER);
  const lumen = loaded.context.pages().find((p) => p.url() === LUMEN)!;
  await expect(lumen.locator(`[name='${name}']`)).toHaveValue(ANSWER, { timeout: 20_000 });

  // Filled, so no longer waiting: the walk shows it in its page place (before nothing else is left) once...
  const first = await walk(arc);
  expect(first).toContainEqual([LUMEN, name]);
  // ...and, seen, not again.
  const second = await walk(arc);
  expect(second).not.toContainEqual([LUMEN, name]);
});
