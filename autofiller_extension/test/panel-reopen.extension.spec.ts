// The panel after the student closes it (KAN-369): its ✕ leaves a small
// WorkIt tab on the page, and the toolbar's popup, on a page WorkIt already
// filled, offers Show WorkIt Panel (the same rows, nothing filled again)
// before Fill Again. And a panel row takes the student to its field.
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
