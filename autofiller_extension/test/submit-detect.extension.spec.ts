// Batch apply (KAN-369): the student's submit on Workable and on an Ashby
// posting with no survey forms marks the application applied, also after the
// panel is closed, and the panel's "I submitted this" marks it when detection
// misses. Each job system's submit is faked as its own page sends it (Ashby's
// GraphQL mutation by fetch, Workable's apply by XHR, as its axios does), then
// its page's notice of a sent application, answered by the fake network; no
// real job system is reached.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms, SavedWorkable } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Handler, type Loaded, menuItem } from "./loaded-extension";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

// Ashby's page sends this one, not ApiSubmitMultipleFormsAction, for a posting with no survey forms (Cohere's).
const ASHBY_SINGLE = "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSubmitSingleApplicationFormAction";
const ashbySingleOk: Handler = ({ url }) =>
  url.href === ASHBY_SINGLE
    ? { json: { data: { submitApplicationFormAction: { applicationFormResult: { __typename: "FormSubmitSuccess" }, messages: { blockMessageForCandidateHtml: null } } } } }
    : undefined;

/** Runs a batch of one form and resolves to its tab once the engine watches it for the submit. */
async function batchOf(api: FakeApi, url: string, handlers: Handler[]): Promise<Page> {
  api.queue({ id: "job-0", apply_url: url });
  loaded = await loadExtension([api.handler, webapp, ...handlers]);
  await signIn(loaded.context);
  const webappPage = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await webappPage.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(webappPage, { type: "run/open" });
  const base = url.split("?")[0];
  await expect.poll(() => loaded.context.pages().some((p) => p.url().startsWith(base)), { timeout: 60_000 }).toBe(true);
  const page = loaded.context.pages().find((p) => p.url().startsWith(base))!;
  await page.waitForFunction(() => (window as any).__fillEngineSubmitWatch, undefined, { timeout: 60_000 });
  // The fill is done (its result recorded) and the panel shows, as when the student comes to the tab.
  await expect.poll(() => api.calls.some((c) => c.endsWith("/job-0/fill")), { timeout: 60_000 }).toBe(true);
  await expect(page.locator("#workit-autofiller-overlay-host")).toHaveCount(1);
  await page.bringToFront();
  return page;
}

/** Ashby's page on a sent single-form application: its answer, then its success notice. */
async function ashbySubmits(page: Page): Promise<void> {
  await page.evaluate((url) => fetch(url, { method: "POST", body: "{}" }), ASHBY_SINGLE);
  await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", '<div class="ashby-application-form-success-container">Thanks</div>'));
}

const panel = (page: Page) => page.locator("#workit-autofiller-overlay-host");

test("an Ashby posting with no survey forms: the student's submit marks it applied and the panel says so", async () => {
  const forms = new SavedForms(["ashby-cohere"]);
  const api = new FakeApi();
  const page = await batchOf(api, forms.url("ashby-cohere"), [ashbySingleOk, forms.handler]);

  await ashbySubmits(page);

  await expect.poll(() => api.stages.get("job-0"), { timeout: 20_000 }).toBe("applied");
  await expect(panel(page).getByText("WorkIt marked it Applied.")).toBeVisible();
});

test("a Workable submit marks the application applied", async () => {
  const form = new SavedWorkable("workable-enfos");
  const api = new FakeApi();
  const page = await batchOf(api, form.url, [form.handler]);

  // Workable's page posts the application (axios, so an XHR), then shows its thanks in place.
  await page.evaluate(
    () =>
      new Promise((done) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "https://apply.workable.com/api/v1/jobs/CA15908E0A/apply");
        xhr.setRequestHeader("content-type", "application/json");
        xhr.onloadend = done;
        xhr.send(JSON.stringify({ candidate: {} }));
      }),
  );
  await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", "<h2>Thank you!</h2><p>Your application has been submitted successfully.</p>"));

  await expect.poll(() => api.stages.get("job-0"), { timeout: 20_000 }).toBe("applied");
});

test("a submit made after the student closed the panel still marks it applied", async () => {
  const forms = new SavedForms(["ashby-cohere"]);
  const api = new FakeApi();
  const page = await batchOf(api, forms.url("ashby-cohere"), [ashbySingleOk, forms.handler]);
  await panel(page).locator("[data-close]").click();
  await expect(panel(page).locator(".panel")).toBeHidden();

  await ashbySubmits(page);

  await expect.poll(() => api.stages.get("job-0"), { timeout: 20_000 }).toBe("applied");
});

test("the panel's I submitted this marks the application applied when no submit was seen", async () => {
  const forms = new SavedForms(["ashby-cohere"]);
  const api = new FakeApi();
  const page = await batchOf(api, forms.url("ashby-cohere"), [forms.handler]);

  // A click the page makes itself (a script on the employer's page) is not the student's.
  await panel(page).locator("[data-submitted]").evaluate((button: HTMLElement) => button.click());
  await page.waitForTimeout(1_500);
  expect(api.calls.filter((c) => c.endsWith("/finish"))).toEqual([]);

  await (await menuItem(panel(page), "I submitted this")).click();

  await expect.poll(() => api.stages.get("job-0"), { timeout: 15_000 }).toBe("applied");
  await expect(panel(page).getByText("WorkIt marked it Applied.")).toBeVisible();
});
