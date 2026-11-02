// The per-job-system off switch (KAN-467): WorkIt's API lists the job
// systems an admin turned off (GET /extension/config), and the extension
// fills none of them: the panel says "WorkIt can't fill Workday right now"
// in place of its button, and a batch tab needs the student with nothing
// filled. The list is read at most every 15 minutes; when it can't be read,
// the last copy holds, and with none every job system fills. Saved forms
// and the fake API only; nothing is ever submitted.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { FakeWorkdays, SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Loaded } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";
const WORKDAY_OFF = [{ job_system: "workday", name: "Workday" }];

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");
const edgeTab = (page: Page) => hostOf(page).getByRole("button", { name: "Show WorkIt panel" });
const primary = (page: Page) => hostOf(page).locator('[data-slot="primary"]');

/** The config the extension keeps is 15 minutes old: its next read asks the API again. */
async function age(loaded: Loaded) {
  await loaded.worker.evaluate(async () => {
    const kept = (await chrome.storage.local.get("workit_remote_config")).workit_remote_config;
    if (kept) await chrome.storage.local.set({ workit_remote_config: { ...kept, at: Date.now() - 15 * 60 * 1000 } });
  });
}

/** A Workday step page, opened by the student, with its panel open. */
async function workdayPanel(loaded: Loaded, workdays: FakeWorkdays): Promise<Page> {
  const page = await loaded.context.newPage();
  await page.goto(workdays.url(0));
  await edgeTab(page).click({ timeout: 15_000 });
  return page;
}

test("a job system turned off shows WorkIt can't fill it in the panel, and turned on again, the fill's button", async () => {
  test.setTimeout(90_000);
  const workdays = new FakeWorkdays(["workday-caci"]);
  const api = new FakeApi();
  api.disabledJobSystems = WORKDAY_OFF;
  loaded = await loadExtension([api.handler, webapp, workdays.handler]);
  await signIn(loaded.context);

  const page = await workdayPanel(loaded, workdays);
  await expect(primary(page)).toContainText("WorkIt can't fill Workday right now");
  await expect(primary(page).getByRole("button")).toHaveCount(0);

  // Turned on again: the next read, 15 minutes on, gives the button back.
  api.disabledJobSystems = [];
  await age(loaded);
  await page.reload();
  await edgeTab(page).click({ timeout: 15_000 });
  await expect(primary(page).getByRole("button", { name: "Fill this step" })).toBeVisible();
  await expect(primary(page)).not.toContainText("can't fill");
});

test("another job system still fills while Workday is off", async () => {
  const forms = new SavedForms([ANDURIL]);
  const api = new FakeApi();
  api.disabledJobSystems = WORKDAY_OFF;
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const page = await loaded.context.newPage();
  await page.goto(forms.url(ANDURIL));
  await edgeTab(page).click({ timeout: 15_000 });
  await expect(primary(page).getByRole("button", { name: "Autofill This Page" })).toBeVisible();
});

test("when the config can't be read, the last copy holds; with none, the job system fills as normal", async () => {
  test.setTimeout(120_000);
  const workdays = new FakeWorkdays(["workday-caci"]);
  const api = new FakeApi();
  api.configDown = true;
  loaded = await loadExtension([api.handler, webapp, workdays.handler]);
  await signIn(loaded.context);

  // No copy yet, and the API down: Workday fills.
  const page = await workdayPanel(loaded, workdays);
  await expect(primary(page).getByRole("button", { name: "Fill this step" })).toBeVisible();

  // Read once with Workday off, then the API goes down: the copy holds past its 15 minutes.
  api.configDown = false;
  api.disabledJobSystems = WORKDAY_OFF;
  await age(loaded);
  await page.reload();
  await edgeTab(page).click({ timeout: 15_000 });
  await expect(primary(page)).toContainText("WorkIt can't fill Workday right now");
  api.configDown = true;
  await age(loaded);
  await page.reload();
  await edgeTab(page).click({ timeout: 15_000 });
  await expect(primary(page)).toContainText("WorkIt can't fill Workday right now");
  expect(api.calls.filter((c) => c === "GET /extension/config").length).toBeGreaterThanOrEqual(3);
});

test("a batch's tab on a job system turned off needs the student, with nothing filled, and the other jobs fill", async () => {
  test.setTimeout(120_000);
  const workdays = new FakeWorkdays(["workday-caci"]);
  const forms = new SavedForms([ANDURIL]);
  const api = new FakeApi().queue({ id: "wd-0", apply_url: workdays.signInUrl(0) }, { id: "gh-0", apply_url: forms.url(ANDURIL) });
  api.disabledJobSystems = WORKDAY_OFF;
  loaded = await loadExtension([api.handler, webapp, workdays.handler, forms.handler]);
  await signIn(loaded.context);
  const app = await loaded.context.newPage();
  await app.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(app, { type: "run/open" });

  await expect.poll(() => api.stages.get("wd-0"), { timeout: 60_000 }).toBe("needs_you");
  const tab = loaded.context.pages().find((p) => p.url().startsWith(workdays.signInUrl(0).split("?")[0]))!;
  await expect(hostOf(tab).locator(".row").filter({ hasText: "WorkIt can't fill Workday right now" })).toBeAttached({ timeout: 15_000 });
  // Nothing typed into Workday's sign-in, nothing pressed.
  expect(workdays.signIns).toEqual([]);
  expect(workdays.starts).toEqual([]);
  // The Greenhouse job filled as usual.
  await expect.poll(() => api.calls.some((c) => /PUT \/applicants\/[^/]+\/applications\/gh-0\/fill/.test(c)), { timeout: 60_000 }).toBe(true);
  expect(forms.submissions).toEqual([]);
});
