// The toolbar popup off job pages, tailored to what the student is doing
// (KAN-424, background/popup-home.js): with no batch, the queue and Start
// Auto Apply, which opens the batch as the webapp's Start does; with an
// empty queue, Find Jobs. The batch case is panel-shell's popup test.
import { expect, test } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { EXTENSION_ID, loadExtension, signIn, webapp, type Loaded } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

test("with jobs queued and no batch, the popup offers Start Auto Apply, which opens the batch", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([ANDURIL]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(ANDURIL) });
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);

  const popup = await loaded.context.newPage();
  await popup.goto(`chrome-extension://${EXTENSION_ID}/src/popup/popup.html`);
  await expect(popup.getByRole("heading", { name: "Auto Apply" })).toBeVisible();
  await expect(popup.getByText("1 job queued.")).toBeVisible();
  await popup.getByRole("button", { name: "Start Auto Apply" }).click();
  // The batch opens the queued job's form in its own tab, as the webapp's Start does.
  await expect.poll(() => loaded.context.pages().some((p) => p.url() === forms.url(ANDURIL)), { timeout: 30_000 }).toBe(true);
  expect(forms.submissions).toEqual([]);
});

test("with an empty queue, the popup says so and offers Find Jobs", async () => {
  test.setTimeout(60_000);
  loaded = await loadExtension([new FakeApi().handler, webapp]);
  await signIn(loaded.context);

  const popup = await loaded.context.newPage();
  await popup.goto(`chrome-extension://${EXTENSION_ID}/src/popup/popup.html`);
  await expect(popup.getByText("Your queue is empty. Queue jobs on WorkIt to apply to them here.")).toBeVisible();
  await expect(popup.getByRole("button", { name: "Find Jobs" })).toBeVisible();
  await expect(popup.getByRole("button", { name: "Start Auto Apply" })).toHaveCount(0);
});
