// Oracle Recruiting Cloud (KAN-369), end to end in the loaded extension on the
// Fill engine's fake Oracle application (fill-engine/test/fake-oracle.ts):
// its email gate is the student's (the panel says so; nothing is typed there),
// then each section fills as it shows, and Fill to Review presses Oracle's
// Next on each section that needs nothing from the student, stopping at
// Summary. Submit is never pressed.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { ORACLE_HOST, ORACLE_JOB, oracleHtml, type OracleSection } from "../fill-engine/test/fake-oracle";
import { CONTENT_SCRIPT_FILES, ENGINE_FILES } from "../src/shared/content-scripts.js";
import { loadExtension, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

let loaded: Loaded | undefined;
test.afterEach(async () => {
  await loaded?.close();
  loaded = undefined;
});

const overlay = (p: Page) => p.locator("#workit-autofiller-overlay-host");
const NAME_SECTIONS: OracleSection[] = [
  { title: "Personal Info", fields: [{ key: "firstName", label: "First Name", kind: "text", required: true }, { key: "lastName", label: "Last Name", kind: "text", required: true }] },
  { title: "More About You", fields: [{ key: "preferred", label: "Preferred Name", kind: "text" }] },
  { title: "Summary", fields: [] },
];

/** The fake Oracle tenant: its application page, and its requisition API (the job's title and place). */
function oracle(opts: { gate?: boolean; sections?: OracleSection[] }): Handler {
  return ({ url }) => {
    if (url.hostname !== ORACLE_HOST) return undefined;
    if (url.pathname.includes("recruitingCEJobRequisitionDetails")) {
      return { json: { items: [{ Title: "Software Intern", PrimaryLocation: "Columbus, OH, United States" }] } };
    }
    return { headers: { "content-type": "text/html" }, body: oracleHtml(opts) };
  };
}

/** Opens the application at `path` and starts the fill as Autofill This Page does. */
async function open(opts: { gate?: boolean; sections?: OracleSection[] }, path: string): Promise<Page> {
  loaded = await loadExtension([new FakeApi().handler, webapp, oracle(opts)]);
  await signIn(loaded.context);
  const tab = await loaded.context.newPage();
  await tab.goto(`${ORACLE_JOB}${path}`);
  await loaded.worker.evaluate(async ([engine, scripts]) => {
    const [{ id }] = await chrome.tabs.query({ url: "https://*.oraclecloud.com/*" });
    await chrome.scripting.executeScript({ target: { tabId: id! }, func: () => void ((window as any).WIA = { running: true }) });
    await chrome.scripting.executeScript({ target: { tabId: id! }, world: "MAIN", files: engine });
    void chrome.scripting.executeScript({ target: { tabId: id! }, files: scripts });
  }, [ENGINE_FILES, CONTENT_SCRIPT_FILES]);
  return tab;
}

test("the email gate is the student's: the panel says so, nothing is typed, and the first section fills once they pass it", async () => {
  test.setTimeout(120_000);
  const tab = await open({ gate: true, sections: NAME_SECTIONS }, "/apply/email");

  await expect(overlay(tab)).toContainText("Enter your email", { timeout: 30_000 });
  await tab.waitForTimeout(2_000);
  await expect(tab.locator("[name=primary-email]")).toHaveValue("");
  await expect(tab.locator("[name=honeypot]")).toHaveValue("");
  await expect(tab.locator("#terms")).not.toBeChecked();

  // The student passes the gate.
  await tab.fill("[name=primary-email]", "test.person@example.com");
  await tab.check("#terms");
  await tab.locator(".apply-flow-dialog__button").click();

  await expect(tab.locator("[name=firstName]")).toHaveValue("Test", { timeout: 60_000 });
  await expect(overlay(tab)).toContainText("Oracle: Personal Info", { timeout: 30_000 });
});

test("Fill to Review presses Oracle's Next on each section with nothing for the student, then stops at Summary and never submits", async () => {
  test.setTimeout(180_000);
  const tab = await open({ sections: NAME_SECTIONS }, "/apply/section/1");

  const button = overlay(tab).getByRole("button", { name: "Fill to Review" });
  await expect(button).toBeVisible({ timeout: 60_000 });
  await tab.waitForTimeout(2_000);
  expect(new URL(tab.url()).pathname).toMatch(/\/apply\/section\/1$/); // nothing pressed before the student asks
  await button.click();

  await expect.poll(() => new URL(tab.url()).pathname, { timeout: 90_000 }).toMatch(/\/apply\/section\/3$/);
  await expect(overlay(tab)).toContainText("Check everything on Oracle's Summary page, then press Submit.", { timeout: 60_000 });
  await tab.waitForTimeout(3_000);
  expect(await tab.evaluate(() => (window as any).__fakeOracleSubmitted)).toBeNull();
});

test("a closed Oracle job says so instead of waiting for the email", async () => {
  test.setTimeout(120_000);
  const closed: Handler = ({ url }) => (url.hostname === ORACLE_HOST && !url.pathname.includes("hcmRestApi")
    ? { headers: { "content-type": "text/html" }, body: "<!doctype html><html><body><h1>This job is no longer available.</h1></body></html>" } : undefined);
  loaded = await loadExtension([new FakeApi().handler, webapp, closed]);
  await signIn(loaded.context);
  const tab = await loaded.context.newPage();
  await tab.goto(ORACLE_JOB);
  await loaded.worker.evaluate(async ([engine, scripts]) => {
    const [{ id }] = await chrome.tabs.query({ url: "https://*.oraclecloud.com/*" });
    await chrome.scripting.executeScript({ target: { tabId: id! }, func: () => void ((window as any).WIA = { running: true }) });
    await chrome.scripting.executeScript({ target: { tabId: id! }, world: "MAIN", files: engine });
    void chrome.scripting.executeScript({ target: { tabId: id! }, files: scripts });
  }, [ENGINE_FILES, CONTENT_SCRIPT_FILES]);

  await expect(overlay(tab)).toContainText("This job is closed", { timeout: 30_000 });
});
