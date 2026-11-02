// Install, update and uninstall (KAN-471), in the loaded extension: an
// install opens onboarding's extension step, an update migrates what an
// older version stored (stored-data.js; its rules are stored-data.spec.ts),
// and removing the extension opens WorkIt's one-question survey.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type BrowserContext } from "@playwright/test";
import { MAX_WORKDAY_TREES, STORAGE_VERSION, STORAGE_VERSION_KEY } from "../src/background/stored-data.js";
import { loadExtension, webapp, type Loaded } from "./loaded-extension";

const WEB = "http://localhost:3000";
const ONBOARDING = `${WEB}/onboarding/applicant?step=extension`;

let loaded: Loaded;
test.afterEach(() => loaded?.close());

/** The URLs of the context's open tabs. */
const urls = (context: BrowserContext) => context.pages().map((page) => page.url());

test("installing opens onboarding's extension step on WorkIt", async () => {
  loaded = await loadExtension([webapp], { welcome: true });

  await expect.poll(() => urls(loaded.context), { timeout: 15_000 }).toContain(ONBOARDING);
  expect(await loaded.worker.evaluate((key) => chrome.storage.local.get(key), STORAGE_VERSION_KEY)).toEqual({ [STORAGE_VERSION_KEY]: STORAGE_VERSION });
});

test("an update migrates the unversioned storage, and opens no onboarding tab", async () => {
  // A kept profile, started again with a newer version: an update to Chrome (onInstalled's reason "update").
  const profile = mkdtempSync(join(tmpdir(), "workit-update-"));
  try {
    loaded = await loadExtension([webapp], { profile });
    // The shape before KAN-471: no version, and every Workday list ever read.
    const lists = Object.fromEntries(
      Array.from({ length: MAX_WORKDAY_TREES + 40 }, (_, n) => [`acme / list / Question ${n}`, { shown: [`Choice ${n}`], categories: {}, list: true }]),
    );
    await expect.poll(() => loaded.worker.evaluate((key) => chrome.storage.local.get(key), STORAGE_VERSION_KEY)).not.toEqual({});
    await loaded.worker.evaluate(async ([key, workday_trees]) => {
      await chrome.storage.local.remove(key);
      await chrome.storage.local.set({ workday_trees });
    }, [STORAGE_VERSION_KEY, lists] as const);
    await loaded.close();

    loaded = await loadExtension([webapp], { profile, welcome: true, version: "99.0.0" });
    const read = () => loaded.worker.evaluate(async (key) => {
      const stored = await chrome.storage.local.get([key, "workday_trees"]);
      return { version: stored[key], lists: stored.workday_trees };
    }, STORAGE_VERSION_KEY);
    await expect.poll(async () => (await read()).version, { timeout: 15_000 }).toBe(STORAGE_VERSION);
    const { lists: kept } = await read();
    // Capped, and now [key, tree] pairs, which keep their save order.
    expect(Array.isArray(kept)).toBe(true);
    expect(kept).toHaveLength(MAX_WORKDAY_TREES);
    await loaded.worker.evaluate(() => new Promise((done) => setTimeout(done, 1000)));
    expect(urls(loaded.context)).not.toContain(ONBOARDING);
  } finally {
    await loaded.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test("removing the extension opens WorkIt's survey page, with the version it removed", async () => {
  loaded = await loadExtension([webapp]);
  const version = await loaded.worker.evaluate(() => chrome.runtime.getManifest().version);
  // The uninstall URL is set once the install's handler has run.
  await expect.poll(() => loaded.asked.some((url) => url.startsWith(WEB)), { timeout: 15_000 }).toBe(true);
  await loaded.worker.evaluate(() => new Promise((done) => setTimeout(done, 500)));

  const opened = loaded.context.waitForEvent("page");
  await loaded.worker.evaluate(() => chrome.management.uninstallSelf()).catch(() => {});
  const survey = await opened;
  await expect.poll(() => survey.url(), { timeout: 15_000 }).toBe(`${WEB}/uninstalled?v=${version}`);
});
