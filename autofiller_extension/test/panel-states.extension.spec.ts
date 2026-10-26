// The panel's other states (KAN-401): signed out, a site WorkIt can't fill
// (the toolbar popup), a submit WorkIt saw, and a failed request. A failed
// request is a plain sentence with Try again, never a status code. Saved
// forms and the fake API only; nothing is ever submitted.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, signIn, webapp, type Loaded } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");
const edgeTab = (page: Page) => hostOf(page).getByRole("button", { name: "Show WorkIt panel" });
const STATUS_CODE = /\b[45]\d\d\b|Request failed/;

test("the settings view's Claude read that fails says so in a sentence, and Try again reads it again", async () => {
  test.setTimeout(90_000);
  const forms = new SavedForms([ANDURIL]);
  const api = new FakeApi();
  api.connectorAdded = true;
  api.connectorDown = 99;
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const page = await loaded.context.newPage();
  await page.goto(forms.url(ANDURIL));
  await edgeTab(page).click({ timeout: 15_000 });
  await hostOf(page).getByRole("button", { name: "Settings" }).click();
  const claude = hostOf(page).locator('[data-slot="settings"] .claude');

  await expect(claude).toContainText("WorkIt couldn't check your Claude.");
  await expect(claude).not.toContainText(STATUS_CODE);
  api.connectorDown = 0;
  await claude.getByRole("button", { name: "Try again" }).click();
  await expect(claude).toContainText("Your Claude is connected.");
  await expect(claude.getByRole("button", { name: "Disconnect" })).toBeVisible();
});
