// A Workday tenant's dropdown choices, kept across its Postings (decisions
// 1770-1799): the Fill engine returns each dropdown's choices as a tree
// marked `list`, the extension keeps them with the tenant's nested-prompt
// trees (chrome.storage `workday_trees`, background.js), and the next fill on
// that tenant reads the dropdown from them instead of opening it.
import { expect, test } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { FakeWorkdays } from "./fake-job-systems";
import { STEPS } from "../fill-engine/test/fake-workday";
import { loadExtension, sendFromWebapp, signIn, webapp, type Loaded } from "./loaded-extension";

let loaded: Loaded | undefined;
test.afterEach(async () => {
  await loaded?.close();
  loaded = undefined;
});

const TENANT = "caci.wd1.myworkdayjobs.com";
const PHONE_TYPE = `${TENANT} / list / My Information / Phone Device Type`;

/** Fills the fake tenant's first step in a batch tab, `trees` saved before; the tab, and the lists it opened. */
async function fillStep(trees: Record<string, unknown> = {}) {
  const workdays = new FakeWorkdays(["workday-caci"], [STEPS[0]]);
  const api = new FakeApi().queue({ id: "wd-0", apply_url: workdays.url(0) });
  loaded = await loadExtension([api.handler, webapp, workdays.handler]);
  await loaded.worker.evaluate((saved) => chrome.storage.local.set({ workday_trees: saved }), trees);
  await signIn(loaded.context);
  // Each dropdown's list the page opens (a prompt's is another), counted on the tenant's page.
  await loaded.context.addInitScript(() => {
    new MutationObserver((changes) => {
      for (const c of changes) for (const n of c.addedNodes) if ((n as Element).getAttribute?.("data-automation-id") === "listbox") (window as any).__listsOpened = ((window as any).__listsOpened ?? 0) + 1;
    }).observe(document, { childList: true, subtree: true });
  });
  const app = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await app.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(app, { type: "run/open" });
  await expect.poll(() => loaded!.context.pages().some((p) => p.url() === workdays.url(0)), { timeout: 30_000 }).toBe(true);
  const tab = loaded.context.pages().find((p) => p.url() === workdays.url(0))!;
  const phone = tab.locator("[data-automation-id=formField-phoneType] button");
  await expect(phone).toHaveText("Mobile", { timeout: 60_000 });
  await expect(tab.locator("[data-automation-id=listbox]")).toHaveCount(0);
  return { tab, workdays, opened: await tab.evaluate(() => (window as any).__listsOpened ?? 0) };
}

test("a Workday tenant's dropdown choices are kept after its fill, and its next fill doesn't open a dropdown to read them", async () => {
  test.setTimeout(180_000);
  const first = await fillStep();
  const saved = await loaded!.worker.evaluate(async () => (await chrome.storage.local.get("workday_trees")).workday_trees);
  expect(saved[PHONE_TYPE]).toEqual({ shown: ["Home", "Mobile", "Work"], categories: {}, list: true });
  expect(first.workdays.submissions).toEqual([]);
  await loaded!.close();

  // The tenant's next Posting: its three dropdowns (Country, State, Phone Device Type) read from what was
  // kept, so each opens only to be filled.
  const next = await fillStep(saved);
  expect(next.opened).toBe(first.opened - 3);
  expect(next.workdays.submissions).toEqual([]);
});
