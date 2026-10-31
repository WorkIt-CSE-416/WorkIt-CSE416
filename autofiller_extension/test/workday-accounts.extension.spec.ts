// Workday accounts made and signed in to for the student (KAN-369), end to
// end in the loaded extension (loaded-extension.ts), on the fake Workday
// tenants (fake-job-systems.ts). Once the student allows it, the extension
// fills each company's Create Account or Sign In, ticks its terms box and
// presses the button itself; a step only the student can do (Workday's email,
// a refused password) is told to them, and nothing is pressed twice.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { FakeWorkdays } from "./fake-job-systems";
import { CONTENT_SCRIPT_FILES, ENGINE_FILES } from "../src/shared/content-scripts.js";
import { loadExtension, sendFromWebapp, signIn, webapp, type Loaded, menuItem } from "./loaded-extension";

let loaded: Loaded | undefined;
test.afterEach(async () => {
  await loaded?.close();
  loaded = undefined;
});

/** The first step's First Name: what its box shows, or once a batch tab saved the step (Fill to Review), what was saved. */
async function firstName(page: Page, workdays: FakeWorkdays, n = 0): Promise<unknown> {
  const box = page.locator("[data-automation-id=formField-legalName--firstName] input");
  return workdays.saved(n)["legalName--firstName"] ?? ((await box.count()) ? box.inputValue() : "");
}

const overlay = (p: Page) => p.locator("#workit-autofiller-overlay-host");
const box = (p: Page, id: string) => p.locator(`[data-automation-id=${id}]`);

/** Loads the extension with `workdays` and starts a batch of `jobs`. */
async function start(workdays: FakeWorkdays, ...jobs: { id: string; apply_url: string }[]): Promise<(url: string) => Promise<Page>> {
  const api = new FakeApi().queue(...jobs);
  loaded = await loadExtension([api.handler, webapp, workdays.handler]);
  await signIn(loaded.context);
  const app = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await app.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(app, { type: "run/open" });
  return async (url) => {
    await expect.poll(() => loaded!.context.pages().some((p) => p.url() === url), { timeout: 30_000 }).toBe(true);
    return loaded!.context.pages().find((p) => p.url() === url)!;
  };
}

/** Allows the extension, once, to make and sign in to the student's Workday accounts. */
async function allow(page: Page): Promise<void> {
  const card = overlay(page).locator(".moment.workday-accounts");
  await expect(card).toContainText("ticks the box that you agree to the company's terms", { timeout: 30_000 });
  await card.locator("[data-allow]").click();
}

async function skip(page: Page): Promise<void> {
  await (await menuItem(overlay(page), "Skip")).click();
}

test("a click the page makes on Sign Me In allows nothing: only the student's own press does (KAN-469)", async () => {
  test.setTimeout(120_000);
  const workdays = new FakeWorkdays(["workday-caci"]);
  const page = await start(workdays, { id: "wd-0", apply_url: workdays.signInUrl(0) });
  const caci = await page(workdays.signInUrl(0));
  const card = overlay(caci).locator(".moment.workday-accounts");
  await expect(card).toContainText("ticks the box that you agree to the company's terms", { timeout: 30_000 });

  // The employer's script presses it (el.click() is no press of the student's: isTrusted is false).
  await card.locator("[data-allow]").evaluate((button: HTMLElement) => button.click());
  await caci.waitForTimeout(2000);
  await expect(card).toBeVisible();
  expect(workdays.signIns).toEqual([]);
  expect(await loaded!.worker.evaluate(async () => (await chrome.storage.local.get("workday_accounts_for_me")).workday_accounts_for_me)).toBeUndefined();

  await allow(caci);
  await expect.poll(() => workdays.signIns.length, { timeout: 30_000 }).toBe(1);
});

