// Answers the student pastes on WorkIt's Written Answers page (KAN-385), end to
// end through the loaded extension: the page saves each one through the same
// save and checks as the connector's (backend/app/auto_apply/pipeline.py,
// `save_answers`; tested in backend/tests/test_pasted_answers.py), so a batch
// tab fills a pasted answer as it fills one from the student's Claude, and
// moves to Ready once nothing else needs the student. The API is faked
// (fake-api.ts): `api.saveAnswer` is that save.
import { expect, test, type Worker } from "@playwright/test";
import { PRACTICE_JOBS, practiceFormUrl, practicePage } from "../../frontend/src/lib/practice-form";
import { FakeApi } from "./fake-api";
import { loadExtension, sendFromWebapp, signIn, type Handler, type Loaded } from "./loaded-extension";

const WEB = "http://localhost:3000";
// Lumen's form asks what the profile answers and one written question: the written one is all that needs the student.
const LUMEN = practiceFormUrl(WEB, PRACTICE_JOBS[1]);
const WHY = "Why do you want to intern at Lumen Health?";
const ANSWER = "I want to build data pipelines that help clinics call the right patients.";

/** The webapp: the practice form as its route handler serves it, and a page for any other path. */
const webapp: Handler = ({ url }) => {
  if (url.host !== "localhost:3000") return undefined;
  const html = { "content-type": "text/html; charset=utf-8" };
  const [, company, job, page] = /^\/practice\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url.pathname) ?? [];
  if (company) return { headers: html, body: practicePage(company, job, page) ?? "" };
  return { headers: html, body: "<!doctype html><title>WorkIt</title><p>WorkIt" };
};

let loaded: Loaded;
test.afterEach(() => loaded?.close());

async function groupOf(worker: Worker, url: string): Promise<string | null | undefined> {
  return worker.evaluate(async (url) => {
    const groups = new Map((await chrome.tabGroups.query({})).map((g) => [g.id, g.title!]));
    const tab = (await chrome.tabs.query({})).find((t) => t.url === url);
    return tab ? groups.get(tab.groupId) ?? null : undefined;
  }, url);
}

test("a pasted answer fills into its open tab, which moves to Ready", async () => {
  test.setTimeout(120_000);
  // Lumen's form, queued as a real application (not onboarding's practice batch), so its tab asks WorkIt for the answer.
  const api = new FakeApi().queue({ id: "job-0", apply_url: LUMEN });
  loaded = await loadExtension([api.handler, webapp]);
  await signIn(loaded.context);
  const page = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await page.goto(`${WEB}/auto-apply`);
  await sendFromWebapp(page, { type: "run/open" });

  // The tab sends its written question to WorkIt, and needs the student until it is answered.
  await expect.poll(() => api.written.get("job-0")?.map((q) => q.label), { timeout: 60_000 }).toEqual([WHY]);
  await expect.poll(() => groupOf(loaded.worker, LUMEN), { timeout: 30_000 }).toBe("Needs you");
  expect(api.stages.get("job-0")).toBe("needs_you");

  // The student pastes an answer on the Written Answers page, which saves it.
  const name = api.written.get("job-0")![0].name;
  api.saveAnswer("job-0", name, ANSWER);

  // Within one poll (10 seconds) it is in the form, and nothing else needs the student.
  const form = loaded.context.pages().find((p) => p.url() === LUMEN)!;
  await expect(form.locator(`[name='${name}']`)).toHaveValue(ANSWER, { timeout: 20_000 });
  await expect.poll(() => groupOf(loaded.worker, LUMEN), { timeout: 15_000 }).toBe("Ready");
  await expect.poll(() => api.stages.get("job-0")).toBe("queued");
});

