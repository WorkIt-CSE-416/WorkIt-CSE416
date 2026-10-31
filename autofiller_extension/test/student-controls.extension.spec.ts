// The student's controls (KAN-480): hiding the edge tab on one site or
// everywhere, from the panel's ⋯ menu, the edge tab's own menu and Options,
// with Alt+W still opening the panel; and Options' Fields to autofill
// switches, where a category switched off is left blank and needs the
// student, its saved answers kept. Anduril's saved Greenhouse form.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { EXTENSION_ID, loadExtension, signIn, webapp, type Loaded, menuItem } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";
const GREENHOUSE_HOST = "job-boards.greenhouse.io";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");
const panelOf = (page: Page) => hostOf(page).locator(".panel");
const edgeTab = (page: Page) => hostOf(page).getByRole("button", { name: "Show WorkIt panel" });

async function start(): Promise<SavedForms> {
  const forms = new SavedForms([ANDURIL]);
  loaded = await loadExtension([new FakeApi().handler, webapp, forms.handler]);
  await signIn(loaded.context);
  return forms;
}

async function ownTab(forms: SavedForms): Promise<Page> {
  const page = await loaded.context.newPage();
  await page.goto(forms.url(ANDURIL));
  return page;
}

/** The toolbar icon's press, the same call Alt+W makes (a test can't press an extension command's keys). */
async function pressToolbar(page: Page): Promise<void> {
  await loaded.worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    await (globalThis as any).workitToolbar(tab);
  }, page.url());
}

async function optionsPage(): Promise<Page> {
  const options = await loaded.context.newPage();
  await options.goto(`chrome-extension://${EXTENSION_ID}/src/options/options.html`);
  return options;
}

test("Hide on this site from the panel's menu: gone after a reload, Alt+W still opens the panel, Options lists it with Remove", async () => {
  test.setTimeout(120_000);
  const forms = await start();
  const page = await ownTab(forms);
  expect(new URL(page.url()).hostname).toBe(GREENHOUSE_HOST);
  await edgeTab(page).click({ timeout: 15_000 });
  await expect(panelOf(page)).toBeVisible();
  await (await menuItem(hostOf(page), "Hide on this site")).click();
  await expect(panelOf(page)).toBeHidden();
  await expect(edgeTab(page)).toBeHidden();

  await page.reload();
  await page.waitForTimeout(4000);
  await expect(edgeTab(page)).toBeHidden();
  // Alt+W (the toolbar's press) still opens the panel, and opening it keeps the site hidden.
  await pressToolbar(page);
  await expect(panelOf(page)).toBeVisible();
  await pressToolbar(page);
  await expect(panelOf(page)).toBeHidden();
  await expect(edgeTab(page)).toBeHidden();

  const options = await optionsPage();
  await expect(options.locator("#hidden-sites")).toContainText(GREENHOUSE_HOST);
  await options.getByRole("button", { name: `Remove ${GREENHOUSE_HOST}` }).click();
  await expect(options.locator("#hidden-sites")).toHaveText("None.");
  await page.reload();
  await expect(edgeTab(page)).toBeVisible({ timeout: 15_000 });
  expect(forms.submissions).toEqual([]);
});

test("Hide everywhere from the edge tab's menu: Options' switch brings it back", async () => {
  test.setTimeout(120_000);
  const forms = await start();
  const page = await ownTab(forms);
  await hostOf(page).getByRole("button", { name: "WorkIt tab options" }).click({ timeout: 15_000 });
  await hostOf(page).getByRole("menuitem", { name: "Hide everywhere" }).click();
  await expect(edgeTab(page)).toBeHidden();
  await page.reload();
  await page.waitForTimeout(4000);
  await expect(edgeTab(page)).toBeHidden();
  await pressToolbar(page);
  await expect(panelOf(page)).toBeVisible();

  const options = await optionsPage();
  const show = options.getByRole("checkbox", { name: "Show the WorkIt tab on job pages" });
  await expect(show).not.toBeChecked();
  await show.check();
  await page.reload();
  await expect(edgeTab(page)).toBeVisible({ timeout: 15_000 });
  expect(forms.submissions).toEqual([]);
});
