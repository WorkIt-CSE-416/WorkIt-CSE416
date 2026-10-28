// Live progress (KAN-398, KAN-369 Q1): while a form fills, the panel's button
// area says "Scanning this page", then "N fields found", then "Autofilling ·
// 37%" over a bar, with Cancel; the checklist under it lists every field.
// Cancel halts the fill between fields; a field stuck for 5 s shows Skip on
// its checklist row, which leaves it for the student, marked red. Workday steps say "Stay on this
// page until WorkIt finishes this step." until the step is filled.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { FakeWorkdays, SavedForms } from "./fake-job-systems";
import { loadExtension, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";
// Where Greenhouse's presigned uploads go (fake-job-systems.ts answers them at once).
const UPLOADS = "https://uploads.fake-storage.test";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");
const primaryOf = (page: Page) => hostOf(page).locator('[data-slot="primary"]');
const progressOf = (page: Page) => primaryOf(page).locator("[data-progress]");
const saidOf = (page: Page) => progressOf(page).locator("[data-progress-said]");
const listOf = (page: Page) => hostOf(page).locator('[data-tab="autofill"]');

async function start(handlers: Handler[]): Promise<void> {
  loaded = await loadExtension([new FakeApi().handler, webapp, ...handlers]);
  await signIn(loaded.context);
}

/** Anduril's form opened by the student, with Autofill This Page pressed; returns the page, every progress line seen and the bar's every count. */
async function pressAutofill(forms: SavedForms): Promise<{ page: Page; lines: () => Promise<string[]>; counts: () => Promise<number[]> }> {
  const page = await loaded.context.newPage();
  await page.goto(forms.url(ANDURIL));
  await hostOf(page).getByRole("button", { name: "Show WorkIt panel" }).click({ timeout: 15_000 });
  // Every line the progress shows, in order, recorded in the page as it changes.
  await page.evaluate(() => {
    const seen: string[] = ((window as any).progressLines = []);
    const counts: number[] = ((window as any).progressCounts = []);
    const root = document.querySelector("#workit-autofiller-overlay-host")!.shadowRoot!;
    new MutationObserver(() => {
      const text = root.querySelector("[data-progress-said]")?.textContent ?? "";
      if (text && seen[seen.length - 1] !== text) seen.push(text);
      const now = root.querySelector(".progress-bar")?.getAttribute("aria-valuenow");
      if (now !== null && now !== undefined && counts[counts.length - 1] !== Number(now)) counts.push(Number(now));
    }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await primaryOf(page).getByRole("button", { name: "Autofill This Page" }).click();
  return {
    page,
    lines: () => page.evaluate(() => (window as any).progressLines as string[]),
    counts: () => page.evaluate(() => (window as any).progressCounts as number[]),
  };
}

/** Greenhouse's upload store, held for a minute: the résumé's field never settles. */
const stuckUploads: Handler = async (request) => {
  if (request.url.origin !== UPLOADS || request.method === "OPTIONS") return undefined;
  await new Promise((done) => setTimeout(done, 60_000));
  return { status: 201 };
};

test("the scanning, found and filling states show in order with the right counts, then go", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([ANDURIL]);
  await start([forms.handler]);
  const { page, lines, counts } = await pressAutofill(forms);

  await expect(primaryOf(page).locator(".primary-button").first()).toContainText(/^Answer \d+ of \d+$/, { timeout: 60_000 });
  await expect(progressOf(page)).toHaveCount(0);
  const seen = await lines();
  expect(seen[0]).toBe("Scanning this page");
  expect(seen[1]).toMatch(/^\d+ fields found$/);
  const filling = seen.filter((line) => line.startsWith("Autofilling"));
  expect(filling[0]).toBe("Autofilling · 0%");
  expect(filling[filling.length - 1]).toBe("Autofilling · 100%");
  // Counted up one field at a time.
  const counted = await counts();
  expect(counted.length).toBeGreaterThan(4);
  expect(counted).toEqual([...Array(counted.length).keys()]);
  expect(forms.submissions).toEqual([]);
});

test("Stop autofill leaves the later fields unfilled and the panel says the fill was stopped", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([ANDURIL]);
  await start([forms.handler]);
  const { page } = await pressAutofill(forms);

  await expect(saidOf(page)).toHaveText(/^Autofilling · [1-9]\d*%$/, { timeout: 60_000 });
  const rowsAtStop = await listOf(page).locator('.row[data-mark="filled"]').count();
  await progressOf(page).getByRole("button", { name: "Cancel" }).click();

  await expect(listOf(page).getByText("You stopped the fill", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(progressOf(page)).toHaveCount(0);
  // The résumé (Greenhouse's files go last) was never reached.
  expect(await page.locator(".file-upload__filename").count()).toBe(0);
  await expect(listOf(page).locator('.row[data-mark="needs-you"]').getByText("Not filled: you stopped the fill.").first()).toBeVisible();
  expect(rowsAtStop).toBeGreaterThan(0);
  expect(forms.submissions).toEqual([]);
});

test("a field that never settles shows Skip on its row after 5 s; Skip moves on and marks it red", async () => {
  test.setTimeout(150_000);
  const forms = new SavedForms([ANDURIL]);
  await start([stuckUploads, forms.handler]);
  const { page } = await pressAutofill(forms);

  const stuck = listOf(page).locator(".row[data-stuck]");
  await expect(stuck).toHaveCount(1, { timeout: 60_000 });
  const skip = stuck.getByRole("button", { name: "Skip" });
  await expect(skip).toBeVisible();
  const key = await stuck.getAttribute("data-key");
  await skip.click();

  await expect(primaryOf(page).locator(".primary-button").first()).toContainText(/^Answer \d+ of \d+$/, { timeout: 30_000 });
  const row = listOf(page).locator(`.row[data-key="${key}"]`);
  await expect(row).toHaveAttribute("data-mark", "needs-you");
  await expect(row).toContainText("You skipped this. Answer it yourself.");
  expect(forms.submissions).toEqual([]);
});

test("a Workday step says to stay on the page until it is filled, and the notice goes after", async () => {
  test.setTimeout(120_000);
  const workdays = new FakeWorkdays(["workday-caci"]);
  await start([workdays.handler]);
  const page = await loaded.context.newPage();
  await page.goto(workdays.url(0));
  await hostOf(page).getByRole("button", { name: "Show WorkIt panel" }).click({ timeout: 20_000 });
  // Recorded in the page as it shows: a fake step can fill faster than a test polls.
  await page.evaluate(() => {
    const host = document.querySelector("#workit-autofiller-overlay-host")!;
    (window as any).stayShown = false;
    setInterval(() => {
      const stay = host.shadowRoot?.querySelector<HTMLElement>("[data-progress-stay]");
      if (stay && !stay.hidden && stay.textContent === "Stay on this page until WorkIt finishes this step.") (window as any).stayShown = true;
    }, 10);
  });
  await primaryOf(page).getByRole("button", { name: "Fill this step" }).click();
  await expect(page.locator("[data-automation-id=formField-legalName--firstName] input")).not.toHaveValue("", { timeout: 60_000 });
  await expect(progressOf(page)).toHaveCount(0, { timeout: 30_000 });
  expect(await page.evaluate(() => (window as any).stayShown)).toBe(true);
  expect(workdays.submissions).toEqual([]);
});