// The pre-submit review (KAN-369): the student's Claude re-reads a filled application's answers through the
// connector (backend/app/auto_apply/review.py; tested in backend/tests/test_connector_review.py). An answer it
// flags shows on its row as needing the student, with the reason, until the student edits it.
test("an answer the review flags needs the student until they edit it", async () => {
  test.setTimeout(120_000);
  const api = new FakeApi().queue({ id: "job-0", apply_url: LUMEN });
  api.connectorAdded = true; // only a student's Claude reviews
  loaded = await loadExtension([api.handler, webapp]);
  await signIn(loaded.context);
  const page = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await page.goto(`${WEB}/auto-apply`);
  await sendFromWebapp(page, { type: "run/open" });
  await expect.poll(() => api.written.get("job-0")?.length, { timeout: 60_000 }).toBe(1);
  const name = api.written.get("job-0")![0].name;
  api.saveAnswer("job-0", name, ANSWER);
  const form = loaded.context.pages().find((p) => p.url() === LUMEN)!;
  await expect(form.locator(`[name='${name}']`)).toHaveValue(ANSWER, { timeout: 20_000 });
  await expect.poll(() => groupOf(loaded.worker, LUMEN), { timeout: 15_000 }).toBe("Ready");

  // The review flags it: within one poll its row says why, and the tab needs the student.
  const flag = "It says clinics call patients; the experience doesn't say that.";
  api.saveReview("job-0", { [name]: flag });
  const row = form.locator(`#workit-autofiller-overlay-host [data-key="${name}"]`);
  await expect(row.locator(".flag-card .card-warning")).toHaveText(`Your Claude's check: ${flag} Read it before you submit, and edit it if it's wrong.`, { timeout: 20_000 });
  await expect(row).toHaveAttribute("data-flagged", "");
  await expect.poll(() => groupOf(loaded.worker, LUMEN), { timeout: 15_000 }).toBe("Needs you");

  // The student edits it: the flag is gone, and nothing else needs them.
  await form.locator(`[name='${name}']`).fill("I want to build data pipelines for clinics.");
  await expect(row.locator(".flag-card .card-warning")).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => groupOf(loaded.worker, LUMEN), { timeout: 15_000 }).toBe("Ready");
});

/** A filled Lumen tab for the student: their Claude's (or a pasted) answer is in the form, and the tab is Ready. */
async function filledLumen(api: FakeApi) {
  loaded = await loadExtension([api.handler, webapp]);
  await signIn(loaded.context);
  const page = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await page.goto(`${WEB}/auto-apply`);
  await sendFromWebapp(page, { type: "run/open" });
  await expect.poll(() => api.written.get("job-0")?.length, { timeout: 60_000 }).toBe(1);
  const name = api.written.get("job-0")![0].name;
  api.saveAnswer("job-0", name, ANSWER);
  const form = loaded.context.pages().find((p) => p.url() === LUMEN)!;
  await expect(form.locator(`[name='${name}']`)).toHaveValue(ANSWER, { timeout: 20_000 });
  await expect.poll(() => groupOf(loaded.worker, LUMEN), { timeout: 15_000 }).toBe("Ready");
  return { name, form };
}

// No Claude reviews the answers of a student without the connector (pasted ones): the tab stops asking for them.
test("a tab stops polling for a review when the student has no connector", async () => {
  test.setTimeout(120_000);
  const api = new FakeApi().queue({ id: "job-0", apply_url: LUMEN });
  await filledLumen(api);
  const polls = () => api.calls.filter((c) => /^GET \S*\/applications\/job-0\/questions$/.test(c)).length;
  const before = polls();
  await new Promise((done) => setTimeout(done, 25_000)); // two and a half polls
  expect(polls()).toBe(before);
});

// The student edits an answer the review passed: the tab asks again until the review reads the edit.
test("an edit of a reviewed answer shows its new verdict", async () => {
  test.setTimeout(150_000);
  const api = new FakeApi().queue({ id: "job-0", apply_url: LUMEN });
  api.connectorAdded = true;
  const { name, form } = await filledLumen(api);
  api.saveReview("job-0", {});
  const done = api.calls.length;
  // The tab reads the verdict (no flag), so every answer is reviewed.
  await expect.poll(() => api.calls.slice(done).some((c) => c.endsWith("/applications/job-0/questions")), { timeout: 20_000 }).toBe(true);

  await form.locator(`[name='${name}']`).fill("I want to build data pipelines for clinics in my city.");
  await expect.poll(() => api.written.get("job-0")![0].reviewed, { timeout: 15_000 }).toBe(false);
  const flag = "It says the student lives near the clinics; the experience doesn't say that.";
  api.saveReview("job-0", { [name]: flag });
  const row = form.locator(`#workit-autofiller-overlay-host [data-key="${name}"]`);
  await expect(row.locator(".flag-card .card-warning")).toHaveText(`Your Claude's check: ${flag} Read it before you submit, and edit it if it's wrong.`, { timeout: 20_000 });
  await expect.poll(() => groupOf(loaded.worker, LUMEN), { timeout: 15_000 }).toBe("Needs you");
});

