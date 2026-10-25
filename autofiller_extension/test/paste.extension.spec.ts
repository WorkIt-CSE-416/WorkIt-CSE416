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
  await expect(row.locator(".reason")).toHaveText(`Your Claude's check: ${flag} Read it before you submit, and edit it if it's wrong.`, { timeout: 20_000 });
  await expect(row).toHaveAttribute("data-flagged", "");
  await expect.poll(() => groupOf(loaded.worker, LUMEN), { timeout: 15_000 }).toBe("Needs you");

  // The student edits it: the flag is gone, and nothing else needs them.
  await form.locator(`[name='${name}']`).fill("I want to build data pipelines for clinics.");
  await expect(row.locator(".reason")).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => groupOf(loaded.worker, LUMEN), { timeout: 15_000 }).toBe("Ready");
});