test("allowed once, makes each company's Workday account itself, terms box shown, and signs in later", async () => {
  test.setTimeout(180_000);
  const workdays = new FakeWorkdays(["workday-caci", "workday-xcel"]);
  const page = await start(workdays,
    { id: "wd-0", apply_url: workdays.signInUrl(0) },
    { id: "wd-1", apply_url: workdays.signInUrl(1, "signin") },
    { id: "wd-2", apply_url: workdays.signInUrl(0, "signin") });

  // The first company: the student allows it once; the extension ticks the terms box, which it names, and presses Create Account.
  const caci = await page(workdays.signInUrl(0));
  await allow(caci);
  await caci.waitForURL(workdays.url(0), { timeout: 30_000 });
  // A batch tab saves the filled step itself (Fill to Review), so the name shows on the step or was saved from it.
  await expect.poll(() => firstName(caci, workdays), { timeout: 30_000 }).toBe("Test");
  const caciPassword = workdays.signIns[0]?.password;
  expect(workdays.signIns).toEqual([{ host: "caci.wd1.myworkdayjobs.com", view: "create", email: "test.person@example.com", password: caciPassword }]);
  expect(workdays.agreed).toEqual([true]);

  // The next company opens on Sign In with nothing saved: it switches to Create Account and makes it, without asking again.
  await skip(caci);
  const xcel = await page(workdays.signInUrl(1, "signin"));
  await expect.poll(() => workdays.signIns.length, { timeout: 30_000 }).toBe(2);
  expect(workdays.signIns[1]).toMatchObject({ host: "xcelenergy.wd1.myworkdayjobs.com", view: "create", email: "test.person@example.com" });
  expect(workdays.signIns[1].password).not.toBe(caciPassword);
  expect(workdays.agreed).toEqual([true, true]);
  await expect(overlay(xcel).locator(".moment.workday-accounts")).toHaveCount(0);

  // Back on the first company, its Sign In is pressed with the saved login.
  await skip(xcel);
  await page(workdays.signInUrl(0, "signin"));
  await expect.poll(() => workdays.signIns.length, { timeout: 30_000 }).toBe(3);
  expect(workdays.signIns[2]).toEqual({ host: "caci.wd1.myworkdayjobs.com", view: "signin", email: "test.person@example.com", password: caciPassword });
  expect(workdays.submissions).toEqual([]);
});

