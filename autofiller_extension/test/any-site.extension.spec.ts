// Any posting on a job system WorkIt fills (KAN-369), not only WorkIt's own
// feed: a posting the API has never heard of fills from the panel as a feed
// job does; a job system's form embedded in an employer's careers page fills
// in its frame; and on an employer's own careers site (a host the manifest
// doesn't list) the toolbar popup offers Allow WorkIt on <host>, after which
// the panel runs there (background/site-access.js), and the options page's
// Remove takes it off again. The fake API lists no job at all. Nothing is
// ever submitted.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { FakeWorkdays, SavedForms } from "./fake-job-systems";
import { EXTENSION_ID, loadExtension, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";
// How Anduril heard of the student: a guess, a row the fill always shows.
const HEARD = "question_13130335007";
// An employer's careers page that embeds the job system's form in an iframe.
const EMBEDDING = "https://careers.anduril-example.test/open-roles/apply?gh_jid=4567";
// A SuccessFactors posting on an employer's own careers site (the Fill engine's saved Acuity page).
const SF_HOST = "careers.acuityinc.com";
const SF_POSTING = `https://${SF_HOST}/job/Data-and-AI-Intern-Flexible/1434321900/`;
const SF_PAGE = readFileSync(join(__dirname, "../fill-engine/test/fixtures/forms/successfactors-acuity/posting.html"), "utf8");
// A Workday career site on the employer's own domain: Workday's pages, marked as Workday's (fill-engine src/marks.ts).
const WD_HOST = "careers.example-employer.com";
// An employer site with no application WorkIt fills.
const PLAIN_HOST = "jobs.example-employer.com";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const html = (body: string) => ({ headers: { "content-type": "text/html" }, body });
const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");

async function start(handlers: Handler[], grantHosts: string[] = []): Promise<{ forms: SavedForms; api: FakeApi }> {
  const forms = new SavedForms([ANDURIL]);
  const api = new FakeApi(); // no queue, no saved job: WorkIt's feed doesn't have the posting
  loaded = await loadExtension([api.handler, webapp, forms.handler, ...handlers], { grantHosts });
  await signIn(loaded.context);
  return { forms, api };
}

const tabIdOf = (page: Page) => loaded.worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id!, page.url());
const registered = () => loaded.worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));

async function openPopup(tabId: number): Promise<Page> {
  const popup = await loaded.context.newPage();
  await popup.goto(`chrome-extension://${EXTENSION_ID}/src/popup/popup.html?tab=${tabId}`);
  await expect(popup.getByText("WorkIt can't fill this site yet")).toBeVisible();
  return popup;
}

test("a posting not in WorkIt's feed, on its job system's own site, shows the panel and fills", async () => {
  test.setTimeout(120_000);
  const { forms, api } = await start([]);
  const page = await loaded.context.newPage();
  await page.goto(forms.url(ANDURIL));
  await expect(hostOf(page).getByRole("button", { name: "Show WorkIt panel" })).toBeVisible({ timeout: 15_000 });
  await hostOf(page).getByRole("button", { name: "Show WorkIt panel" }).click();
  await hostOf(page).getByRole("button", { name: "Autofill This Page" }).click();
  await expect(hostOf(page).locator(`[data-key="${HEARD}"] .source`)).toHaveText("Guessed", { timeout: 60_000 });
  await expect(page.locator("#first_name")).not.toHaveValue("");
  // No application or saved job was needed, nor made.
  expect(api.stages.size).toBe(0);
  expect(forms.submissions).toEqual([]);
});

test("an employer's careers page embedding the job system's form: the panel shows in the form and fills it", async () => {
  test.setTimeout(120_000);
  let formUrl = "";
  const employer: Handler = ({ url }) =>
    url.hostname === new URL(EMBEDDING).hostname
      ? html(`<!doctype html><title>Careers</title><h1>Software Engineer</h1><iframe src="${formUrl}" style="width:100%;height:3000px;border:0"></iframe>`)
      : undefined;
  const { forms } = await start([employer]);
  formUrl = forms.url(ANDURIL);
  const page = await loaded.context.newPage();
  await page.goto(EMBEDDING);
  const form = page.frameLocator("iframe");
  const edge = form.locator("#workit-autofiller-overlay-host").getByRole("button", { name: "Show WorkIt panel" });
  await expect(edge).toBeVisible({ timeout: 20_000 });
  await edge.click();
  await form.locator("#workit-autofiller-overlay-host").getByRole("button", { name: "Autofill This Page" }).click();
  await expect(form.locator(`#workit-autofiller-overlay-host [data-key="${HEARD}"] .source`)).toHaveText("Guessed", { timeout: 60_000 });
  await expect(form.locator("#first_name")).not.toHaveValue("");
  // The employer's own page got nothing drawn: the extension can't see in there.
  await expect(hostOf(page)).toHaveCount(0);
  expect(forms.submissions).toEqual([]);
});

