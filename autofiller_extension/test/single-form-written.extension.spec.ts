// Written answers on a form the student opened themselves (KAN-470): WorkIt
// calls no model, so a question that needs writing gets the same two routes
// as a batch tab, the student's own Claude through the connector or their
// paste on Written Answers, once they ask for them on the panel. The job
// gets an application for that (the routes keep the questions on one), and
// waits at needs_you, out of the batch's queue. A saved answer to the same
// question fills with no asking at all. Cohere's saved Ashby form, whose
// "good fit" question needs writing.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, signIn, webapp, type Loaded } from "./loaded-extension";

const COHERE = "ashby-cohere";
const FIT = /^What makes you a good fit for Cohere\?/;
const ANSWER = "I built a retrieval tool for my school's library that answers questions about its catalog.";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");

/** Cohere's form opened by the student (no batch), filled with the panel's Autofill This Page. */
async function filledOwnTab(api: FakeApi, forms: SavedForms): Promise<Page> {
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const page = await loaded.context.newPage();
  await page.goto(forms.url(COHERE));
  await hostOf(page).getByRole("button", { name: "Show WorkIt panel" }).click({ timeout: 15_000 });
  await hostOf(page).getByRole("button", { name: "Autofill This Page" }).click();
  await expect(hostOf(page).locator('[data-slot="primary"] .primary-button').first()).toContainText(/Answer \d+ of \d+|Review and submit/, { timeout: 60_000 });
  return page;
}

/** The form's field named `name`. */
const fieldFor = (page: Page, name: string) => page.locator(`[name="${name}"]`);

test("the student's Claude or Written Answers writes a single form's question, and it fills", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([COHERE]);
  const api = new FakeApi().listed({ id: "job-0", apply_url: forms.url(COHERE), title: "Software Engineer Intern", company: "Cohere" });
  const page = await filledOwnTab(api, forms);

  const offer = hostOf(page).locator(".essay-banner");
  await expect(offer).toContainText("Claude");
  await expect(offer).toContainText("Written Answers");
  // Nothing goes to WorkIt until the student asks.
  expect(api.written.size).toBe(0);
  expect(api.stages.has("job-0")).toBe(false);

  await offer.getByRole("button", { name: "Write with Claude" }).click();
  await expect.poll(() => api.written.get("job-0")?.some((q) => FIT.test(q.label)), { timeout: 20_000 }).toBe(true);
  // An application at needs_you: the questions' home, which the batch doesn't open again.
  expect(api.stages.get("job-0")).toBe("needs_you");
  await expect(hostOf(page).getByRole("link", { name: "Written Answers" }).first()).toBeVisible();

  // The student's Claude (or their paste on Written Answers) saves the answer: within a poll it is in the form.
  const name = api.written.get("job-0")!.find((q) => FIT.test(q.label))!.name;
  api.saveAnswer("job-0", name, ANSWER);
  await expect(fieldFor(page, name)).toHaveValue(ANSWER, { timeout: 20_000 });

  // Nothing in the fill called a model.
  expect(api.calls.filter((call) => /essay/.test(call))).toEqual([]);
  expect(forms.submissions).toEqual([]);
});

test("a saved answer to the same question fills a single form, with nothing to ask", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([COHERE]);
  const api = new FakeApi().listed({ id: "job-0", apply_url: forms.url(COHERE), title: "Software Engineer Intern", company: "Cohere" });
  const label = "What makes you a good fit for Cohere? (if you've ever built something with Cohere, be sure to tell us and link it here!)";
  api.bank[label] = { answer: ANSWER, own: true };
  const page = await filledOwnTab(api, forms);

  const values = await page.locator("textarea").evaluateAll((boxes) => boxes.map((b) => (b as HTMLTextAreaElement).value));
  expect(values).toContain(ANSWER);
  expect(api.written.size).toBe(0);
  expect(api.calls.filter((call) => /essay/.test(call))).toEqual([]);
});

test("on a job WorkIt doesn't list, the question is the student's to write", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([COHERE]);
  const api = new FakeApi();
  const page = await filledOwnTab(api, forms);

  await hostOf(page).locator(".essay-banner").getByRole("button", { name: "Write with Claude" }).click();
  await expect(hostOf(page).getByText(/WorkIt doesn't list this job/).first()).toBeVisible({ timeout: 20_000 });
  expect(api.written.size).toBe(0);
  expect(api.calls.filter((call) => /essay/.test(call))).toEqual([]);
});
