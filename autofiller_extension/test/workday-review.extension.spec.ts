// Fill to Review (KAN-369), end to end in the loaded extension on the fake
// Workday tenant (fake-job-systems.ts): a batch tab, or a tab where the
// student pressed Fill to Review, fills each step and, with nothing left for
// the student, presses Workday's Save and Continue once, until Review, where
// it stops and tells the student to check everything and press Submit. A step
// with something for the student stops the walk there. Submit is never pressed.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { FakeWorkdays } from "./fake-job-systems";
import { CONTENT_SCRIPT_FILES, ENGINE_FILES } from "../src/shared/content-scripts.js";
import { loadExtension, sendFromWebapp, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

let loaded: Loaded | undefined;
test.afterEach(async () => {
  await loaded?.close();
  loaded = undefined;
});

const overlay = (p: Page) => p.locator("#workit-autofiller-overlay-host");
const NAME = [
  { key: "legalName--firstName", label: "First Name", kind: "text", required: true },
  { key: "legalName--lastName", label: "Last Name", kind: "text", required: true },
] as const;
const REVIEW_NOTE = "Check everything on Workday's Review page, then press Submit.";

/** Starts a batch of one Workday application on `workdays`' first tenant: its tab. */
async function batchTab(workdays: FakeWorkdays, first: Handler[] = [], before?: () => Promise<unknown>, api = new FakeApi()): Promise<Page> {
  api.queue({ id: "wd-0", apply_url: workdays.url(0) });
  loaded = await loadExtension([...first, api.handler, webapp, workdays.handler]);
  await before?.();
  await signIn(loaded.context);
  const app = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await app.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(app, { type: "run/open" });
  await expect.poll(() => loaded!.context.pages().some((p) => p.url().startsWith(workdays.url(0).replace(/\/1$/, "/"))), { timeout: 30_000 }).toBe(true);
  return loaded.context.pages().find((p) => p.url().startsWith(workdays.url(0).replace(/\/1$/, "/")))!;
}

test("in a batch tab, saves each filled step itself up to Workday's Review, then stops there and never submits", async () => {
  test.setTimeout(180_000);
  const workdays = new FakeWorkdays(["workday-caci"], [
    ["My Information", [...NAME]],
    ["Application Questions", [{ key: "preferredName", label: "Preferred First Name", kind: "text" }, ...NAME]],
  ]);
  const tab = await batchTab(workdays);

  await tab.waitForURL(workdays.url(0, 3), { timeout: 90_000 });
  await expect(tab.locator("[data-automation-id=applyFlowReviewPage]")).toBeVisible();
  await expect(overlay(tab)).toContainText(REVIEW_NOTE, { timeout: 30_000 });
  // Both steps were saved with WorkIt's answers, and Review's Submit was left to the student.
  await expect(tab.locator("[data-automation-id=applyFlowReviewPage]")).toContainText("legalName--firstName");
  await tab.waitForTimeout(5_000);
  expect(tab.url()).toBe(workdays.url(0, 3));
  expect(workdays.submissions).toEqual([]);
});

test("stops at a step with something for the student, and says why, without pressing Save and Continue", async () => {
  test.setTimeout(180_000);
  const workdays = new FakeWorkdays(["workday-caci"], [
    ["My Information", [...NAME]],
    ["Application Questions", [...NAME, { key: "badge", label: "What is your employee badge number?", kind: "text", required: true }]],
  ]);
  const tab = await batchTab(workdays);

  // The first step had nothing for the student: saved. The second asks something WorkIt has no answer for.
  await tab.waitForURL(workdays.url(0, 2), { timeout: 90_000 });
  await expect(overlay(tab)).toContainText("What is your employee badge number?", { timeout: 60_000 });
  await expect(overlay(tab)).toContainText(/WorkIt stopped on this step/, { timeout: 30_000 });
  await tab.waitForTimeout(5_000);
  expect(tab.url()).toBe(workdays.url(0, 2));
  await expect(tab.locator("[data-automation-id=errorHeading]")).toBeHidden();
  expect(workdays.submissions).toEqual([]);
});

test("outside a batch, walks to Review only once the student presses Fill to Review", async () => {
  test.setTimeout(180_000);
  const workdays = new FakeWorkdays(["workday-caci"], [["My Information", [...NAME]], ["Application Questions", [...NAME]]]);
  loaded = await loadExtension([new FakeApi().handler, webapp, workdays.handler]);
  await signIn(loaded.context);
  const tab = await loaded.context.newPage();
  await tab.goto(workdays.url(0));
  // Autofill This Page.
  await loaded.worker.evaluate(async ([engine, scripts]) => {
    const [{ id }] = await chrome.tabs.query({ url: "https://*/__fake__/apply/*" });
    await chrome.scripting.executeScript({ target: { tabId: id! }, func: () => void ((window as any).WIA = { running: true }) });
    await chrome.scripting.executeScript({ target: { tabId: id! }, world: "MAIN", files: engine });
    void chrome.scripting.executeScript({ target: { tabId: id! }, files: scripts });
  }, [ENGINE_FILES, CONTENT_SCRIPT_FILES]);

  const button = overlay(tab).getByRole("button", { name: "Fill to Review" });
  await expect(button).toBeVisible({ timeout: 60_000 });
  await tab.waitForTimeout(3_000);
  expect(tab.url()).toBe(workdays.url(0)); // nothing pressed before the student asks
  await button.click();

  await tab.waitForURL(workdays.url(0, 3), { timeout: 90_000 });
  await expect(overlay(tab)).toContainText(REVIEW_NOTE, { timeout: 60_000 });
  await tab.waitForTimeout(3_000);
  expect(workdays.submissions).toEqual([]);
});

// Apply's walk (resume-2027 apply workday.py _next), as live Workday answers a press.
test("presses Save and Continue again when Workday drops the press, as Applied Materials' did live", async () => {
  test.setTimeout(180_000);
  // Each step drops its first press: the button never disables, nothing changes.
  const workdays = new FakeWorkdays(["workday-caci"], [["My Information", [...NAME]], ["Application Questions", [...NAME]]], [{ droppedSaves: 1 }]);
  const tab = await batchTab(workdays);

  // Well inside the 30 s a single press would wait, per step.
  await tab.waitForURL(workdays.url(0, 3), { timeout: 40_000 });
  await expect(overlay(tab)).toContainText(REVIEW_NOTE, { timeout: 30_000 });
  await tab.waitForTimeout(3_000);
  expect(workdays.submissions).toEqual([]);
});

test("never presses again once a dropped press leaves the button reading Submit", async () => {
  test.setTimeout(120_000);
  // The first press is dropped (nothing changes), and the tenant then relabels its footer button Submit.
  const workdays = new FakeWorkdays(["workday-caci"], [["My Information", [...NAME]], ["Application Questions", [...NAME]]], [{ droppedSaves: 1 }]);
  const tab = await batchTab(workdays, [], () =>
    loaded!.context.addInitScript(() => {
      (window as any).__presses = 0;
      document.addEventListener("click", (event) => {
        const next = (event.target as Element).closest?.("[data-automation-id=pageFooterNextButton]");
        if (!next) return;
        (window as any).__presses++;
        setTimeout(() => (next.textContent = "Submit"), 0);
      }, true);
    }),
  );

  await expect(overlay(tab)).toContainText("which WorkIt never presses", { timeout: 40_000 });
  expect(await tab.evaluate(() => (window as any).__presses)).toBe(1);
  expect(tab.url()).toBe(workdays.url(0, 1));
  expect(workdays.submissions).toEqual([]);
});

test("walks on when Workday flashes an error mid-save and then shows the next step, as Adobe's did live", async () => {
  test.setTimeout(180_000);
  const workdays = new FakeWorkdays(["workday-caci"], [["My Information", [...NAME]], ["Application Questions", [...NAME]]], [{ flashesError: true }]);
  const tab = await batchTab(workdays);

  await tab.waitForURL(workdays.url(0, 3), { timeout: 90_000 });
  await expect(overlay(tab)).toContainText(REVIEW_NOTE, { timeout: 30_000 });
  await expect(overlay(tab)).not.toContainText("Workday didn't take this step");
  expect(workdays.submissions).toEqual([]);
});

test("saves two steps of one name drawn in place on a link that never changes, each once", async () => {
  test.setTimeout(180_000);
  const workdays = new FakeWorkdays(["workday-caci"], [
    ["My Information", [...NAME]],
    ["Application Questions", [...NAME]],
    ["Application Questions", [{ key: "preferredName", label: "Preferred First Name", kind: "text" }, ...NAME]],
  ]);
  workdays.inPlace.add("caci.wd1.myworkdayjobs.com");
  workdays.samePath.add("caci.wd1.myworkdayjobs.com");
  const tab = await batchTab(workdays);

  // Review shows on the first step's link, the two Application Questions each saved by the walk without a 30 s wait.
  await expect(tab.locator("[data-automation-id=applyFlowReviewPage]")).toBeVisible({ timeout: 60_000 });
  await expect(overlay(tab)).toContainText(REVIEW_NOTE, { timeout: 30_000 });
  expect(tab.url()).toBe(workdays.url(0));
  expect(workdays.submissions).toEqual([]);
});

test("stops at once, saying so, when Workday shows Something went wrong after the press", async () => {
  test.setTimeout(180_000);
  const workdays = new FakeWorkdays(["workday-caci"], [["My Information", [...NAME]], ["Application Questions", [...NAME]]]);
  workdays.inPlace.add("caci.wd1.myworkdayjobs.com");
  // The first step's save draws Workday's error page in its place (Salesforce's, live), its step bar gone.
  const wrong: Handler = (request) => {
    if (request.method === "POST" && request.url.pathname === "/__fake__/apply/1") return { json: { next: "/__fake__/wrong" } };
    if (request.url.pathname === "/__fake__/wrong") return { headers: { "content-type": "text/html" }, body: "<!doctype html><body><h2>Something went wrong</h2><p>Please refresh the page and then try again.</p></body>" };
    return undefined;
  };
  const tab = await batchTab(workdays, [wrong]);

  // Well inside the 30 s the walk waits for a step that never shows.
  await expect(overlay(tab)).toContainText("Workday showed \"Something went wrong\"", { timeout: 25_000 });
  expect(workdays.submissions).toEqual([]);
});

test("a step WorkIt can't plan is left for the student, and the next step they move to is filled as it shows", async () => {
  test.setTimeout(180_000);
  const PREFERRED = { key: "preferredName", label: "Preferred First Name", kind: "text", required: true } as const;
  const workdays = new FakeWorkdays(["workday-caci"], [["My Information", [...NAME]], ["Application Questions", [PREFERRED]], ["Voluntary Disclosures", [...NAME]]]);
  workdays.inPlace.add("caci.wd1.myworkdayjobs.com");
  const api = new FakeApi();
  // The first step's save takes the profile down (and its cached copy), so the second step's Plan fails.
  const down: Handler = async (request) => {
    if (request.method !== "POST" || request.url.pathname !== "/__fake__/apply/1") return undefined;
    api.profileDown = true;
    await loaded!.worker.evaluate(() => chrome.storage.local.remove("workit_autofill_profile"));
    return undefined;
  };
  const tab = await batchTab(workdays, [down], undefined, api);

  await tab.waitForURL(workdays.url(0, 2), { timeout: 90_000 });
  await expect(overlay(tab)).toContainText("WorkIt couldn't fill this step", { timeout: 60_000 });
  await expect(overlay(tab)).toContainText("Answer it yourself, then press Save and Continue.");
  await expect.poll(() => api.stages.get("wd-0"), { timeout: 30_000 }).toBe("needs_you");
  // The walker leaves the step alone: no press, so no error banner for the empty required field.
  await tab.waitForTimeout(5_000);
  expect(tab.url()).toBe(workdays.url(0, 2));
  await expect(tab.locator("[data-automation-id=errorHeading]")).toBeHidden();

  // The student answers it and saves; the next step is WorkIt's again, filled and saved by the walk up to Review.
  api.profileDown = false;
  await tab.locator(`[data-automation-id="formField-${PREFERRED.key}"] input`).fill("Made up");
  await tab.locator("[data-automation-id=pageFooterNextButton]").click();
  await tab.waitForURL(workdays.url(0, 4), { timeout: 90_000 });
  await expect(overlay(tab)).toContainText(REVIEW_NOTE, { timeout: 30_000 });
  expect(workdays.saved(0)).toMatchObject({ preferredName: "Made up", "legalName--firstName": "Test" });
  expect(workdays.submissions).toEqual([]);
});
