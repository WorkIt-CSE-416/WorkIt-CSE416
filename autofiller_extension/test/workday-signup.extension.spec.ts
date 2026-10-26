// Workday sign-up (KAN-369): the one registration email and password the
// student may set on the extension's own page (src/options/), used at every
// company's Workday in place of a password made per company. End to end in
// the loaded extension, on the fake Workday tenants (fake-job-systems.ts).
// Made-up credentials only. The password must never reach the WorkIt API:
// every request to it is recorded and searched for the password.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { FakeWorkdays } from "./fake-job-systems";
import { EXTENSION_ID, loadExtension, sendFromWebapp, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

let loaded: Loaded | undefined;
test.afterEach(async () => {
  await loaded?.close();
  loaded = undefined;
});

const SIGNUP_PAGE = `chrome-extension://${EXTENSION_ID}/src/options/options.html`;
// Made up for these tests: no real account anywhere has it.
const PASSWORD = "Fake-Tenant-Pass-42!";
const overlay = (p: Page) => p.locator("#workit-autofiller-overlay-host");

/** Every request to the fake WorkIt API (localhost:8000), as its URL and body, for the password check. */
function recordApi(): { handler: Handler; sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    handler: ({ url, method, headers, body }) => {
      if (url.host === "localhost:8000") sent.push(`${method} ${url.href} ${JSON.stringify(headers)} ${body.toString("utf8")}`);
      return undefined;
    },
  };
}

test("the sign-up page's checklist gates Save; Save and Clear keep the login in this browser only", async () => {
  test.setTimeout(60_000);
  const api = recordApi();
  loaded = await loadExtension([api.handler, new FakeApi().handler, webapp]);
  await signIn(loaded.context);
  const page = await loaded.context.newPage();
  await page.goto(SIGNUP_PAGE);

  // Prefilled with the student's WorkIt email.
  await expect(page.locator("#signup-email")).toHaveValue("test.person@example.com", { timeout: 15_000 });
  const save = page.locator("#signup-save");
  const rule = (name: string) => page.locator(`[data-rule=${name}]`);
  await expect(save).toBeDisabled();

  const password = page.locator("#signup-password");
  await password.fill("short1");
  await expect(rule("lower")).toHaveAttribute("data-met", "true");
  await expect(rule("number")).toHaveAttribute("data-met", "true");
  for (const name of ["length", "upper", "special"]) await expect(rule(name)).toHaveAttribute("data-met", "false");
  await expect(save).toBeDisabled();

  // Show/hide.
  await expect(password).toHaveAttribute("type", "password");
  await page.locator("#signup-show").click();
  await expect(password).toHaveAttribute("type", "text");
  await page.locator("#signup-show").click();
  await expect(password).toHaveAttribute("type", "password");

  await password.fill(PASSWORD);
  for (const name of ["length", "upper", "lower", "number", "special"]) await expect(rule(name)).toHaveAttribute("data-met", "true");
  await page.locator("#signup-email").fill("made.up.student@example.org");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.locator("#signup-said")).toContainText("Saved");
  const stored = () => loaded!.worker.evaluate(async () => (await chrome.storage.local.get("workday_signup")).workday_signup ?? null);
  expect(await stored()).toEqual({ email: "made.up.student@example.org", password: PASSWORD });

  // Opened again: the saved email shows, the password box is left empty.
  await page.reload();
  await expect(page.locator("#signup-email")).toHaveValue("made.up.student@example.org", { timeout: 15_000 });
  await expect(password).toHaveValue("");
  await expect(page.locator("#signup-said")).toContainText("saved");

  await page.locator("#signup-clear").click();
  await expect.poll(stored).toBeNull();
  expect(api.sent.length).toBeGreaterThan(0);
  expect(api.sent.filter((s) => s.includes(PASSWORD))).toEqual([]);
});

test("a saved sign-up is used for Create Account and Sign In at every company, and never sent to WorkIt", async () => {
  test.setTimeout(180_000);
  const workdays = new FakeWorkdays(["workday-caci", "workday-xcel"]);
  const api = recordApi();
  const fake = new FakeApi().queue(
    { id: "wd-0", apply_url: workdays.signInUrl(0) },
    { id: "wd-1", apply_url: workdays.signInUrl(1, "signin") },
    { id: "wd-2", apply_url: workdays.signInUrl(0, "signin") });
  loaded = await loadExtension([api.handler, fake.handler, webapp, workdays.handler]);
  await signIn(loaded.context);
  await loaded.worker.evaluate(([password]) => chrome.storage.local.set({
    workday_signup: { email: "made.up.student@example.org", password },
    workday_accounts_for_me: true,
  }), [PASSWORD]);
  const app = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await app.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(app, { type: "run/open" });
  const tab = async (url: string) => {
    await expect.poll(() => loaded!.context.pages().some((p) => p.url() === url), { timeout: 30_000 }).toBe(true);
    return loaded!.context.pages().find((p) => p.url() === url)!;
  };

  // A new company: Create Account with the saved login.
  const caci = await tab(workdays.signInUrl(0));
  await caci.waitForURL(workdays.url(0), { timeout: 30_000 });
  // A new company opening on Sign In: nothing known there, so it makes the account with the saved login too.
  await overlay(caci).locator("[data-skip]").click();
  const xcel = await tab(workdays.signInUrl(1, "signin"));
  await expect.poll(() => workdays.signIns.length, { timeout: 30_000 }).toBe(2);
  // The first company again: Sign In with the saved login.
  await overlay(xcel).locator("[data-skip]").click();
  await tab(workdays.signInUrl(0, "signin"));
  await expect.poll(() => workdays.signIns.length, { timeout: 30_000 }).toBe(3);

  const login = { email: "made.up.student@example.org", password: PASSWORD };
  expect(workdays.signIns).toEqual([
    { host: "caci.wd1.myworkdayjobs.com", view: "create", ...login },
    { host: "xcelenergy.wd1.myworkdayjobs.com", view: "create", ...login },
    { host: "caci.wd1.myworkdayjobs.com", view: "signin", ...login },
  ]);
  expect(workdays.submissions).toEqual([]);
  expect(api.sent.length).toBeGreaterThan(0);
  expect(api.sent.filter((s) => s.includes(PASSWORD))).toEqual([]);
});
