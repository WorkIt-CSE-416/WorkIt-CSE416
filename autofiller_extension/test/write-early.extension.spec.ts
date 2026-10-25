// Write early, reuse saved answers, keep the student's edits (KAN-379), end
// to end through the loaded extension (spec seam 1): queueing reads each
// queued job's questions from its link before its tab opens; a question the
// answer bank holds is filled from it and never sent for the student's
// Claude; the student's own words in a written answer are saved. The API is
// faked (fake-api.ts); the backend's side is tested over MCP in
// backend/tests/test_connector_saved_answers.py.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Loaded } from "./loaded-extension";

const DATACOR = "greenhouse-datacor";
const HARVEY = "ashby-harvey";
const GOALS = "Please write a few sentences around what you are looking to gain from an internship.";
const WHY = "Why are you interested in working at Harvey?";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

async function start(api: FakeApi, forms: SavedForms): Promise<void> {
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const page = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await page.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(page, { type: "run/open" });
}

const formTabs = (forms: SavedForms, name: string): Page[] => loaded.context.pages().filter((p) => p.url().startsWith(forms.url(name)));

/** The overlay's row for one question, by its label. */
const row = (form: Page, label: string) => form.locator(".row", { hasText: label });

test("queueing reads each queued job's questions from its link before its tab opens", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([DATACOR]);
  // Six queued: five tabs open at once, the sixth only once one of them is done.
  const api = new FakeApi().queue(...Array.from({ length: 6 }, (_, n) => ({ id: `job-${n}`, apply_url: forms.url(DATACOR) })));
  await start(api, forms);

  await expect.poll(() => api.written.get("job-5"), { timeout: 60_000 }).toEqual([
    { name: expect.any(String), label: GOALS, required: true, max_length: null, answer: null },
  ]);
  // Sent before the job was handed to a tab.
  const sent = api.events.indexOf("questions:job-5");
  const opened = api.events.indexOf("next:job-5");
  expect(opened === -1 || sent < opened, api.events.join(", ")).toBe(true);
  expect(forms.submissions).toEqual([]);
});

test("a question the answer bank holds is filled from it, and never sent for the student's Claude", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([DATACOR]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(DATACOR) });
  const saved = "To learn how a real engineering team plans, builds and ships software.";
  api.bank[GOALS] = { answer: saved, own: false };
  await start(api, forms);

  await expect.poll(() => formTabs(forms, DATACOR).length, { timeout: 30_000 }).toBe(1);
  const [form] = formTabs(forms, DATACOR);
  await expect(row(form, GOALS).locator(".source")).toHaveText("Saved Answer", { timeout: 60_000 });
  expect(await form.evaluate((text) => [...document.querySelectorAll("textarea")].some((t) => t.value === text), saved)).toBe(true);
  // Nothing was left to write: no question reached the API, early or from the tab.
  expect(api.written.get("job-0") ?? []).toEqual([]);
  expect(forms.submissions).toEqual([]);
});

test("the student's own words in a written answer are saved for later forms", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([HARVEY]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(HARVEY) });
  await start(api, forms);
  await expect.poll(() => api.written.get("job-0")?.length, { timeout: 60_000 }).toBe(1);
  const name = api.written.get("job-0")![0].name;
  const [form] = formTabs(forms, HARVEY);
  const box = form.locator(`[data-field-path="${name}"] textarea`);

  // Their Claude's answer arrives and fills: WorkIt's own fill is not taken for the student's.
  api.saveAnswer("job-0", name, "I want to build legal tools that lawyers trust.");
  await expect(box).toHaveValue("I want to build legal tools that lawyers trust.", { timeout: 20_000 });
  await form.waitForTimeout(3_000);
  expect(api.own).toEqual([]);

  // The student rewrites it.
  await box.fill("I want to build tools lawyers rely on, and I learn fastest on a small team.");
  await expect.poll(() => api.own, { timeout: 15_000 }).toEqual([
    { jobId: "job-0", name, label: WHY, answer: "I want to build tools lawyers rely on, and I learn fastest on a small team." },
  ]);
  expect(forms.submissions).toEqual([]);
});
