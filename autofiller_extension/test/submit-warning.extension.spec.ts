// Batch apply's submit warning (KAN-369), end to end: the student presses the
// employer's own Submit in a batch tab that still has something open (here a
// required field they emptied), and WorkIt's panel says what, before the form
// sends. Show me goes to it; Submit anyway lets the student's next Submit go
// through. WorkIt never submits, and never stops a tab with nothing open. The
// unpacked extension runs in Chromium (loaded-extension.ts), against the fake
// WorkIt API (fake-api.ts) and a saved Greenhouse form (fake-job-systems.ts),
// which records each submission it gets.
import { expect, test, type Page, type Worker } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Loaded } from "./loaded-extension";

const ARC = "greenhouse-arc";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

/** The group of the tab showing `url` ("" outside any group). */
function groupOf(worker: Worker, url: string): Promise<string | undefined> {
  return worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url?.startsWith(url));
    if (!tab) return undefined;
    return tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE ? "" : (await chrome.tabGroups.get(tab.groupId)).title;
  }, url);
}

/** Starts a batch of Arc's saved form, waits for its tab to be Ready, switches to it, and picks the Country Greenhouse needs. */
async function readyArc(forms: SavedForms): Promise<Page> {
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(ARC) });
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const webappPage = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await webappPage.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(webappPage, { type: "run/open" });
  await expect.poll(() => groupOf(loaded.worker, forms.url(ARC)), { timeout: 60_000 }).toBe("Ready");
  const form = loaded.context.pages().find((p) => p.url() === forms.url(ARC))!;
  await form.bringToFront();
  await form.locator("#country").pressSequentially("United States");
  await form.getByRole("option", { name: /United States/ }).first().waitFor();
  await form.locator("#country").press("Enter");
  return form;
}

/** The student empties First Name, which the form requires: the tab has one thing open. */
async function emptyFirstName(form: Page, forms: SavedForms): Promise<void> {
  await form.locator("#first_name").fill("");
  await expect.poll(() => groupOf(loaded.worker, forms.url(ARC)), { timeout: 15_000 }).toBe("Needs you");
}

/**
 * The student's Claude's pre-submit review flags the filled Email (written-answers.js's review puts
 * the flag on its row): one thing open that the form itself doesn't stop a submit for. Set on the
 * tab's row from the extension's own world, where the panel's rows live.
 */
async function flagEmail(form: Page, forms: SavedForms): Promise<void> {
  await loaded.worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url?.startsWith(url))!;
    await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: () => (window as any).WIA.status.flag("email", "a work address") });
  }, forms.url(ARC));
  await expect(form.getByText("a work address")).toBeVisible();
}

/** The student presses the employer's Submit, from the keyboard (WorkIt's panel sits over the button). */
const pressSubmit = (form: Page) => form.getByRole("button", { name: "Submit application" }).press("Enter");

test("Submit with something open shows what, sends nothing, and Show me goes to it", async () => {
  const forms = new SavedForms([ARC]);
  const form = await readyArc(forms);
  await emptyFirstName(form, forms);

  await pressSubmit(form);

  const warning = form.getByRole("alertdialog");
  await expect(warning).toContainText("1 thing still needs you");
  await expect(warning).toContainText("First Name");
  await form.waitForTimeout(1_000);
  expect(forms.submissions).toEqual([]);

  await warning.getByRole("button", { name: "Show me" }).click();
  await expect(warning).toBeHidden();
  await expect.poll(() => form.evaluate(() => document.activeElement?.id)).toBe("first_name");
  // Next Thing That Needs You goes on from there.
  const cursor = await loaded.worker.evaluate(async () => (await chrome.storage.session.get("workit_batch_next")).workit_batch_next);
  expect(cursor?.key).toBe("first_name");
});

test("Submit anyway lets the student's next Submit through", async () => {
  const forms = new SavedForms([ARC]);
  const form = await readyArc(forms);
  await flagEmail(form, forms);
  await pressSubmit(form);
  const warning = form.getByRole("alertdialog");
  await expect(warning).toContainText("1 thing still needs you");

  await warning.getByRole("button", { name: "Submit anyway" }).click();
  // WorkIt sends nothing itself: the student presses Submit again.
  await expect(form.getByText("Press Submit again")).toBeVisible();
  await form.waitForTimeout(1_000);
  expect(forms.submissions).toEqual([]);

  await pressSubmit(form);
  await expect.poll(() => forms.submissions.length, { timeout: 15_000 }).toBe(1);
  await expect(form.getByRole("alertdialog")).toHaveCount(0);
});

test("Submit with nothing open goes straight through, with no warning", async () => {
  const forms = new SavedForms([ARC]);
  const form = await readyArc(forms);

  await pressSubmit(form);

  await expect.poll(() => forms.submissions.length, { timeout: 15_000 }).toBe(1);
  await expect(form.getByRole("alertdialog")).toHaveCount(0);
});
