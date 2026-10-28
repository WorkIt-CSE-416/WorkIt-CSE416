// iCIMS (KAN-369), end to end in the loaded extension on the Fill engine's
// fake iCIMS career site (fill-engine/test/fake-icims.ts): every page is in
// iCIMS's own iframe, the panel on the top page. Its sign-in is the student's
// (the panel says so; nothing is typed there), then each step fills as it
// shows, and Fill to Review presses iCIMS's Next on each step that needs
// nothing from the student, stopping on the step whose button is Submit.
// Submit is never pressed.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { ICIMS_HOST, ICIMS_JOB, icimsPage, type IcimsStep } from "../fill-engine/test/fake-icims";
import { CONTENT_SCRIPT_FILES, ENGINE_FILES } from "../src/shared/content-scripts.js";
import { loadExtension, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

let loaded: Loaded | undefined;
test.afterEach(async () => {
  await loaded?.close();
  loaded = undefined;
});

const overlay = (p: Page) => p.locator("#workit-autofiller-overlay-host");
const frame = (p: Page) => p.frameLocator("#icims_content_iframe");
const NAME_STEPS: IcimsStep[] = [
  { path: "candidate", title: "Profile", fields: [{ id: "icims_f_firstName", label: "First Name", kind: "text", required: true }, { id: "icims_f_lastName", label: "Last Name", kind: "text", required: true }] },
  { path: "questions", title: "Questions", fields: [{ id: "icims_f_preferred", label: "Preferred Name", kind: "text" }] },
  { path: "eeo", title: "EEO", button: "Submit", fields: [] },
];

/** The fake iCIMS tenant: its top page and its frame's pages; `sent` records a press of Submit. */
function icims(steps: IcimsStep[], sent: { submitted: boolean }): Handler {
  return ({ url }) => {
    if (url.hostname !== ICIMS_HOST) return undefined;
    if (url.pathname.endsWith("/submit")) sent.submitted = true;
    return { headers: { "content-type": "text/html; charset=utf-8" }, body: icimsPage(url, { steps }) };
  };
}

/** Opens the application at `path` and starts the fill as Autofill This Page does. */
async function open(path: string, sent: { submitted: boolean }): Promise<Page> {
  loaded = await loadExtension([new FakeApi().handler, webapp, icims(NAME_STEPS, sent)]);
  await signIn(loaded.context);
  const tab = await loaded.context.newPage();
  await tab.goto(`${ICIMS_JOB}/${path}`);
  await frame(tab).locator("body").waitFor();
  await loaded.worker.evaluate(async ([engine, scripts]) => {
    const [{ id }] = await chrome.tabs.query({ url: "https://*.icims.com/*" });
    await chrome.scripting.executeScript({ target: { tabId: id! }, func: () => void ((window as any).WIA = { running: true }) });
    await chrome.scripting.executeScript({ target: { tabId: id! }, world: "MAIN", files: engine });
    void chrome.scripting.executeScript({ target: { tabId: id! }, files: scripts });
  }, [ENGINE_FILES, CONTENT_SCRIPT_FILES]);
  return tab;
}

test("the sign-in is the student's: the panel says so, nothing is typed, and the first step fills once they pass it", async () => {
  test.setTimeout(120_000);
  const sent = { submitted: false };
  const tab = await open("login", sent);

  await expect(overlay(tab)).toContainText("Sign in to iCIMS", { timeout: 30_000 });
  await tab.waitForTimeout(2_000);
  await expect(frame(tab).locator("#email")).toHaveValue("");
  await expect(frame(tab).locator("#accept_gdpr")).not.toBeChecked();

  // The student signs in.
  await frame(tab).locator("#email").fill("test.person@example.com");
  await frame(tab).locator("#accept_gdpr").check();
  await frame(tab).locator("#enterEmailSubmitButton").click();

  await expect(frame(tab).locator("#icims_f_firstName")).toHaveValue("Test", { timeout: 60_000 });
  await expect(overlay(tab)).toContainText("iCIMS: Profile", { timeout: 30_000 });
});

test("Fill to Review presses iCIMS's Next on each step with nothing for the student, then stops where Submit is and never submits", async () => {
  test.setTimeout(180_000);
  const sent = { submitted: false };
  const tab = await open("candidate", sent);

  const button = overlay(tab).getByRole("button", { name: "Fill to Review" });
  await expect(button).toBeVisible({ timeout: 60_000 });
  await tab.waitForTimeout(2_000);
  expect(await frame(tab).locator("h2.iCIMS_SubHeader").innerText()).toBe("Profile"); // nothing pressed before the student asks
  await button.click();

  await expect(frame(tab).locator("h2.iCIMS_SubHeader")).toHaveText("EEO", { timeout: 90_000 });
  await expect(overlay(tab)).toContainText("Check everything on iCIMS's last page, then press Submit.", { timeout: 60_000 });
  await tab.waitForTimeout(3_000);
  expect(sent.submitted).toBe(false);
});

test("a closed iCIMS job says so instead of waiting for the sign-in", async () => {
  test.setTimeout(120_000);
  const sent = { submitted: false };
  loaded = await loadExtension([new FakeApi().handler, webapp, icims(NAME_STEPS, sent)]);
  await signIn(loaded.context);
  const tab = await loaded.context.newPage();
  await tab.goto(`https://${ICIMS_HOST}/jobs/search?ss=1&notFound=1`);
  await loaded.worker.evaluate(async ([engine, scripts]) => {
    const [{ id }] = await chrome.tabs.query({ url: "https://*.icims.com/*" });
    await chrome.scripting.executeScript({ target: { tabId: id! }, func: () => void ((window as any).WIA = { running: true }) });
    await chrome.scripting.executeScript({ target: { tabId: id! }, world: "MAIN", files: engine });
    void chrome.scripting.executeScript({ target: { tabId: id! }, files: scripts });
  }, [ENGINE_FILES, CONTENT_SCRIPT_FILES]);

  await expect(overlay(tab)).toContainText("This job is closed", { timeout: 30_000 });
});