test("Workday's verification email is the student's step: the panel says what to do", async () => {
  test.setTimeout(120_000);
  const workdays = new FakeWorkdays(["workday-caci"]);
  workdays.alerts["caci.wd1.myworkdayjobs.com"] = { create: "Please verify your account. We sent a verification email to test.person@example.com." };
  const page = await start(workdays, { id: "wd-0", apply_url: workdays.signInUrl(0) });

  const caci = await page(workdays.signInUrl(0));
  await allow(caci);
  const row = overlay(caci).locator(".row").filter({ hasText: "Open the email" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  // The terms box it ticked is named, in the page's own words.
  await expect(row).toContainText('ticked "I agree to the terms" for you');
  expect(workdays.signIns.map((s) => s.view)).toEqual(["create"]);
});

test("a sign-in Workday refuses is never pressed again, and the student is told", async () => {
  test.setTimeout(120_000);
  const workdays = new FakeWorkdays(["workday-caci"]);
  workdays.alerts["caci.wd1.myworkdayjobs.com"] = { signin: "Wrong email address or password. Your account might be locked." };
  const page = await start(workdays,
    { id: "wd-0", apply_url: workdays.signInUrl(0) },
    { id: "wd-1", apply_url: workdays.signInUrl(0, "signin") });

  const caci = await page(workdays.signInUrl(0));
  await allow(caci);
  await caci.waitForURL(workdays.url(0), { timeout: 30_000 });
  await skip(caci);

  const again = await page(workdays.signInUrl(0, "signin"));
  await expect(overlay(again).locator(".row").filter({ hasText: "won't try again" })).toBeVisible({ timeout: 30_000 });
  await again.waitForTimeout(3000);
  expect(workdays.signIns.map((s) => s.view)).toEqual(["create", "signin"]);
});

test("two companies' Create Account at once each keep the password their account was made with", async () => {
  test.setTimeout(120_000);
  const workdays = new FakeWorkdays(["workday-caci", "workday-xcel"]);
  loaded = await loadExtension([new FakeApi().handler, webapp, workdays.handler]);
  await signIn(loaded.context);
  await loaded.worker.evaluate(() => chrome.storage.local.set({ workday_accounts_for_me: true }));
  for (const n of [0, 1]) await (await loaded.context.newPage()).goto(workdays.signInUrl(n));
  // Both fills start together (Autofill This Page in two tabs), so both new passwords are saved at once.
  await loaded.worker.evaluate(async ([engine, scripts]) => {
    const tabs = await chrome.tabs.query({ url: "https://*/__fake__/signin*" });
    await Promise.all(tabs.map(async ({ id }) => {
      // The page's job system, named as injectFill names it.
      await chrome.scripting.executeScript({ target: { tabId: id! }, func: () => void ((window as any).WIA = { jobSystem: "workday" }) });
      await chrome.scripting.executeScript({ target: { tabId: id! }, world: "MAIN", files: engine });
      void chrome.scripting.executeScript({ target: { tabId: id! }, files: scripts });
    }));
  }, [ENGINE_FILES, CONTENT_SCRIPT_FILES]);

  await expect.poll(() => workdays.signIns.length, { timeout: 30_000 }).toBe(2);
  const saved = await loaded.worker.evaluate(async () => (await chrome.storage.local.get("workday_logins")).workday_logins ?? {});
  for (const { host, view, password } of workdays.signIns) {
    expect(view).toBe("create");
    expect(saved[host]?.password).toBe(password);
  }
});

test("a refused sign-in stays refused when the page loads again: Sign In isn't pressed with it", async () => {
  test.setTimeout(120_000);
  const workdays = new FakeWorkdays(["workday-caci"]);
  workdays.alerts["caci.wd1.myworkdayjobs.com"] = { signin: "Wrong email address or password." };
  const page = await start(workdays,
    { id: "wd-0", apply_url: workdays.signInUrl(0) },
    { id: "wd-1", apply_url: workdays.signInUrl(0, "signin") });

  const caci = await page(workdays.signInUrl(0));
  await allow(caci);
  await caci.waitForURL(workdays.url(0), { timeout: 30_000 });
  await skip(caci);
  const again = await page(workdays.signInUrl(0, "signin"));
  await expect(overlay(again).locator(".row").filter({ hasText: "won't try again" })).toBeVisible({ timeout: 30_000 });

  // The page loads again (the student reloads it, or the batch opens the form again): still refused.
  await again.reload();
  await expect(overlay(again).locator(".row").filter({ hasText: "won't try again" })).toBeVisible({ timeout: 30_000 });
  await again.waitForTimeout(3000);
  expect(workdays.signIns.map((s) => s.view)).toEqual(["create", "signin"]);
  expect(await box(again, "password").inputValue()).toBe("");
});

test("a terms box that doesn't show ticked: Create Account isn't pressed, the password is kept, and the student is told", async () => {
  test.setTimeout(120_000);
  const workdays = new FakeWorkdays(["workday-caci"]);
  workdays.stuckTerms.add("caci.wd1.myworkdayjobs.com");
  const page = await start(workdays, { id: "wd-0", apply_url: workdays.signInUrl(0) });

  const caci = await page(workdays.signInUrl(0));
  await allow(caci);
  await expect(overlay(caci).locator(".row").filter({ hasText: 'couldn\'t tick "I agree to the terms"' })).toBeVisible({ timeout: 30_000 });
  await caci.waitForTimeout(3000);
  expect(workdays.signIns).toEqual([]);
  const saved = await loaded!.worker.evaluate(async () => (await chrome.storage.local.get("workday_logins")).workday_logins ?? {});
  expect(saved["caci.wd1.myworkdayjobs.com"]?.password).toBe(await box(caci, "password").inputValue());

  // The student ticks it and presses Create Account: the account is made with the kept password.
  await box(caci, "createAccountCheckbox").check();
  await box(caci, "click_filter").click();
  await caci.waitForURL(workdays.url(0), { timeout: 30_000 });
  expect(workdays.signIns[0]?.password).toBe(saved["caci.wd1.myworkdayjobs.com"].password);
});

test("a hidden message already on the form isn't Workday's answer: a slow Create Account keeps its password", async () => {
  test.setTimeout(120_000);
  const workdays = new FakeWorkdays(["workday-caci"]);
  workdays.hiddenAlerts.add("caci.wd1.myworkdayjobs.com");
  workdays.answerDelay["caci.wd1.myworkdayjobs.com"] = 12_000;
  const page = await start(workdays, { id: "wd-0", apply_url: workdays.signInUrl(0) });

  const caci = await page(workdays.signInUrl(0));
  await allow(caci);
  await caci.waitForURL(workdays.url(0), { timeout: 60_000 });
  // One Create Account sent, though Workday took longer to answer than a dropped press is waited for.
  expect(workdays.signIns.map((s) => s.view)).toEqual(["create"]);
  const saved = await loaded!.worker.evaluate(async () => (await chrome.storage.local.get("workday_logins")).workday_logins ?? {});
  expect(saved["caci.wd1.myworkdayjobs.com"]?.password).toBe(workdays.signIns[0].password);
});

test("a press Workday drops is made again, and one that sent the form never is", async () => {
  test.setTimeout(120_000);
  const workdays = new FakeWorkdays(["workday-caci"]);
  workdays.droppedPresses["caci.wd1.myworkdayjobs.com"] = 2;
  const page = await start(workdays, { id: "wd-0", apply_url: workdays.signInUrl(0) });

  const caci = await page(workdays.signInUrl(0));
  await allow(caci);
  await caci.waitForURL(workdays.url(0), { timeout: 60_000 });
  expect(workdays.signIns.map((s) => s.view)).toEqual(["create"]);
  const saved = await loaded!.worker.evaluate(async () => (await chrome.storage.local.get("workday_logins")).workday_logins ?? {});
  expect(saved["caci.wd1.myworkdayjobs.com"]?.password).toBe(workdays.signIns[0].password);
});

test("an account Workday asked to verify is signed in to next time, not made again", async () => {
  test.setTimeout(120_000);
  const workdays = new FakeWorkdays(["workday-caci"]);
  workdays.alerts["caci.wd1.myworkdayjobs.com"] = { create: "Please verify your account. We sent a verification email to test.person@example.com." };
  const page = await start(workdays,
    { id: "wd-0", apply_url: workdays.signInUrl(0) },
    { id: "wd-1", apply_url: workdays.signInUrl(0) + "&again" });

  const caci = await page(workdays.signInUrl(0));
  await allow(caci);
  await expect(overlay(caci).locator(".row").filter({ hasText: "Open the email" })).toBeVisible({ timeout: 30_000 });
  await skip(caci);

  // The student clicked the email's link; the next page opens on Create Account: it switches to Sign In and presses it.
  const again = await page(workdays.signInUrl(0) + "&again");
  await again.waitForURL(workdays.url(0), { timeout: 30_000 });
  expect(workdays.signIns.map((s) => s.view)).toEqual(["create", "signin"]);
  expect(workdays.signIns[1].password).toBe(workdays.signIns[0].password);
});

test("in a batch tab, presses a posting's Apply then Apply Manually, or its Continue Application, once each, never the other ways", async () => {
  test.setTimeout(180_000);
  const workdays = new FakeWorkdays(["workday-caci", "workday-xcel"]);
  const page = await start(workdays,
    { id: "wd-0", apply_url: workdays.postingUrl(0) },
    { id: "wd-1", apply_url: workdays.postingUrl(1, true) });

  // The student's Start batch is the press: Apply, then Apply Manually in its popup, which loads Create Account.
  const caci = await page(workdays.postingUrl(0));
  await caci.waitForURL(/\/__fake__\/signin\?view=create/, { timeout: 30_000 });
  await expect.poll(() => box(caci, "email").inputValue(), { timeout: 30_000 }).toBe("test.person@example.com");
  await caci.waitForTimeout(2000);
  expect(workdays.starts).toEqual(["apply", "applyManually"]);
  await expect(overlay(caci).locator(".row").filter({ hasText: "Sign in to continue" })).toBeVisible();

  // An application started before: Continue Application, which loads Sign In.
  await skip(caci);
  const xcel = await page(workdays.postingUrl(1, true));
  await xcel.waitForURL(/\/__fake__\/signin\?view=signin/, { timeout: 30_000 });
  await xcel.waitForTimeout(2000);
  expect(workdays.starts).toEqual(["apply", "applyManually", "continue"]);
  expect(workdays.signIns).toEqual([]);
  expect(workdays.submissions).toEqual([]);
});
