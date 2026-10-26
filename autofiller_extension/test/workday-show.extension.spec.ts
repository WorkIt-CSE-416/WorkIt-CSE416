// On Workday, a panel row and Next Thing That Needs You go to the field on
// the step shown (KAN-369): Workday's rows are keyed "<step> / <label>", as
// the Fill engine names its questions, and the field is found the engine's
// way, by its formField container and label (batch-tab.js's fieldOf,
// workday.js's fieldOf).
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { FakeWorkdays } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Loaded, pressNextThing } from "./loaded-extension";

const WHY = "Why are you interested in working at CACI?";
const FIRST = "My Information / First Name";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

/** A batch of one Workday application, its first step filled: the tab, and the fake tenant. */
async function workdayTab(): Promise<{ tab: Page; workdays: FakeWorkdays }> {
  const workdays = new FakeWorkdays(["workday-caci"], [
    ["My Information", [
      { key: "legalName--firstName", label: "First Name", kind: "text", required: true },
      { key: "legalName--lastName", label: "Last Name", kind: "text", required: true },
      { key: "whyCaci", label: WHY, kind: "textarea", required: true },
    ]],
  ]);
  const api = new FakeApi().queue({ id: "wd-0", apply_url: workdays.url(0) });
  loaded = await loadExtension([api.handler, webapp, workdays.handler]);
  await signIn(loaded.context);
  const app = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await app.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(app, { type: "run/open" });
  await expect.poll(() => loaded.context.pages().some((p) => p.url() === workdays.url(0)), { timeout: 30_000 }).toBe(true);
  const tab = loaded.context.pages().find((p) => p.url() === workdays.url(0))!;
  // Filled: the question for the student's Claude waits on the panel.
  await expect(tab.locator(`#workit-autofiller-overlay-host .row[data-key="My Information / ${WHY}"]`)).toBeVisible({ timeout: 60_000 });
  await expect(tab.locator("[data-automation-id=formField-legalName--firstName] input")).not.toHaveValue("", { timeout: 30_000 });
  return { tab, workdays };
}

test("on Workday, pressing a row focuses and rings its field on the step shown", async () => {
  test.setTimeout(120_000);
  const { tab, workdays } = await workdayTab();

  // A filled row: its group is collapsed to "N filled" until pressed (KAN-397).
  await tab.locator('#workit-autofiller-overlay-host .group[data-group="filled"] .group-head').click();
  await tab.locator(`#workit-autofiller-overlay-host .row[data-key="${FIRST}"] .label`).click();

  await expect(tab.locator("[data-automation-id=formField-legalName--firstName] input")).toBeFocused();
  await expect(tab.locator("#workit-marks-host .ring")).toBeVisible();
  await expect(tab.locator(`#workit-autofiller-overlay-host .row[data-key="${FIRST}"]`)).toHaveAttribute("data-current", "");
  await expect(tab.locator("#workit-autofiller-overlay-host").getByText(/can't find this field|This is on Workday's/)).toHaveCount(0);
  expect(workdays.submissions).toEqual([]);
});

test("on Workday, Next Thing That Needs You walks to a field on the step", async () => {
  test.setTimeout(120_000);
  const { tab, workdays } = await workdayTab();
  const panel = tab.locator("#workit-autofiller-overlay-host");
  const why = `My Information / ${WHY}`;

  // The step's note may come first; the walk reaches the question waiting for the student's Claude.
  const current = async () => ((await panel.locator("[data-current]").count()) ? panel.locator("[data-current]").getAttribute("data-key") : null);
  for (let n = 0; n < 5 && (await current()) !== why; n++) {
    await pressNextThing(loaded, panel);
    await tab.waitForTimeout(500);
  }

  await expect(panel.locator("[data-current]")).toHaveAttribute("data-key", why);
  await expect(tab.locator("[data-automation-id=formField-whyCaci] textarea")).toBeFocused();
  await expect(tab.locator("#workit-marks-host .ring")).toBeVisible();
  expect(workdays.submissions).toEqual([]);
});
