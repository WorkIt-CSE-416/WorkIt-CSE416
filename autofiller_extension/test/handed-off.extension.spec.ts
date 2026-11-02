// A field the Plan hands to the student (KAN-513): its own row, once, with
// the Plan's reason, and pressing the row takes the student to the field.
// Before, the panel showed it twice: a "Left for you" note and the field's
// row under Need Your Answer. Anduril's saved Greenhouse form, with two of
// its questions renamed as Lockheed's Postgraduate field of study (a list
// with no N/A) and an AI policy, opened by the student (no batch).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";
const POSTGRAD = "question_13130330007";
const POLICY = "question_13130331007";
const RENAMED: Record<string, { label: string; values: string[] }> = {
  [POSTGRAD]: { label: "Field of Study in your Postgraduate degree", values: ["Computer Science", "Mathematics"] },
  [POLICY]: { label: "AI Policy for Application", values: ["I have read and accept"] },
};

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");
const rowOf = (page: Page, key: string) => hostOf(page).locator(`[data-tab="autofill"] .row[data-key="${key}"]`);

/** Greenhouse's Job Board API for Anduril's job, with the two questions renamed. */
const renamedQuestions: Handler = ({ url }) => {
  if (url.host !== "boards-api.greenhouse.io") return undefined;
  const job = JSON.parse(readFileSync(join(__dirname, `../fill-engine/test/fixtures/forms/${ANDURIL}/questions.json`), "utf8"));
  for (const q of job.questions) {
    const renamed = RENAMED[q.fields[0].name];
    if (!renamed) continue;
    q.label = renamed.label;
    q.fields[0].values = renamed.values.map((label, i) => ({ label, value: i + 1 }));
  }
  return { headers: { "content-type": "application/json" }, body: JSON.stringify(job) };
};

async function filled(): Promise<Page> {
  const forms = new SavedForms([ANDURIL]);
  loaded = await loadExtension([new FakeApi().handler, webapp, renamedQuestions, forms.handler]);
  await signIn(loaded.context);
  const page = await loaded.context.newPage();
  await page.goto(forms.url(ANDURIL));
  await hostOf(page).getByRole("button", { name: "Show WorkIt panel" }).click({ timeout: 15_000 });
  await hostOf(page).getByRole("button", { name: "Autofill This Page" }).click();
  await expect(hostOf(page).locator('.box[data-box="needs-you"]')).toBeVisible({ timeout: 60_000 });
  return page;
}

test("a field handed to the student is one row, with the Plan's reason, and no Left for you note", async () => {
  test.setTimeout(120_000);
  const page = await filled();

  await expect(hostOf(page).getByText("Left for you")).toHaveCount(0);
  await expect(hostOf(page).getByText(RENAMED[POSTGRAD].label)).toHaveCount(1);
  await expect(hostOf(page).getByText(RENAMED[POLICY].label)).toHaveCount(1);
  const box = hostOf(page).locator('.box[data-box="needs-you"]');
  await expect(box.locator(`.row[data-key="${POSTGRAD}"] .reason`)).toHaveText("You have no graduate study and it offers no N/A. Answer it yourself.");
  await expect(box.locator(`.row[data-key="${POLICY}"] .reason`)).toHaveText("The form asks you to accept its AI policy. Answer it yourself.");
});

test("pressing the row scrolls to its field and focuses it; a click the page makes does nothing", async () => {
  test.setTimeout(120_000);
  const page = await filled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("#first_name").focus();

  // A click no student made (the test copy's root is open, so a script can reach the row).
  await rowOf(page, POLICY).locator(".label").evaluate((label: HTMLElement) => label.click());
  await expect(page.locator(`#${POLICY}`)).not.toBeFocused();
  await expect(page.locator("#first_name")).toBeFocused();

  await rowOf(page, POLICY).locator(".label").click();
  await expect(page.locator(`#${POLICY}`)).toBeFocused();
  await expect(page.locator(`#${POLICY}`)).toBeInViewport();
});
