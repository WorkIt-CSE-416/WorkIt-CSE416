// The panel after the student collapses it (KAN-369, KAN-394): Collapse
// leaves the edge tab on the page, and the edge tab or the toolbar icon
// bring back the same rows, nothing filled again. And a panel row takes the
// student to its field.
// Anduril's saved Greenhouse form, filled as a batch tab.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Loaded } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";
// How Anduril heard of the student: a guess, the panel's yellow row.
const HEARD = "question_13130335007";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

/** Runs a batch of Anduril's form; resolves with its tab once it needs the student. */
async function anduril(): Promise<{ form: Page; forms: SavedForms }> {
  const forms = new SavedForms([ANDURIL]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(ANDURIL) });
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const webappPage = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await webappPage.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(webappPage, { type: "run/open" });
  await expect.poll(() => api.stages.get("job-0"), { timeout: 60_000 }).toBe("needs_you");
  const form = loaded.context.pages().find((p) => p.url() === forms.url(ANDURIL))!;
  await expect(form.locator(`#workit-autofiller-overlay-host [data-key="${HEARD}"] .source`)).toHaveText("Guessed");
  return { form, forms };
}

/** Counts the Plans the background is asked for (one per fill). */
async function countPlans(): Promise<() => Promise<number>> {
  await loaded.worker.evaluate(() => {
    (globalThis as any).plans = 0;
    chrome.runtime.onMessage.addListener((message: any) => {
      if (message?.type === "fill/plan") (globalThis as any).plans += 1;
    });
  });
  return () => loaded.worker.evaluate(() => (globalThis as any).plans as number);
}

/** The toolbar icon's press on `form`'s tab (a job page: no popup, the icon opens and closes the panel). */
async function pressToolbar(form: Page): Promise<void> {
  await loaded.worker.evaluate(async (url) => (globalThis as any).workitToolbar((await chrome.tabs.query({ url }))[0]), form.url());
}

const panelOf = (form: Page) => form.locator("#workit-autofiller-overlay-host .panel");

test("after Collapse, the toolbar icon brings back the same rows without filling again", async () => {
  test.setTimeout(120_000);
  const { form, forms } = await anduril();
  const plans = await countPlans();
  const rows = await panelOf(form).locator(".row").allTextContents();

  await form.locator("#workit-autofiller-overlay-host").getByRole("button", { name: "Collapse" }).click();
  await expect(panelOf(form)).toBeHidden();

  await pressToolbar(form);

  await expect(panelOf(form)).toBeVisible();
  expect(await panelOf(form).locator(".row").allTextContents()).toEqual(rows);
  expect(await plans()).toBe(0);
  expect(forms.submissions).toEqual([]);
});

test("after Collapse, the edge tab left on the page brings the panel back", async () => {
  test.setTimeout(120_000);
  const { form } = await anduril();
  const plans = await countPlans();
  const host = form.locator("#workit-autofiller-overlay-host");

  await host.getByRole("button", { name: "Collapse" }).click();
  await host.getByRole("button", { name: "Show WorkIt panel" }).click();

  await expect(panelOf(form)).toBeVisible();
  await expect(host.locator(`[data-key="${HEARD}"] .source`)).toHaveText("Guessed");
  expect(await plans()).toBe(0);
});

test("pressing a yellow row scrolls to its field, focuses it and rings it", async () => {
  test.setTimeout(120_000);
  const { form } = await anduril();
  await form.evaluate(() => window.scrollTo(0, 0));

  await form.locator(`#workit-autofiller-overlay-host [data-key="${HEARD}"] .label`).click();

  await expect(form.locator(`#${HEARD}`)).toBeFocused();
  await expect(form.locator(`#${HEARD}`)).toBeInViewport();
  await expect(form.locator("#workit-marks-host .ring")).toBeVisible();
  await expect(form.locator(`#workit-autofiller-overlay-host [data-key="${HEARD}"]`)).toHaveAttribute("data-current", "");
});
