// The panel's other states (KAN-401): signed out, a site WorkIt can't fill
// (the toolbar popup), a submit WorkIt saw, and a failed request. A failed
// request is a plain sentence with Try again, never a status code. Saved
// forms and the fake API only; nothing is ever submitted.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { EXTENSION_ID, loadExtension, sendFromWebapp, signIn, webapp, type Loaded } from "./loaded-extension";

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

test("the toolbar popup's failed profile read is a sentence with Try again, which reads it again", async () => {
  const api = new FakeApi();
  api.profileDown = true;
  loaded = await loadExtension([api.handler, webapp]);
  await signIn(loaded.context);
  const popup = await loaded.context.newPage();
  await popup.goto(`chrome-extension://${EXTENSION_ID}/src/popup/popup.html`);

  await expect(popup.getByText("WorkIt couldn't load your profile.")).toBeVisible();
  await expect(popup.locator("#root")).not.toContainText(STATUS_CODE);
  await expect(popup.locator("#root")).not.toContainText("Internal Server Error");
  api.profileDown = false;
  await popup.getByRole("button", { name: "Try again" }).click();
  await expect(popup.getByRole("button", { name: "Open WorkIt" })).toBeVisible();
});

test("signed out, the panel shows the job card and Sign in to WorkIt only; signed in again, Autofill This Page", async () => {
  test.setTimeout(90_000);
  const forms = new SavedForms([ANDURIL]);
  loaded = await loadExtension([new FakeApi().handler, webapp, forms.handler]);
  const page = await loaded.context.newPage();
  await page.goto(forms.url(ANDURIL));
  await edgeTab(page).click({ timeout: 15_000 });

  const primary = hostOf(page).locator('[data-slot="primary"]');
  await expect(primary.getByRole("button", { name: "Sign in to WorkIt" })).toBeVisible();
  await expect(primary.getByRole("button", { name: "Autofill This Page" })).toHaveCount(0);
  await expect(hostOf(page).locator('[data-slot="job-card"]')).toContainText("Anduril");
  await expect(hostOf(page).locator(".tabs")).toBeHidden();
  await expect(hostOf(page).locator("[data-tabs]")).toBeHidden();

  const opened = loaded.context.waitForEvent("page");
  await primary.getByRole("button", { name: "Sign in to WorkIt" }).click();
  const login = await opened;
  await expect.poll(() => login.url()).toBe("http://localhost:3000/login");

  // The student signs in in that tab and comes back.
  await signIn(loaded.context);
  await login.close();
  await page.bringToFront();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(primary.getByRole("button", { name: "Autofill This Page" })).toBeVisible();
  await expect(hostOf(page).locator(".tabs")).toBeVisible();
});

test("a batch tab's submit shows Sent with Next job, and I didn't submit this sets the application back", async () => {
  test.setTimeout(180_000);
  const COHERE = "ashby-cohere";
  const forms = new SavedForms([COHERE, ANDURIL]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(COHERE) }, { id: "job-1", apply_url: forms.url(ANDURIL) });
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const app = await loaded.context.newPage();
  await app.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(app, { type: "run/open" });
  await expect.poll(() => api.calls.filter((c) => /\/job-[01]\/fill$/.test(c)).length, { timeout: 90_000 }).toBeGreaterThanOrEqual(2);
  const page = loaded.context.pages().find((p) => p.url().startsWith(forms.url(COHERE).split("?")[0]))!;
  await page.bringToFront();
  const host = hostOf(page);
  await host.locator("[data-submitted]").click();

  const primary = host.locator('[data-slot="primary"]');
  await expect(primary.getByText("Sent · Marked applied on WorkIt")).toBeVisible({ timeout: 15_000 });
  expect(api.stages.get("job-0")).toBe("applied");
  await expect(primary.getByRole("button", { name: "Next Thing" })).toBeHidden();

  await primary.getByRole("button", { name: "I didn't submit this" }).click();
  await expect.poll(() => api.stages.get("job-0")).toBe("queued");
  await expect(primary.getByText("Sent · Marked applied on WorkIt")).toBeHidden();
  await expect(primary.locator(".primary-button").first()).toBeVisible();

  // Sent again: Next job goes to the tab that still needs the student.
  await host.locator("[data-submitted]").click();
  await expect(primary.getByText("Sent · Marked applied on WorkIt")).toBeVisible({ timeout: 15_000 });
  await primary.getByRole("button", { name: "Next job →" }).click();
  await expect.poll(() => loaded.worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url)).toContain("greenhouse");
});
