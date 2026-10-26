// The panel's shell (KAN-394): one panel docked to the right edge of the job
// page, full height, over the page, that collapses to an edge tab the student
// drags up and down and can hide. Batch tabs open it once their fill is done;
// a job form outside a batch shows only the edge tab; other pages nothing.
// Anduril's saved Greenhouse form.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";
// How Anduril heard of the student: a guess, a row the fill always shows.
const HEARD = "question_13130335007";
// A page that is no job form.
const NEWS = "https://news.example.org/today";
const news: Handler = ({ url }) =>
  url.host === "news.example.org" ? { headers: { "content-type": "text/html" }, body: "<!doctype html><title>News</title><h1>Today</h1><form><input name=q></form>" } : undefined;

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");
const panelOf = (page: Page) => hostOf(page).locator(".panel");
const edgeTab = (page: Page) => hostOf(page).getByRole("button", { name: "Show WorkIt panel" });

async function start(handlers: Handler[] = []): Promise<{ forms: SavedForms; api: FakeApi }> {
  const forms = new SavedForms([ANDURIL]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(ANDURIL) });
  loaded = await loadExtension([api.handler, webapp, forms.handler, news, ...handlers]);
  await signIn(loaded.context);
  return { forms, api };
}

/** Runs a batch of Anduril's form; resolves with its tab once it needs the student. */
async function batchTab(api: FakeApi, forms: SavedForms): Promise<Page> {
  const webappPage = await loaded.context.newPage();
  await webappPage.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(webappPage, { type: "run/open" });
  await expect.poll(() => api.stages.get("job-0"), { timeout: 60_000 }).toBe("needs_you");
  const form = loaded.context.pages().find((p) => p.url() === forms.url(ANDURIL) && p !== webappPage && !p.isClosed())!;
  await expect(form.locator(`#workit-autofiller-overlay-host [data-key="${HEARD}"] .source`)).toHaveText("Guessed");
  return form;
}

/** Anduril's form opened by the student, outside any batch. */
async function ownTab(forms: SavedForms): Promise<Page> {
  const page = await loaded.context.newPage();
  await page.goto(forms.url(ANDURIL));
  return page;
}

test("a batch tab's panel opens docked right, full height, over the page, with its rows", async () => {
  test.setTimeout(120_000);
  const { api, forms } = await start();
  const form = await batchTab(api, forms);
  // The employer's own styles, as loud as a page can make them.
  await form.addStyleTag({ content: "* { color: red !important; font-size: 40px !important; }" });

  const view = form.viewportSize()!;
  const box = (await panelOf(form).boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(370);
  expect(box.width).toBeLessThanOrEqual(390);
  expect(Math.round(box.x + box.width)).toBe(view.width);
  expect(box.y).toBe(0);
  expect(Math.round(box.height)).toBe(view.height);
  await expect(hostOf(form).locator(`[data-key="${HEARD}"]`)).toBeVisible();
  // Over the page: the page keeps its whole width.
  expect(await form.evaluate(() => Math.round(document.body.getBoundingClientRect().width + parseFloat(getComputedStyle(document.body).marginLeft) * 2))).toBe(
    await form.evaluate(() => document.documentElement.clientWidth),
  );
  // The page's styles don't reach the panel.
  const label = hostOf(form).locator(`[data-key="${HEARD}"] .label`);
  expect(await label.evaluate((el) => getComputedStyle(el).fontSize)).not.toBe("40px");
  expect(await label.evaluate((el) => getComputedStyle(el).color)).not.toBe("rgb(255, 0, 0)");
  expect(forms.submissions).toEqual([]);
});

test("a job form outside a batch shows only the edge tab; another page shows nothing", async () => {
  test.setTimeout(90_000);
  const { forms } = await start();
  const page = await ownTab(forms);
  await expect(edgeTab(page)).toBeVisible({ timeout: 15_000 });
  await expect(panelOf(page)).toBeHidden();

  const other = await loaded.context.newPage();
  await other.goto(NEWS);
  await other.waitForTimeout(4000);
  await expect(hostOf(other)).toHaveCount(0);
  expect(forms.submissions).toEqual([]);
});

test("the edge tab opens the panel, and its Autofill This Page fills the form", async () => {
  test.setTimeout(120_000);
  const { forms } = await start();
  const page = await ownTab(forms);
  await edgeTab(page).click({ timeout: 15_000 });
  await expect(panelOf(page)).toBeVisible();

  await hostOf(page).getByRole("button", { name: "Autofill This Page" }).click();
  await expect(hostOf(page).locator(`[data-key="${HEARD}"] .source`)).toHaveText("Guessed", { timeout: 60_000 });
  await expect(panelOf(page)).toBeVisible();
  await expect(hostOf(page).getByRole("button", { name: "Fill Again" })).toBeVisible();
  expect(forms.submissions).toEqual([]);
});

test("the edge tab keeps where it was dragged, and its hides, on this site", async () => {
  test.setTimeout(120_000);
  const { forms } = await start();
  const page = await ownTab(forms);
  const tab = edgeTab(page);
  const before = (await tab.boundingBox({ timeout: 15_000 }))!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2 + 200, { steps: 8 });
  await page.mouse.up();
  await expect(panelOf(page)).toBeHidden(); // a drag isn't a press
  const dragged = (await tab.boundingBox())!;
  expect(Math.round(dragged.y - before.y)).toBe(200);
  expect(Math.round(dragged.x + dragged.width)).toBe(page.viewportSize()!.width);

  await page.reload();
  await expect.poll(async () => Math.round((await tab.boundingBox())?.y ?? -1), { timeout: 15_000 }).toBe(Math.round(dragged.y));

  // Hide until next visit: gone now, back on the next visit.
  await hostOf(page).getByRole("button", { name: "WorkIt tab options" }).click();
  await hostOf(page).getByRole("menuitem", { name: "Hide until next visit" }).click();
  await expect(tab).toBeHidden();
  await page.reload();
  await expect(tab).toBeVisible({ timeout: 15_000 });

  // Hide on this site: gone, and still gone on the next visit.
  await hostOf(page).getByRole("button", { name: "WorkIt tab options" }).click();
  await hostOf(page).getByRole("menuitem", { name: "Hide on this site" }).click();
  await expect(tab).toBeHidden();
  await page.reload();
  await page.waitForTimeout(4000);
  await expect(tab).toBeHidden();
});

test("a site where the student collapsed the panel keeps it collapsed in the next batch tab", async () => {
  test.setTimeout(120_000);
  const { api, forms } = await start();
  const page = await ownTab(forms);
  await edgeTab(page).click({ timeout: 15_000 });
  await hostOf(page).getByRole("button", { name: "Collapse" }).click();
  await expect(panelOf(page)).toBeHidden();
  await expect(edgeTab(page)).toBeVisible();
  await page.close();

  const form = await batchTab(api, forms);
  await expect(panelOf(form)).toBeHidden();
  await expect(edgeTab(form)).toBeVisible();
  await edgeTab(form).click();
  await expect(hostOf(form).locator(`[data-key="${HEARD}"]`)).toBeVisible();
});
