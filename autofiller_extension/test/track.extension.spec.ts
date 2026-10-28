// Track on WorkIt (KAN-424, background/track.js): on a job form the student
// opened themselves whose job WorkIt lists, the job card offers Track on
// WorkIt; pressed, the job is saved to their Applications, and their submit
// there marks it applied, by the same proof a batch tab's submit needs. A
// form nobody tracked is never marked, and a job WorkIt doesn't list offers
// nothing. Ashby's saved Cohere form, its submit faked as its page sends it.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

const COHERE = "ashby-cohere";
const ASHBY_SINGLE = "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSubmitSingleApplicationFormAction";
const ashbySingleOk: Handler = ({ url }) =>
  url.href === ASHBY_SINGLE
    ? { json: { data: { submitApplicationFormAction: { applicationFormResult: { __typename: "FormSubmitSuccess" }, messages: { blockMessageForCandidateHtml: null } } } } }
    : undefined;

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");
const card = (page: Page) => hostOf(page).locator('[data-slot="job-card"]');

/** Cohere's form opened by the student (no batch), filled with the panel's Autofill This Page. */
async function filledOwnTab(api: FakeApi, forms: SavedForms): Promise<Page> {
  loaded = await loadExtension([api.handler, webapp, ashbySingleOk, forms.handler]);
  await signIn(loaded.context);
  const page = await loaded.context.newPage();
  await page.goto(forms.url(COHERE));
  await hostOf(page).getByRole("button", { name: "Show WorkIt panel" }).click({ timeout: 15_000 });
  await hostOf(page).getByRole("button", { name: "Autofill This Page" }).click();
  await expect(hostOf(page).locator('[data-slot="primary"] .primary-button').first()).toContainText(/Answer \d+ of \d+|Review and submit/, { timeout: 60_000 });
  return page;
}

/** Ashby's page on a sent application: its answer, then its success notice. */
async function ashbySubmits(page: Page): Promise<void> {
  await page.evaluate((url) => fetch(url, { method: "POST", body: "{}" }), ASHBY_SINGLE);
  await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", '<div class="ashby-application-form-success-container">Thanks</div>'));
}

test("Track on WorkIt saves a listed job, and the student's submit there marks it applied", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([COHERE]);
  const api = new FakeApi().listed({ id: "job-0", apply_url: forms.url(COHERE), title: "Software Engineer Intern", company: "Cohere" });
  const page = await filledOwnTab(api, forms);

  const track = card(page).getByRole("button", { name: "Track on WorkIt" });
  await expect(track).toBeVisible();
  // Asking writes nothing: the job isn't saved until the student presses.
  expect(api.stages.has("job-0")).toBe(false);
  await track.click();
  await expect(card(page)).toContainText("Tracked on WorkIt. Your submit here marks it Applied.");
  expect(api.stages.get("job-0")).toBe("saved");

  await ashbySubmits(page);
  await expect.poll(() => api.stages.get("job-0"), { timeout: 20_000 }).toBe("applied");
  await expect(hostOf(page).getByText("WorkIt marked it Applied.")).toBeVisible();
  expect(forms.submissions).toEqual([]);
});

test("a form the student didn't track is never marked applied", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([COHERE]);
  const api = new FakeApi().listed({ id: "job-0", apply_url: forms.url(COHERE), title: "Software Engineer Intern", company: "Cohere" });
  const page = await filledOwnTab(api, forms);
  await expect(card(page).getByRole("button", { name: "Track on WorkIt" })).toBeVisible();

  await ashbySubmits(page);
  await page.waitForTimeout(3_000);
  expect(api.stages.has("job-0")).toBe(false);
  expect(api.calls.some((call) => call.includes("/applied"))).toBe(false);
  await expect(hostOf(page).getByText("WorkIt marked it Applied.")).toHaveCount(0);
});

test("a job WorkIt doesn't list offers no Track on WorkIt", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([COHERE]);
  const api = new FakeApi();
  const page = await filledOwnTab(api, forms);
  // The panel asked (the answer was a 404), and offers nothing.
  await expect.poll(() => api.calls.some((call) => call === "POST /jobs/listed-by-link")).toBe(true);
  await page.waitForTimeout(1_000);
  await expect(card(page).getByRole("button", { name: "Track on WorkIt" })).toHaveCount(0);
});
