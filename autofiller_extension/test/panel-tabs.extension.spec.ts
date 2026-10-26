// The panel's tabs and its grouped Autofill list (KAN-397): Autofill,
// Résumé and Answers under the button, and the Autofill tab's rows grouped
// by what they ask of the student (Needs you, Check these, Waiting for your
// Claude, then Filled, collapsed to its count), not in form order.
// Anduril's saved Greenhouse form, filled as a batch tab: one guess (how
// Anduril heard of the student), two questions WorkIt has no answer to, and
// the rest filled.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Loaded } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";
const HEARD = "question_13130335007";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

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

const hostOf = (form: Page) => form.locator("#workit-autofiller-overlay-host");
const groupOf = (form: Page, name: string) => hostOf(form).locator(`.group[data-group="${name}"]`);

test("the guess is listed under Check these, above Filled collapsed to its count", async () => {
  test.setTimeout(120_000);
  const { form, forms } = await anduril();
  const host = hostOf(form);

  const groups = await host.locator(".group").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.group));
  expect(groups).toEqual(["needs-you", "check", "filled"]);
  await expect(groupOf(form, "check").locator(".group-head")).toHaveText("Check these 1");
  await expect(groupOf(form, "check").locator(`[data-key="${HEARD}"]`)).toBeVisible();
  await expect(groupOf(form, "needs-you").locator(".group-head")).toHaveText("Needs you 2");

  // Filled is collapsed to its count; a press opens it, and its rows still go to their fields.
  const filled = groupOf(form, "filled");
  const head = filled.locator(".group-head");
  await expect(head).toHaveText("20 filled");
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await expect(filled.locator('[data-key="first_name"]')).toBeHidden();
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  await filled.locator('[data-key="first_name"] .label').click();
  await expect(form.locator("#first_name")).toBeFocused();
  expect(forms.submissions).toEqual([]);
});

test("the counts follow the rows: a guess that looks right moves to Filled, its Undo still in sight", async () => {
  test.setTimeout(120_000);
  const { form } = await anduril();
  const heard = hostOf(form).locator(`[data-key="${HEARD}"]`);

  await heard.getByRole("button", { name: "Looks right" }).click();

  await expect(groupOf(form, "check")).toHaveCount(0);
  await expect(groupOf(form, "filled").locator(".group-head")).toHaveText("21 filled");
  await expect(groupOf(form, "filled").locator(`[data-key="${HEARD}"]`)).toBeVisible();
  await heard.getByRole("button", { name: "Undo" }).click();
  await expect(groupOf(form, "check").locator(".group-head")).toHaveText("Check these 1");
  await expect(groupOf(form, "filled").locator(".group-head")).toHaveText("20 filled");
});

test("the three tabs switch, and the tab chosen is kept while the browser tab is open", async () => {
  test.setTimeout(120_000);
  const { form } = await anduril();
  const host = hostOf(form);
  const tabs = host.getByRole("tab");
  await expect(tabs).toHaveText(["Autofill", "Résumé", "Answers"]);
  await expect(host.getByRole("tab", { name: "Autofill" })).toHaveAttribute("aria-selected", "true");

  await host.getByRole("tab", { name: "Answers" }).click();
  await expect(host.getByRole("tab", { name: "Answers" })).toHaveAttribute("aria-selected", "true");
  await expect(host.locator(`[data-key="${HEARD}"]`)).toBeHidden();
  await expect(host.getByRole("tabpanel")).toHaveCount(1);
  await expect(host.getByRole("tabpanel")).toHaveAttribute("data-tab", "answers");

  // The page loads again in the same tab: the panel comes back on Answers.
  await form.reload();
  await loaded.worker.evaluate(async (url) => (globalThis as any).workitToolbar((await chrome.tabs.query({ url }))[0]), form.url());
  await expect(host.locator(".panel")).toBeVisible();
  await expect(host.getByRole("tab", { name: "Answers" })).toHaveAttribute("aria-selected", "true");
});
