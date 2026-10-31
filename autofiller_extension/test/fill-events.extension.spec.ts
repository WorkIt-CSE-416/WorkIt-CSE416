// Fill numbers (KAN-476, decided in KAN-454): after every fill, single or
// batch, the extension sends one event (POST /fill-events) with the job
// system, the engine's and the extension's versions, the field counts, the
// failed fields' error names and how long the fill took, never a value. The
// fake API checks every event's shape and that no value of the student's is
// in it. The panel's settings have the opt-out: off, nothing is sent.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, menuItem, sendFromWebapp, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

const ARC = "greenhouse-arc";
const ANDURIL = "greenhouse-anduril";
const ENGINE = execFileSync("node", ["build.mjs", "--version"], { cwd: path.join(__dirname, "..", "fill-engine") }).toString().trim();
const MANIFEST_VERSION = require("../manifest.json").version;

let loaded: Loaded;
test.afterEach(() => loaded?.close());

// A broken fill on Arc's form: the name box turns what is typed into "Pat", so it fails read-back.
function breakingFirstName(forms: SavedForms): Handler {
  const script = `window.addEventListener("input", (e) => { if (e.target.id !== "first_name") return; e.stopImmediatePropagation(); e.target.value = "Pat"; }, true);`;
  return async (request) => {
    const reply = await forms.handler(request);
    if (!reply || request.method !== "GET" || request.url.href !== forms.url(ARC)) return reply;
    return { ...reply, body: String(reply.body).replace("<head>", `<head><script>${script}</script>`) };
  };
}

const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");
// The panel's button once a fill is done (KAN-396): something to answer, or the review.
const DONE = /^(Answer \d+ of \d+|Review and Submit)$/i;
const mainButton = (page: Page) => hostOf(page).locator('[data-slot="primary"] .primary-button').first();

/** The student opens a form and presses the panel's Autofill This Page; resolves once the fill is done. */
async function fillOwnTab(url: string): Promise<Page> {
  const page = await loaded.context.newPage();
  await page.goto(url);
  await hostOf(page).getByRole("button", { name: "Show WorkIt panel" }).click({ timeout: 15_000 });
  await expect(mainButton(page)).toHaveText("Autofill This Page");
  await mainButton(page).click();
  await expect(mainButton(page)).toHaveText(DONE, { timeout: 60_000 });
  return page;
}

test("a single fill sends one event with its counts and error names, and no value", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([ARC]);
  const api = new FakeApi();
  loaded = await loadExtension([api.handler, webapp, breakingFirstName(forms)]);
  await signIn(loaded.context);
  const page = await fillOwnTab(forms.url(ARC));

  await expect.poll(() => api.fillEvents.length).toBe(1);
  const [event] = api.fillEvents as any[];
  expect(event).toMatchObject({ job_system: "greenhouse", engine_version: ENGINE, extension_version: MANIFEST_VERSION, mode: "single" });
  // The broken name box is a failed field, named by its error: the drop the fill-health page shows.
  expect(event.failed).toBeGreaterThanOrEqual(1);
  expect(event.errors.Readback).toBeGreaterThanOrEqual(1);
  expect(event.filled).toBeGreaterThan(0);
  expect(event.fields).toBeGreaterThanOrEqual(event.filled + event.failed);
  expect(event.guessed).toBeLessThanOrEqual(event.filled);
  expect(event.duration_ms).toBeGreaterThan(0);
  expect(api.fillEventProblems).toEqual([]);

  // The student's edits after the fill send nothing more: one fill, one event.
  await page.locator("#first_name").fill("Someone");
  await page.waitForTimeout(1_500);
  expect(api.fillEvents).toHaveLength(1);
});

test("each tab of a batch sends one event, marked batch", async () => {
  test.setTimeout(150_000);
  const forms = new SavedForms([ARC, ANDURIL]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(ARC) }, { id: "job-1", apply_url: forms.url(ANDURIL) });
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const app = await loaded.context.newPage();
  await app.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(app, { type: "run/open" });
  // A ready tab stays queued (it waits for the student's submit), so the events say when both fills ended.
  await expect.poll(() => api.fillEvents.length, { timeout: 90_000 }).toBe(2);
  await loaded.context.pages()[0].waitForTimeout(1_500);
  expect(api.fillEvents).toHaveLength(2);
  expect(api.fillEvents.map((e: any) => [e.job_system, e.mode])).toEqual([["greenhouse", "batch"], ["greenhouse", "batch"]]);
  expect(api.fillEventProblems).toEqual([]);
});

test("with Send fill numbers off in the panel's settings, a fill sends nothing", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([ANDURIL]);
  const api = new FakeApi();
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const page = await loaded.context.newPage();
  await page.goto(forms.url(ANDURIL));
  const host = hostOf(page);
  await host.getByRole("button", { name: "Show WorkIt panel" }).click({ timeout: 15_000 });
  await (await menuItem(host, "Settings")).click();
  const box = host.locator('[data-slot="settings"] [data-fill-numbers]');
  await expect(box).toBeChecked();
  await box.uncheck();
  await host.locator('[data-slot="settings"] [data-back]').click();

  await mainButton(page).click();
  await expect(mainButton(page)).toHaveText(DONE, { timeout: 60_000 });
  await page.waitForTimeout(1_500);
  expect(api.fillEvents).toEqual([]);
});
