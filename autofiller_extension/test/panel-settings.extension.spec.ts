// The panel's settings view (KAN-402): the header's gear opens it in place of
// the tabs, and Back returns. It shows the student's Claude connection (Add to
// Claude, Disconnect), whether the panel opens by itself in batch tabs, Report
// a problem, and a link to the extension's own Workday Sign-Up page: the
// password is never typed in the panel, which lives in the employer's page.
// Anduril's saved Greenhouse form.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { EXTENSION_ID, loadExtension, sendFromWebapp, signIn, webapp, type Loaded } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");
const panelOf = (page: Page) => hostOf(page).locator(".panel");
const settingsOf = (page: Page) => hostOf(page).locator('[data-slot="settings"]');
const edgeTab = (page: Page) => hostOf(page).getByRole("button", { name: "Show WorkIt panel" });

async function start(api: FakeApi, forms: SavedForms): Promise<void> {
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
}

/** Anduril's form opened by the student, its panel opened from the edge tab, then the gear. */
async function openSettings(forms: SavedForms): Promise<Page> {
  const page = await loaded.context.newPage();
  await page.goto(forms.url(ANDURIL));
  await edgeTab(page).click({ timeout: 15_000 });
  await hostOf(page).getByRole("button", { name: "Settings" }).click();
  await expect(settingsOf(page)).toBeVisible();
  return page;
}

test("settings show the student's Claude connection, and Disconnect and Add to Claude work", async () => {
  test.setTimeout(90_000);
  const forms = new SavedForms([ANDURIL]);
  const api = new FakeApi();
  api.connectorAdded = true;
  await start(api, forms);
  const page = await openSettings(forms);
  const claude = settingsOf(page).locator(".claude");

  await expect(claude).toContainText("Your Claude is connected.");
  await claude.getByRole("button", { name: "Disconnect" }).click();
  await expect(claude).toContainText("Your Claude isn't connected.");
  expect(api.calls.filter((call) => /^DELETE \/applicants\/[^/]+\/connector$/.test(call))).toHaveLength(1);

  const opened = loaded.context.waitForEvent("page");
  await claude.getByRole("button", { name: "Add to Claude" }).click();
  await expect.poll(async () => (await opened).url()).toBe("http://localhost:3000/connect/claude/add");
});

test("with Open the panel by itself off, a batch tab's panel stays closed until the student opens it", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([ANDURIL]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(ANDURIL) });
  await start(api, forms);
  const page = await openSettings(forms);
  const autoOpen = settingsOf(page).getByRole("checkbox", { name: /Open the panel by itself/ });
  await expect(autoOpen).toBeChecked();
  await autoOpen.uncheck();
  await settingsOf(page).getByRole("button", { name: "Back" }).click();
  await expect(settingsOf(page)).toBeHidden();
  await expect(hostOf(page).getByRole("button", { name: "Autofill This Page" })).toBeVisible();
  await page.close();

  const app = await loaded.context.newPage();
  await app.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(app, { type: "run/open" });
  await expect.poll(() => api.stages.get("job-0"), { timeout: 60_000 }).toBe("needs_you");
  const form = loaded.context.pages().find((p) => p.url() === forms.url(ANDURIL) && !p.isClosed())!;
  await expect(edgeTab(form)).toBeVisible({ timeout: 15_000 });
  await expect(panelOf(form)).toBeHidden();
  await edgeTab(form).click();
  await expect(panelOf(form)).toBeVisible();
  await expect(hostOf(form).locator(".row").first()).toBeVisible();
});

test("the gear opens settings and Back returns; Workday Sign-Up opens the extension's own page, and no password is asked in the panel", async () => {
  test.setTimeout(90_000);
  const forms = new SavedForms([ANDURIL]);
  await start(new FakeApi(), forms);
  const page = await openSettings(forms);
  // The tabs give way to the view (an empty Autofill tab has no size, so its hidden property says it).
  await expect(hostOf(page).locator("[data-tabs]")).toHaveJSProperty("hidden", true);
  await expect(hostOf(page).locator('input[type="password"]')).toHaveCount(0);

  const opened = loaded.context.waitForEvent("page");
  await settingsOf(page).getByRole("button", { name: "Workday Sign-Up" }).click();
  await expect.poll(async () => (await opened).url()).toBe(`chrome-extension://${EXTENSION_ID}/src/options/options.html`);

  await settingsOf(page).getByRole("button", { name: "Report a problem" }).click();
  await expect(hostOf(page).locator('[data-slot="report"]')).toBeVisible();
  await expect(settingsOf(page)).toBeHidden();

  await hostOf(page).getByRole("button", { name: "Settings" }).click();
  await settingsOf(page).getByRole("button", { name: "Back" }).click();
  await expect(settingsOf(page)).toBeHidden();
  await expect(hostOf(page).locator("[data-tabs]")).toHaveJSProperty("hidden", false);
  await expect(hostOf(page).getByRole("button", { name: "Autofill This Page" })).toBeVisible();
});
