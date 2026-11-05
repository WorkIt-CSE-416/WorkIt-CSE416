// Apply's Employer accounts in the student's own Chrome (KAN-592), end to end in the loaded extension
// (loaded-extension.ts) on a fake Workday tenant (fake-job-systems.ts), with a fake Apply accounts host
// (fake-apply-host.mjs) in the profile's NativeMessagingHosts, where Chromium looks for one. On a tenant
// Apply made an account at, the extension never types the student's one Workday sign-up password there:
// it offers Sign In with Your Apply Account, and only that press asks the host for the password, which
// it types into the form and hands to Chrome's password manager (navigator.credentials.store). It is
// never saved in the extension, sent anywhere, or pressed in.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { FakeWorkdays } from "./fake-job-systems";
import { EXTENSION_ID, loadExtension, saveWorkdaySignup, sendFromWebapp, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

const CACI = "caci.wd1.myworkdayjobs.com";
// Made up: the password Apply generated for CACI's Workday, as Keychain would hold it.
const APPLY_LOGIN = { company: "CACI", login: "test.person@example.com", password: "Apply-Made-Caci-Pass-9!x" };

let loaded: Loaded | undefined;
let folder: string | undefined;
test.afterEach(async () => {
  await loaded?.close();
  loaded = undefined;
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = undefined;
});

/** A Chromium profile with the fake Apply accounts host installed, knowing `accounts`; returns it and the host's log. */
function profileWithApplyHost(accounts: Record<string, typeof APPLY_LOGIN>): { profile: string; log: string } {
  folder = mkdtempSync(join(tmpdir(), "workit-apply-host-"));
  const profile = join(folder, "profile");
  const [file, log, wrapper] = [join(folder, "accounts.json"), join(folder, "host.log"), join(folder, "host.sh")];
  writeFileSync(file, JSON.stringify(accounts));
  writeFileSync(log, "");
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${join(__dirname, "fake-apply-host.mjs")}" "${file}" "${log}" "$1"\n`);
  chmodSync(wrapper, 0o755);
  mkdirSync(join(profile, "NativeMessagingHosts"), { recursive: true });
  writeFileSync(join(profile, "NativeMessagingHosts", "com.workit.apply_accounts.json"), JSON.stringify({
    name: "com.workit.apply_accounts", description: "fake", path: wrapper, type: "stdio",
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  }));
  return { profile, log };
}

const asked = (log: string) => readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const box = (p: Page, id: string) => p.locator(`[data-automation-id=${id}]`);
const card = (p: Page) => p.locator("#workit-autofiller-overlay-host .moment.apply-sign-in");

test("on a tenant Apply made, the press of Sign In with Your Apply Account fills Apply's password and offers it to Chrome, and nothing keeps or sends it", async () => {
  test.setTimeout(180_000);
  const workdays = new FakeWorkdays(["workday-caci"]);
  const api = new FakeApi().queue({ id: "wd-0", apply_url: workdays.signInUrl(0, "create") });
  const { profile, log } = profileWithApplyHost({ [CACI]: APPLY_LOGIN });
  const sent: string[] = [];
  const spy: Handler = ({ url, body }) => void sent.push(url.href + body.toString());
  loaded = await loadExtension([spy, api.handler, webapp, workdays.handler], { profile, grantPermissions: ["nativeMessaging"] });
  await signIn(loaded.context);
  await saveWorkdaySignup(loaded); // the student's one sign-up password, which must not be typed here
  const internals = await loaded.context.newPage();
  await internals.goto("chrome://password-manager-internals");
  const app = await loaded.context.newPage();
  await app.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(app, { type: "run/open" });
  await expect.poll(() => loaded!.context.pages().some((p) => p.url().startsWith(`https://${CACI}/__fake__/signin`)), { timeout: 30_000 }).toBe(true);
  const caci = loaded.context.pages().find((p) => p.url().startsWith(`https://${CACI}/__fake__/signin`))!;

  // Apply made the account, so Create Account switches to Sign In, and the card offers Apply's login.
  await expect(card(caci)).toContainText("Sign In with Your Apply Account", { timeout: 30_000 });
  await expect(box(caci, "verifyPassword")).toHaveCount(0);
  expect(await box(caci, "password").inputValue()).toBe("");
  expect(asked(log).every((a) => a.want === "known")).toBe(true);

  await card(caci).locator("[data-apply-sign-in]").click();

  await expect.poll(() => box(caci, "password").inputValue(), { timeout: 10_000 }).toBe(APPLY_LOGIN.password);
  expect(await box(caci, "email").inputValue()).toBe(APPLY_LOGIN.login);
  // Chrome's password manager got it from the tenant's own page, to ask the student to save it.
  await expect.poll(() => internals.evaluate(() => document.body.innerText), { timeout: 10_000 })
    .toContain(`CM API save a credential: origin=https://${CACI}`);
  // Only the WorkIt extension asked, one tenant, and the password only after the press.
  expect(asked(log)).toContainEqual({ origin: `chrome-extension://${EXTENSION_ID}/`, tenant: CACI, want: "login" });
  expect(new Set(asked(log).map((a) => a.tenant))).toEqual(new Set([CACI]));
  // Nothing pressed Sign In, nothing kept the password, nothing sent it.
  expect(workdays.signIns).toEqual([]);
  const stored = await loaded.worker.evaluate(() => chrome.storage.local.get(null));
  expect(JSON.stringify(stored)).not.toContain(APPLY_LOGIN.password);
  expect(sent.some((s) => s.includes(APPLY_LOGIN.password))).toBe(false);
});
