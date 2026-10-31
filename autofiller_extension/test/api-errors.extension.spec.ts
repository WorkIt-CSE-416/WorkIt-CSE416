// The panel when WorkIt's API can't be used (KAN-466): an API that never
// answers or can't be reached is one plain sentence within the call's time,
// never a spinner forever or the browser's "Failed to fetch"; an extension
// older than the API serves (its 426) asks the student to update. Saved forms
// and the fake API only; nothing is ever submitted.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { EXTENSION_ID, loadExtension, signIn, webapp, type Handler, type Loaded, type Reply } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";
const NO_ANSWER = "WorkIt didn't answer. Try again in a minute.";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");

/** Answers the student's profile read (GET .../profile) with `reply`, and leaves every other call to the fake API. */
const profileAnswers = (reply: () => Promise<Reply>): Handler => ({ url }) =>
  url.host === "localhost:8000" && url.pathname.endsWith("/profile") ? reply() : undefined;

/** Anduril's form, with the panel's Autofill This Page pressed. */
async function autofill(forms: SavedForms): Promise<Page> {
  const page = await loaded.context.newPage();
  await page.goto(forms.url(ANDURIL));
  await hostOf(page).getByRole("button", { name: "Show WorkIt panel" }).click({ timeout: 15_000 });
  await hostOf(page).getByRole("button", { name: "Autofill This Page" }).click();
  return page;
}

test("an API that never answers fails the fill with a plain sentence within the call's time", async () => {
  test.setTimeout(90_000);
  const forms = new SavedForms([ANDURIL]);
  const api = new FakeApi();
  const asked: number[] = [];
  const never = profileAnswers(() => (asked.push(Date.now()), new Promise<Reply>(() => {})));
  loaded = await loadExtension([never, api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const page = await autofill(forms);

  // The fill's failed row (content-script.js's note "_error"), about the call's 20 s after it asked.
  await expect(hostOf(page).locator('[data-key="_error"]')).toContainText(NO_ANSWER, { timeout: 35_000 });
  expect(Date.now() - asked[0]).toBeLessThan(30_000);
  await expect(hostOf(page).getByRole("button", { name: "Filling…" })).toHaveCount(0);
});

test("an API that can't be reached shows the same sentence, never Failed to fetch", async () => {
  test.setTimeout(90_000);
  const forms = new SavedForms([ANDURIL]);
  const unreachable = profileAnswers(async () => ({ drop: true }));
  loaded = await loadExtension([unreachable, new FakeApi().handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const page = await autofill(forms);

  await expect(hostOf(page).locator('[data-key="_error"]')).toContainText(NO_ANSWER, { timeout: 30_000 });
  await expect(hostOf(page)).not.toContainText("Failed to fetch");
});

test("every call names the extension's version, and a 426 asks the student to update, not the generic error", async () => {
  const versions = new Set<string | undefined>();
  const api = new FakeApi();
  const tooOld: Handler = ({ url, headers }) => {
    if (url.host !== "localhost:8000" || url.pathname === "/health") return undefined;
    versions.add(headers["x-workit-extension"] as string | undefined);
    return url.pathname.endsWith("/profile") ? { status: 426, json: { detail: { message: "Please update WorkIt.", min_version: "9.0.0" } } } : undefined;
  };
  loaded = await loadExtension([tooOld, api.handler, webapp]);
  await signIn(loaded.context);
  const popup = await loaded.context.newPage();
  await popup.goto(`chrome-extension://${EXTENSION_ID}/src/popup/popup.html`);

  await expect(popup.locator("#root")).toContainText("Please update WorkIt. Restart Chrome to get the new version.");
  await expect(popup.locator("#root")).not.toContainText("WorkIt couldn't load your profile.");
  await expect(popup.locator("#root")).not.toContainText("WorkIt's server couldn't do that just now.");
  const manifest = await loaded.worker.evaluate(() => chrome.runtime.getManifest().version);
  expect([...versions]).toEqual([manifest]);
});