// The flag card (KAN-369): a flagged row shows Claude's reason and the sentence it means, with Keep,
// Rewrite with Claude and Edit myself. The flagged sentence here names another company (a hard flag).
const STRIPE = "I want to build data pipelines that help clinics call the right patients";
const WRONG_COMPANY = { reason: "Names Stripe; this job is at Lumen Health.", quote: STRIPE, hard: true };

async function flaggedLumen(api: FakeApi) {
  api.connectorAdded = true;
  const { name, form } = await filledLumen(api);
  api.saveReview("job-0", { [name]: WRONG_COMPANY });
  const row = form.locator(`#workit-autofiller-overlay-host [data-key="${name}"]`);
  await expect(row.locator(".flag-card .card-highlight")).toHaveText(`“${STRIPE}”`, { timeout: 20_000 });
  await expect(row.locator(".flag-card")).toHaveAttribute("data-hard", "");
  await expect.poll(() => groupOf(loaded.worker, LUMEN), { timeout: 15_000 }).toBe("Needs you");
  return { name, form, row };
}

test("Edit myself marks the flagged sentence, and the flag holds until that sentence changes", async () => {
  test.setTimeout(150_000);
  const api = new FakeApi().queue({ id: "job-0", apply_url: LUMEN });
  const { name, form, row } = await flaggedLumen(api);
  const field = form.locator(`[name='${name}']`);

  // Edit myself: the field is focused with the flagged sentence selected.
  await row.getByRole("button", { name: "Edit myself" }).click();
  await expect.poll(() => field.evaluate((box: HTMLTextAreaElement) => box.value.slice(box.selectionStart, box.selectionEnd))).toBe(STRIPE);

  // An edit that keeps the sentence keeps the flag; one that changes it clears it.
  await field.fill(`${ANSWER} I like data.`);
  await expect.poll(() => api.own.length, { timeout: 15_000 }).toBe(1);
  await expect(row.locator(".flag-card")).toHaveCount(1);
  await field.fill("I want to build data pipelines for clinics.");
  await expect(row.locator(".flag-card")).toHaveCount(0, { timeout: 15_000 });
});

test("Keep asks once, then clears the flag and records the student's choice", async () => {
  test.setTimeout(150_000);
  const api = new FakeApi().queue({ id: "job-0", apply_url: LUMEN });
  const { name, row } = await flaggedLumen(api);

  await row.getByRole("button", { name: "Keep", exact: true }).click();
  expect(api.flagAnswers).toEqual([]);
  await row.getByRole("button", { name: "Yes, keep it" }).click();
  await expect.poll(() => api.flagAnswers).toEqual([{ jobId: "job-0", action: "keep", name }]);
  await expect(row.locator(".flag-card")).toHaveCount(0);
  await expect.poll(() => groupOf(loaded.worker, LUMEN), { timeout: 15_000 }).toBe("Ready");
});

test("Rewrite with Claude sends the answer back and fills the new one", async () => {
  test.setTimeout(150_000);
  const api = new FakeApi().queue({ id: "job-0", apply_url: LUMEN });
  const { name, form, row } = await flaggedLumen(api);

  await row.getByRole("button", { name: "Rewrite with Claude" }).click();
  await expect.poll(() => api.flagAnswers).toEqual([{ jobId: "job-0", action: "rewrite", name }]);
  // Waiting for the student's Claude: Write with Claude shows, and the tab still needs the student.
  await expect(row.getByRole("link", { name: "Write with Claude" })).toBeVisible();
  await expect(row.locator(".flag-card")).toContainText("Sent back to your Claude");
  await new Promise((done) => setTimeout(done, 3_000)); // past the edit pause: the old text isn't taken as an edit
  expect(api.own).toEqual([]);
  await expect.poll(() => groupOf(loaded.worker, LUMEN)).toBe("Needs you");

  const rewritten = "I want to help Lumen Health reach the patients who need care first.";
  api.saveAnswer("job-0", name, rewritten);
  await expect(form.locator(`[name='${name}']`)).toHaveValue(rewritten, { timeout: 20_000 });
  await expect(row.locator(".flag-card")).toHaveCount(0);
  await expect.poll(() => groupOf(loaded.worker, LUMEN), { timeout: 15_000 }).toBe("Ready");
});
