// What the extension keeps for a signed-in student goes when they sign out or
// another account signs in (KAN-469): the cached profile (résumé and
// transcript bytes, self-ID answers, the bank) and a tab's switched résumé.
// On a shared or lab Chrome, nothing of the last student's stays on disk.
// The student's Workday logins and the sites they allowed are kept: they
// aren't one account's.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { STUDENT } from "./extension";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, menuItem, signIn, tokenFor, webapp, type Handler, type Loaded } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";
const COOKIE = "sb-zhdrvdrojipkluhzgsea-auth-token";
const pdf = (words: string) => Buffer.from(`%PDF-1.4\n% ${words}\n%%EOF\n`).toString("base64");
const BASE = { id: "built-base", name: "Base Resume", job_posting_id: null, pdf: pdf("base resume of the first student") };

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");
const mainButton = (page: Page) => hostOf(page).locator('[data-slot="primary"] .primary-button').first();
const rowOf = (page: Page) => hostOf(page).locator('.row[data-key="resume"]');

/** Everything the extension keeps, local and session, as one string. */
const stored = () =>
  loaded.worker.evaluate(async () => JSON.stringify({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
const storedKeys = () => loaded.worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)));

/** Anduril's form opened by the student, filled, its résumé switched to the built Base Resume. */
async function filledWithSwitchedResume(): Promise<Page> {
  const page = await loaded.context.newPage();
  await page.goto(new SavedForms([ANDURIL]).url(ANDURIL));
  await hostOf(page).getByRole("button", { name: "Show WorkIt panel" }).click({ timeout: 15_000 });
  await mainButton(page).click();
  await expect(mainButton(page)).toContainText(/^Answer \d+ of \d+$/, { timeout: 60_000 });
  await hostOf(page).locator('.group[data-group="filled"] .group-head').click();
  await rowOf(page).locator(".label").click();
  await rowOf(page).locator(".resume-card").getByRole("button", { name: "Change" }).click();
  await hostOf(page).getByRole("dialog", { name: "Choose a Resume" }).locator(".resume-option", { hasText: "Base Resume" }).click();
  await expect(rowOf(page).locator(".resume-card .resume-name")).toHaveText(/Base Resume/);
  return page;
}

test("signing out leaves no cached profile and no résumé bytes in the extension's storage", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([ANDURIL]);
  const api = new FakeApi();
  api.builtResumes.push(BASE);
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  // Not one account's: the Workday logins this Chrome saved, and the sites the student allowed.
  const kept = { workday_logins: { "acme.wd1": { email: "kept@example.com" } }, workday_accounts_for_me: true, allowed_sites: ["https://kept.example"] };
  await loaded.worker.evaluate((kept) => chrome.storage.local.set(kept), kept);
  await filledWithSwitchedResume();
  // Signed in, both résumés are kept: the profile's default and the tab's switched one.
  expect(await stored()).toContain(STUDENT.resume.base64);
  expect(await stored()).toContain(BASE.pdf);

  await loaded.context.clearCookies({ name: COOKIE });

  await expect.poll(storedKeys, { timeout: 10_000 }).not.toContain("workit_autofill_profile");
  await expect.poll(stored).not.toContain(STUDENT.resume.base64);
  expect(await stored()).not.toContain(BASE.pdf);
  expect(await loaded.worker.evaluate((keys) => chrome.storage.local.get(keys), Object.keys(kept))).toEqual(kept);
  expect(forms.submissions).toEqual([]);
});

test("another account signing in on the same Chrome never fills with the first account's data", async () => {
  test.setTimeout(180_000);
  const forms = new SavedForms([ANDURIL]);
  const first = new FakeApi();
  first.token = tokenFor(STUDENT.id);
  first.builtResumes.push(BASE);
  const other = new FakeApi({ id: "00000000-0000-0000-0000-000000000002", full_name: "Robin Other", email: "robin@example.com" });
  other.token = tokenFor("00000000-0000-0000-0000-000000000002");
  // The API answers each account by its token, as WorkIt's does.
  const api: Handler = (request) => (request.headers.authorization === `Bearer ${other.token}` ? other : first).handler(request);
  loaded = await loadExtension([api, webapp, forms.handler]);
  await signIn(loaded.context, first.token);
  const page = await filledWithSwitchedResume();
  await expect(page.locator("#first_name")).toHaveValue("Test");

  await signIn(loaded.context, other.token);
  await (await menuItem(hostOf(page), "Fill Again")).click();
  await hostOf(page).locator('[data-slot="primary"] [data-confirm]').getByRole("button", { name: "Fill Again" }).click();
  await expect(mainButton(page)).toContainText(/^Answer \d+ of \d+$/, { timeout: 90_000 });

  await expect(page.locator("#first_name")).toHaveValue("Robin");
  await expect(page.locator("#last_name")).toHaveValue("Other");
  // The first account's switched résumé is gone with it: the form gets this account's own.
  await expect(page.locator('[aria-labelledby="upload-label-resume"] .file-upload__filename')).toHaveText(STUDENT.resume.filename);
  expect(await stored()).not.toContain(BASE.pdf);
  expect(forms.submissions).toEqual([]);
});
