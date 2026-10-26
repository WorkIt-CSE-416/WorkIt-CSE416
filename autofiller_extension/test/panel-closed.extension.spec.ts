// The panel lives in the employer's page, so the page's own scripts must not
// read it or press it: its shadow root is closed (content/panel.js), and every
// panel action that changes something takes the student's own clicks only
// (event.isTrusted, ui.js's trusted). Arc's saved Greenhouse form, outside a
// batch: the static launcher draws the panel's edge tab.
import { expect, test } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, signIn, webapp, type Loaded } from "./loaded-extension";

const ARC = "greenhouse-arc";
let loaded: Loaded;
test.afterEach(() => loaded?.close());

test("the page's scripts find no panel button or text behind the closed root", async () => {
  test.setTimeout(90_000);
  const forms = new SavedForms([ARC]);
  loaded = await loadExtension([new FakeApi().handler, webapp, forms.handler], { closedPanel: true });
  await signIn(loaded.context);
  const page = await loaded.context.newPage();
  await page.goto(forms.url(ARC));
  await page.waitForFunction(() => document.getElementById("workit-autofiller-overlay-host"), null, { timeout: 30_000 });
  const seen = await page.evaluate(() => {
    const host = document.getElementById("workit-autofiller-overlay-host")!;
    return {
      root: host.shadowRoot === null,
      text: host.innerText + host.textContent,
      buttons: [...document.querySelectorAll("[data-report], [data-open], [data-settings], [data-claude]")].length,
    };
  });
  expect(seen).toEqual({ root: true, text: "", buttons: 0 });
});

test("a page script's click on Send report sends nothing; the student's click sends it", async () => {
  test.setTimeout(90_000);
  const forms = new SavedForms([ARC]);
  const api = new FakeApi();
  // The root open (the tests' copy), as a page would reach it if it could: the click must still do nothing.
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const page = await loaded.context.newPage();
  await page.goto(forms.url(ARC));
  const host = page.locator("#workit-autofiller-overlay-host");
  await host.getByRole("button", { name: "Show WorkIt panel" }).click({ timeout: 30_000 });
  await host.getByRole("button", { name: "Report a problem" }).click();
  const send = host.getByRole("button", { name: "Send report" });
  await expect(send).toBeVisible();

  await page.evaluate(() => {
    const root = document.getElementById("workit-autofiller-overlay-host")!.shadowRoot!;
    const button = [...root.querySelectorAll("button")].find((b) => b.textContent === "Send report")!;
    button.click();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  });
  await page.waitForTimeout(1_500);
  expect(api.reports).toEqual([]);

  await send.click();
  await expect.poll(() => api.reports.length).toBe(1);
});
