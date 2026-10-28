// The panel's tabs and its Autofill checklist (KAN-397, KAN-369 Q1-Q2):
// Autofill, Résumé and Answers under the button, and every field of the
// Autofill tab listed with its mark (red, amber ?, green check).
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
const marked = (form: Page, mark: string) => hostOf(form).locator(`[data-tab="autofill"] .row[data-key][data-mark="${mark}"]`);

test("the checklist marks the guess to check and the two empty questions red; every filled row shows and goes to its field", async () => {
  test.setTimeout(120_000);
  const { form, forms } = await anduril();
  const host = hostOf(form);

  await expect(host.locator('[data-tab="autofill"] .section-head')).toHaveText(["Required", "Optional"]);
  await expect(marked(form, "check")).toHaveCount(1);
  await expect(marked(form, "check")).toHaveAttribute("data-key", HEARD);
  await expect(marked(form, "needs-you")).toHaveCount(2);
  await expect(marked(form, "filled")).toHaveCount(20);
  // Filled rows are listed, not collapsed, and still go to their fields.
  await host.locator('[data-key="first_name"] .label').click();
  await expect(form.locator("#first_name")).toBeFocused();
  expect(forms.submissions).toEqual([]);
});

test("the marks follow the rows: a guess that looks right turns green, its Undo still in sight", async () => {
  test.setTimeout(120_000);
  const { form } = await anduril();
  const heard = hostOf(form).locator(`[data-key="${HEARD}"]`);

  await heard.getByRole("button", { name: "Looks right" }).click();

  await expect(heard).toHaveAttribute("data-mark", "filled");
  await expect(marked(form, "filled")).toHaveCount(21);
  await heard.getByRole("button", { name: "Undo" }).click();
  await expect(heard).toHaveAttribute("data-mark", "check");
  await expect(marked(form, "filled")).toHaveCount(20);
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
