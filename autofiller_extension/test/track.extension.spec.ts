// Track on WorkIt (KAN-424, background/track.js): on a job form the student
// opened themselves whose job WorkIt lists, the job card offers Track on
// WorkIt; pressed, the job is saved to their Applications, and their submit
// there marks it applied, by the same proof a batch tab's submit needs. A job
// WorkIt doesn't list offers nothing. A form the extension filled and nobody
// tracked is marked applied on its proven submit too (KAN-589): a listed job
// as it is, any other added by link first. A form the extension never filled
// is never marked. Ashby's saved Cohere form and Lever's saved Rhombus form,
// their submits faked as their pages send them.
import { expect, test, type Page } from "@playwright/test";
import { loadHar } from "../fill-engine/test/fake-job-server";
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

// Lever's saved Rhombus form (its page alone), a plain HTML post to its own link answered with a redirect to its thanks page.
const RHOMBUS = loadHar("lever-rhombus").log.entries[0];
const lever: Handler = ({ url, method }) => {
  if (url.host !== "jobs.lever.co") return undefined;
  if (method === "POST" && url.href === RHOMBUS.request.url) return { status: 302, headers: { location: url.href.replace(/\/apply$/, "/thanks") } };
  if (url.href === RHOMBUS.request.url) return { headers: { "content-type": "text/html" }, body: RHOMBUS.response.content.text };
  if (url.pathname.endsWith("/thanks")) return { headers: { "content-type": "text/html" }, body: "<!doctype html><title>Thanks</title><p>Application submitted!" };
  return { status: 404 };
};

/** A form opened by the student (no batch), filled with the panel's Autofill This Page (Cohere's unless `url`). */
async function filledOwnTab(api: FakeApi, forms: SavedForms, url = forms.url(COHERE)): Promise<Page> {
  loaded = await loadExtension([api.handler, webapp, ashbySingleOk, lever, forms.handler]);
  await signIn(loaded.context);
  const page = await loaded.context.newPage();
  await page.goto(url);
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

test("a filled form the student didn't track is marked applied on its submit", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([COHERE]);
  const api = new FakeApi().listed({ id: "job-0", apply_url: forms.url(COHERE), title: "Software Engineer Intern", company: "Cohere" });
  const page = await filledOwnTab(api, forms);
  // Still offered: the fill keeps the tab, but writes nothing until the submit.
  await expect(card(page).getByRole("button", { name: "Track on WorkIt" })).toBeVisible();
  expect(api.stages.has("job-0")).toBe(false);

  await ashbySubmits(page);
  await expect.poll(() => api.stages.get("job-0"), { timeout: 20_000 }).toBe("applied");
  await expect(hostOf(page).getByText("WorkIt marked it Applied.")).toBeVisible();
  expect(api.added).toEqual([]);
  expect(forms.submissions).toEqual([]);
});

test("a filled Lever form for a job WorkIt doesn't list is added by link and marked applied on its submit", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([]);
  const api = new FakeApi();
  const page = await filledOwnTab(api, forms, RHOMBUS.request.url);
  expect(api.added).toEqual([]);

  // The student's Submit: Lever's plain post, answered with its thanks page.
  await page.evaluate(() => {
    const form = document.createElement("form");
    form.method = "post";
    form.action = location.href;
    document.body.append(form);
    form.submit();
  });
  await page.waitForURL(/\/thanks$/);
  await expect.poll(() => api.stages.get("added-0"), { timeout: 20_000 }).toBe("applied");
  expect(api.added).toEqual([{ url: RHOMBUS.request.url, company: expect.stringMatching(/\S/), title: expect.stringMatching(/\S/), track_only: true }]);
});

test("a submit on a form the extension never filled marks nothing", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([COHERE]);
  const api = new FakeApi().listed({ id: "job-0", apply_url: forms.url(COHERE), title: "Software Engineer Intern", company: "Cohere" });
  loaded = await loadExtension([api.handler, webapp, ashbySingleOk, forms.handler]);
  await signIn(loaded.context);
  const page = await loaded.context.newPage();
  await page.goto(forms.url(COHERE));
  await hostOf(page).getByRole("button", { name: "Show WorkIt panel" }).waitFor({ timeout: 15_000 });

  await ashbySubmits(page);
  await page.waitForTimeout(3_000);
  expect(api.stages.has("job-0")).toBe(false);
  expect(api.calls.some((call) => call.includes("/applied") || call.includes("added-by-link"))).toBe(false);
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
