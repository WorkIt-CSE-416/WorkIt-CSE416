// SAP SuccessFactors (KAN-369), end to end in the loaded extension: its sign-in
// (the live page, saved in the Fill engine's fixtures/forms/successfactors-acuity)
// is the student's (the panel says so; nothing is typed there), and signed in,
// the application fills off the page (the engine's fake SuccessFactors page,
// fill-engine/test/fake-successfactors.ts). Apply is never pressed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SF_FORM, SF_HOST, successFactorsHtml, type SfPage } from "../fill-engine/test/fake-successfactors";
import { CONTENT_SCRIPT_FILES, ENGINE_FILES } from "../src/shared/content-scripts.js";
import { loadExtension, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

let loaded: Loaded | undefined;
test.afterEach(async () => {
  await loaded?.close();
  loaded = undefined;
});

const overlay = (p: Page) => p.locator("#workit-autofiller-overlay-host");
const SIGN_IN = readFileSync(join(__dirname, "../fill-engine/test/fixtures/forms/successfactors-acuity/sign-in.html"), "utf8");
const NAME_PAGES: SfPage[] = [{ sections: [{ title: "Contact Information", fields: [
  { key: "firstName", label: "First Name", kind: "text", required: true }, { key: "lastName", label: "Last Name", kind: "text", required: true }] }] }];

function careerSite(body: string): Handler {
  return ({ url }) => (url.hostname === SF_HOST ? { headers: { "content-type": "text/html" }, body } : undefined);
}

/** Opens the career site's page and starts the fill as Autofill This Page does. */
async function open(body: string): Promise<Page> {
  loaded = await loadExtension([new FakeApi().handler, webapp, careerSite(body)]);
  await signIn(loaded.context);
  const tab = await loaded.context.newPage();
  await tab.goto(SF_FORM);
  await loaded.worker.evaluate(async ([engine, scripts]) => {
    const [{ id }] = await chrome.tabs.query({ url: "https://*.successfactors.com/*" });
    await chrome.scripting.executeScript({ target: { tabId: id! }, func: () => void ((window as any).WIA = { running: true }) });
    await chrome.scripting.executeScript({ target: { tabId: id! }, world: "MAIN", files: engine });
    void chrome.scripting.executeScript({ target: { tabId: id! }, files: scripts });
  }, [ENGINE_FILES, CONTENT_SCRIPT_FILES]);
  return tab;
}

test("the sign-in is the student's: the panel says so and nothing is typed", async () => {
  test.setTimeout(120_000);
  const tab = await open(SIGN_IN);

  await expect(overlay(tab)).toContainText("Sign in to SuccessFactors, then press Fill", { timeout: 30_000 });
  await tab.waitForTimeout(2_000);
  await expect(tab.locator("#username")).toHaveValue("");
  await expect(tab.locator("#password")).toHaveValue("");
});

test("signed in, the application fills off the page and Apply is never pressed", async () => {
  test.setTimeout(120_000);
  const tab = await open(successFactorsHtml({ pages: NAME_PAGES }));

  await expect(tab.locator("#firstName")).toHaveValue("Test", { timeout: 60_000 });
  await expect(overlay(tab)).toContainText("SuccessFactors: Application", { timeout: 30_000 });
  await tab.waitForTimeout(2_000);
  expect(await tab.evaluate(() => (window as any).__fakeSuccessFactorsSubmitted)).toBeNull();
});
