// Batch apply over a session (KAN-373), end to end in the loaded extension
// (loaded-extension.ts): a batch picks up where it stopped after Chrome
// closes, Skip drops a job, and Workday applications take one slot at a time.
// The WorkIt API is faked (fake-api.ts); the forms are saved ones
// (fake-job-systems.ts).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page, type Worker } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { FakeWorkdays, SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Handler, type Loaded, menuItem, saveWorkdaySignup, WORKDAY_SIGNUP } from "./loaded-extension";

type Tab = { id: number; url?: string; group: string | null; autoDiscardable: boolean };

/** Every tab, with its group's title, as the student's tab strip shows them. */
function tabs(worker: Worker): Promise<Tab[]> {
  return worker.evaluate(async () => {
    const groups = new Map((await chrome.tabGroups.query({})).map((g) => [g.id, g.title!]));
    return (await chrome.tabs.query({})).map((t) => ({
      id: t.id!, url: t.url || t.pendingUrl, group: groups.get(t.groupId) ?? null, autoDiscardable: t.autoDiscardable,
    }));
  });
}

/**
 * Greenhouse links whose page waits until `release()`: a tab on one stays
 * filling meanwhile. Once released it shows a form the Fill engine can't plan
 * (its job isn't on the Job Board API), so the tab goes to Needs you.
 */
class SlowForms {
  private go!: () => void;
  private gate = new Promise<void>((done) => (this.go = done));
  url = (n: number) => `https://job-boards.greenhouse.io/slowco/jobs/${n}`;
  release = () => this.go();
  readonly handler: Handler = async ({ url }) => {
    if (!url.pathname.startsWith("/slowco/")) return undefined;
    await this.gate;
    return { headers: { "content-type": "text/html" }, body: "<!doctype html><title>Apply</title><form><label>First name <input id=first_name></label></form>" };
  };
}

let loaded: Loaded | undefined;
const profiles: string[] = [];
test.afterEach(async () => {
  await loaded?.close();
  loaded = undefined;
  profiles.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});

/** The first step's First Name: what its box shows, or once a batch tab saved the step (Fill to Review), what was saved. */
async function firstName(page: Page, workdays: FakeWorkdays, n = 0): Promise<unknown> {
  const box = page.locator("[data-automation-id=formField-legalName--firstName] input");
  return workdays.saved(n)["legalName--firstName"] ?? ((await box.count()) ? box.inputValue() : "");
}

async function openWebapp(): Promise<Page> {
  const page = loaded!.context.pages()[0] ?? (await loaded!.context.newPage());
  await page.goto("http://localhost:3000/auto-apply");
  return page;
}

test("a batch Chrome closed mid-way picks up where it stopped, without filling its finished tabs again", async () => {
  test.setTimeout(180_000);
  const forms = new SavedForms(["greenhouse-arc"]);
  const slow = new SlowForms();
  const api = new FakeApi().queue(
    { id: "job-0", apply_url: forms.url("greenhouse-arc") },
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `job-${n}`, apply_url: slow.url(n) })),
  );
  const handlers = [api.handler, webapp, slow.handler, forms.handler];
  const profile = mkdtempSync(join(tmpdir(), "workit-extension-"));
  profiles.push(profile);
  // As the student's Chrome set to "Continue where you left off".
  const start = () => loadExtension(handlers, { profile, args: ["--restore-last-session"] });

  loaded = await start();
  await signIn(loaded.context);
  await sendFromWebapp(await openWebapp(), { type: "run/open" });
  // Arc's form fills and is Ready; five slow ones fill; job-6 waits in the queue.
  await expect.poll(async () => (await tabs(loaded!.worker)).filter((t) => t.url?.includes("greenhouse")).length, { timeout: 60_000 }).toBe(6);
  await expect.poll(async () => (await tabs(loaded!.worker)).find((t) => t.url === forms.url("greenhouse-arc"))?.group, { timeout: 60_000 }).toBe("Ready");

  // Chrome closes, and opens again with the same profile.
  await loaded.context.close();
  loaded = await start();
  slow.release();

  const batch = async () => (await tabs(loaded!.worker)).filter((t) => t.url?.includes("greenhouse"));
  await expect.poll(async () => (await batch()).filter((t) => t.group).length, { timeout: 90_000 }).toBe(7);
  const after = await batch();
  // Each job in one tab: Chrome's restored ones were taken back, not opened again.
  expect(after.map((t) => t.url).sort()).toEqual([forms.url("greenhouse-arc"), ...[1, 2, 3, 4, 5, 6].map(slow.url)].sort());
  expect(after.find((t) => t.url === forms.url("greenhouse-arc"))!.group).toBe("Ready");
  // Memory Saver may not unload any of them.
  expect(after.map((t) => t.autoDiscardable)).toEqual(after.map(() => false));
  // Arc's finished tab was not filled again: the Fill engine was never loaded into its restored page.
  const arc = loaded.context.pages().find((p) => p.url() === forms.url("greenhouse-arc"))!;
  expect(await arc.evaluate(() => typeof (window as any).FillEngine)).toBe("undefined");
  expect(Object.fromEntries(api.stages)).toEqual({
    "job-0": "queued", "job-1": "needs_you", "job-2": "needs_you", "job-3": "needs_you", "job-4": "needs_you", "job-5": "needs_you", "job-6": "needs_you",
  });
  expect(forms.submissions).toEqual([]);
});