test("Allow WorkIt on an employer's careers site: the panel runs on its posting, and Remove takes it off", async () => {
  test.setTimeout(120_000);
  const site: Handler = ({ url }) => (url.hostname === SF_HOST ? html(SF_PAGE) : undefined);
  // The copy holds the site's permission, standing in for the grant Chrome's own prompt gives (no test can press it).
  await start([site], [`https://${SF_HOST}/*`]);
  const page = await loaded.context.newPage();
  await page.goto(SF_POSTING);
  await page.waitForTimeout(2500);
  // Not allowed yet: nothing runs there.
  await expect(hostOf(page)).toHaveCount(0);
  expect(await registered()).toEqual([]);

  const popup = await openPopup(await tabIdOf(page));
  const allow = popup.getByRole("button", { name: `Allow WorkIt on ${SF_HOST}` });
  await expect(allow).toBeVisible();
  await allow.click();
  await expect(popup.getByText("WorkIt can fill this page")).toBeVisible();
  await expect(popup.getByText("Its panel is open at the right edge of the page.")).toBeVisible();
  await expect(hostOf(page).locator(".panel")).toBeVisible();
  expect(await registered()).toEqual([`site-${SF_HOST}`]);

  // The posting is SuccessFactors' (the engine's own reading): its Apply and sign-in come first.
  await hostOf(page).getByRole("button", { name: "Autofill This Page" }).click();
  await expect(hostOf(page).getByText("Press Apply on this page and sign in to SuccessFactors. WorkIt fills the application there.")).toBeVisible({ timeout: 30_000 });

  // A new page on the site gets the panel by itself, from the registered scripts.
  const again = await loaded.context.newPage();
  await again.goto(SF_POSTING);
  await expect(hostOf(again).getByRole("button", { name: "Show WorkIt panel" })).toBeVisible({ timeout: 15_000 });

  // The options page lists it; Remove gives the permission back and stops the scripts.
  const removed: string[] = [];
  await loaded.worker.evaluate(() => {
    // A required permission (the test copy's) can't be removed: stand in for Chrome's removal.
    (globalThis as any).removedOrigins = [];
    chrome.permissions.remove = (async ({ origins }: { origins: string[] }) => ((globalThis as any).removedOrigins.push(...origins), true)) as any;
  });
  const options = await loaded.context.newPage();
  await options.goto(`chrome-extension://${EXTENSION_ID}/src/options/options.html`);
  await expect(options.locator("#sites")).toContainText(SF_HOST);
  await options.getByRole("button", { name: `Remove ${SF_HOST}` }).click();
  await expect(options.getByText(`Removed. WorkIt no longer runs on ${SF_HOST}.`)).toBeVisible();
  await expect(options.locator("#sites")).toHaveText("None yet.");
  removed.push(...(await loaded.worker.evaluate(() => (globalThis as any).removedOrigins)));
  expect(removed).toEqual([`https://${SF_HOST}/*`]);
  expect(await registered()).toEqual([]);
});

test("an allowed site with nothing WorkIt fills says so, and keeps Request this job system", async () => {
  const site: Handler = ({ url }) =>
    url.hostname === PLAIN_HOST ? html("<!doctype html><title>Intern</title><h1>Software Intern</h1><form><input name=email></form>") : undefined;
  const { api } = await start([site], [`https://${PLAIN_HOST}/*`]);
  const page = await loaded.context.newPage();
  await page.goto(`https://${PLAIN_HOST}/careers/42`);
  const popup = await openPopup(await tabIdOf(page));
  await popup.getByRole("button", { name: `Allow WorkIt on ${PLAIN_HOST}` }).click();
  await expect(popup.getByText("WorkIt found no application it fills on this page. Request this job system to ask for it.")).toBeVisible();
  await expect(popup.getByRole("button", { name: "Request this job system" })).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(hostOf(page).getByRole("button", { name: "Show WorkIt panel" })).toHaveCount(0);
  // Opened again, it no longer asks to allow the site.
  const again = await openPopup(await tabIdOf(page));
  await expect(again.getByRole("button", { name: `Allow WorkIt on ${PLAIN_HOST}` })).toBeHidden();
  expect(api.systemRequests).toEqual([]);
});

test("a Workday career site on an employer's own domain, once allowed, is Workday's: its step fills", async () => {
  test.setTimeout(120_000);
  const workdays = new FakeWorkdays(["workday-caci"], undefined, [{ host: WD_HOST }]);
  await start([workdays.handler], [`https://${WD_HOST}/*`]);
  const page = await loaded.context.newPage();
  await page.goto(workdays.url(0));
  await page.waitForTimeout(2500);
  // Not allowed yet: its link names no job system, so nothing runs there.
  await expect(hostOf(page)).toHaveCount(0);

  const popup = await openPopup(await tabIdOf(page));
  await popup.getByRole("button", { name: `Allow WorkIt on ${WD_HOST}` }).click();
  await expect(popup.getByText("WorkIt can fill this page")).toBeVisible();
  await expect(hostOf(page).locator(".panel")).toBeVisible();
  await hostOf(page).getByRole("button", { name: "Fill this step" }).click();
  await expect(page.locator("[data-automation-id='formField-legalName--firstName'] input")).toHaveValue("Test", { timeout: 60_000 });
  await expect(page.locator("[data-automation-id='formField-legalName--lastName'] input")).toHaveValue("Person");
  expect(workdays.submissions).toEqual([]);
});