/** Presses the Skip button on the WorkIt panel in a batch tab's page, as the student does. */
async function skip(page: Page): Promise<void> {
  // Skip is the ⋯ menu's (KAN-369 Q4), there once the fill drew its panel.
  const host = page.locator("#workit-autofiller-overlay-host");
  await host.locator("[data-skip]").waitFor({ state: "attached", timeout: 30_000 });
  await (await menuItem(host, "Skip")).click();
}

test("Skip marks the job skipped, closes its tab, and the batch goes on", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms(["greenhouse-arc", "greenhouse-purestorage"]);
  const api = new FakeApi().queue(
    { id: "job-0", apply_url: forms.url("greenhouse-arc") },
    { id: "job-1", apply_url: forms.url("greenhouse-purestorage") },
  );
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  await sendFromWebapp(await openWebapp(), { type: "run/open" });
  const groupOf = async (url: string) => (await tabs(loaded!.worker)).find((t) => t.url === url)?.group;
  await expect.poll(() => groupOf(forms.url("greenhouse-arc")), { timeout: 60_000 }).toBe("Ready");
  await expect.poll(() => groupOf(forms.url("greenhouse-purestorage")), { timeout: 60_000 }).toBe("Needs you");

  await skip(loaded.context.pages().find((p) => p.url() === forms.url("greenhouse-purestorage"))!);

  await expect.poll(async () => (await tabs(loaded!.worker)).map((t) => t.url)).not.toContain(forms.url("greenhouse-purestorage"));
  await expect.poll(() => api.stages.get("job-1")).toBe("skipped");
  // The other tab is left as it was, and the batch carries on without the skipped job.
  expect(await groupOf(forms.url("greenhouse-arc"))).toBe("Ready");
  expect(api.stages.get("job-0")).toBe("queued");
  expect(await loaded.worker.evaluate(async () => Object.values((await chrome.storage.local.get("workit_batch")).workit_batch.tabs).map((t: any) => t.jobId))).toEqual(["job-0"]);
  expect(forms.submissions).toEqual([]);
});

test("Workday applications fill one at a time while other job systems fill beside them", async () => {
  test.setTimeout(150_000);
  const forms = new SavedForms(["greenhouse-arc", "greenhouse-purestorage"]);
  const workdays = new FakeWorkdays(["workday-caci", "workday-xcel"]);
  const api = new FakeApi().queue(
    { id: "wd-0", apply_url: workdays.url(0) },
    { id: "gh-0", apply_url: forms.url("greenhouse-arc") },
    { id: "wd-1", apply_url: workdays.url(1) },
    { id: "gh-1", apply_url: forms.url("greenhouse-purestorage") },
  );
  loaded = await loadExtension([api.handler, webapp, workdays.handler, forms.handler]);
  await signIn(loaded.context);
  await sendFromWebapp(await openWebapp(), { type: "run/open" });
  const urls = async () => (await tabs(loaded!.worker)).map((t) => t.url);
  const groupOf = async (url: string) => (await tabs(loaded!.worker)).find((t) => t.url === url)?.group;
  // A Workday tab saves each filled step itself (Fill to Review), so it is found on any step of its application.
  const steps = (n: number) => workdays.url(n).replace(/\d+$/, "");
  const workdayGroup = async (n: number) => (await tabs(loaded!.worker)).find((t) => t.url.startsWith(steps(n)))?.group;

  // The first Workday application and both Greenhouse forms fill; the second Workday one waits for its slot.
  await expect.poll(() => groupOf(forms.url("greenhouse-purestorage")), { timeout: 60_000 }).toBe("Needs you");
  await expect.poll(() => groupOf(forms.url("greenhouse-arc")), { timeout: 60_000 }).toBe("Ready");
  await expect.poll(() => workdayGroup(0), { timeout: 60_000 }).toBe("Needs you");
  const first = loaded.context.pages().find((p) => p.url().startsWith(steps(0)))!;
  await expect.poll(() => firstName(first, workdays), { timeout: 30_000 }).toBe("Test");
  expect((await urls()).some((u) => u.startsWith(steps(1)))).toBe(false);

  // Once the first leaves the batch, the second takes the slot.
  await skip(first);
  await expect.poll(() => workdayGroup(1), { timeout: 60_000 }).toBe("Needs you");
  expect((await urls()).some((u) => u.startsWith(steps(0)))).toBe(false);
  expect(api.stages.get("wd-0")).toBe("skipped");
  expect([...forms.submissions, ...workdays.submissions]).toEqual([]);
});

test("on Workday's sign-in, fills the student's one login at a new company and an older saved login where one is kept, only in the browser", async () => {
  test.setTimeout(180_000);
  const workdays = new FakeWorkdays(["workday-caci", "workday-xcel"]);
  const api = new FakeApi().queue(
    { id: "wd-0", apply_url: workdays.postingUrl(0) },
    { id: "wd-1", apply_url: workdays.signInUrl(1, "signin") },
    { id: "wd-2", apply_url: workdays.signInUrl(0, "signin") },
  );
  // Every request the browser sends but the Workday tenants' own sign-in, to look for the passwords in.
  const sent: string[] = [];
  const spy: Handler = ({ url, body }) => {
    if (url.pathname !== "/__fake__/account") sent.push(url.href + body.toString());
    return undefined;
  };
  loaded = await loadExtension([spy, api.handler, webapp, workdays.handler]);
  await signIn(loaded.context);
  await saveWorkdaySignup(loaded);
  // Made up: a password generated for Xcel alone by an install from before KAN-479; its account was made with it.
  const older = { email: "test.person@example.com", password: "Older-Generated-Xcel-Pass-3#" };
  await loaded.worker.evaluate((login) => chrome.storage.local.set({ workday_logins: { "xcelenergy.wd1.myworkdayjobs.com": login } }), older);
  await sendFromWebapp(await openWebapp(), { type: "run/open" });
  const page = async (url: string) => {
    await expect.poll(() => loaded!.context.pages().some((p) => p.url() === url), { timeout: 30_000 }).toBe(true);
    return loaded!.context.pages().find((p) => p.url() === url)!;
  };
  const box = (p: Page, id: string) => p.locator(`[data-automation-id=${id}]`);
  const saved = () => loaded!.worker.evaluate(async () => (await chrome.storage.local.get("workday_logins")).workday_logins ?? {});
  const panel = (p: Page) => p.locator("#workit-autofiller-overlay-host .row").filter({ hasText: "Sign in to continue" });

  // The first company's posting has no form: the batch tab presses Apply, then Apply Manually, which loads Create Account as a new page.
  await page(workdays.postingUrl(0));
  // Create Account there: the student's one email and password, typed twice, and no new password made.
  const caci = await page(workdays.signInUrl(0));
  await expect.poll(() => box(caci, "verifyPassword").inputValue(), { timeout: 30_000 }).toBe(WORKDAY_SIGNUP.password);
  expect(await box(caci, "email").inputValue()).toBe(WORKDAY_SIGNUP.email);
  expect(await box(caci, "password").inputValue()).toBe(WORKDAY_SIGNUP.password);
  expect(await saved()).toEqual({ "xcelenergy.wd1.myworkdayjobs.com": older, "caci.wd1.myworkdayjobs.com": { ...WORKDAY_SIGNUP, signup: true } });
  // It waits for the student in Needs you, and never presses Create Account itself.
  await expect(panel(caci)).toBeVisible();
  await expect.poll(async () => (await tabs(loaded!.worker)).find((t) => t.url === workdays.signInUrl(0))?.group).toBe("Needs you");
  expect(workdays.signIns).toEqual([]);

  // The student presses Create Account; once signed in, the fill goes on by itself.
  await box(caci, "click_filter").click();
  await caci.waitForURL(workdays.url(0));
  // A batch tab saves the filled step itself (Fill to Review), so the name shows on the step or was saved from it.
  await expect.poll(() => firstName(caci, workdays), { timeout: 30_000 }).toBe("Test");
  expect(workdays.signIns).toEqual([{ host: "caci.wd1.myworkdayjobs.com", view: "create", ...WORKDAY_SIGNUP }]);

  // The next company opens on Sign In, where an older login is saved: it fills that one, not the student's new one.
  await skip(caci);
  const xcel = await page(workdays.signInUrl(1, "signin"));
  await expect.poll(() => box(xcel, "password").inputValue(), { timeout: 30_000 }).toBe(older.password);
  expect(await box(xcel, "email").inputValue()).toBe(older.email);
  await box(xcel, "click_filter").click();
  await xcel.waitForURL(workdays.url(1));
  expect(workdays.signIns[1]).toEqual({ host: "xcelenergy.wd1.myworkdayjobs.com", view: "signin", ...older });

  // Back on the first company later, its Sign In takes the same login.
  await skip(xcel);
  const again = await page(workdays.signInUrl(0, "signin"));
  await expect.poll(() => box(again, "password").inputValue(), { timeout: 30_000 }).toBe(WORKDAY_SIGNUP.password);
  expect(await box(again, "email").inputValue()).toBe(WORKDAY_SIGNUP.email);

  // Neither password went anywhere but the company's own Workday.
  expect(sent.filter((r) => r.includes(WORKDAY_SIGNUP.password) || r.includes(older.password))).toEqual([]);
  expect(workdays.submissions).toEqual([]);
});
