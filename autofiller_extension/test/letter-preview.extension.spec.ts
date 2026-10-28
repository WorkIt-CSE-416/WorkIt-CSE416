// See cover letter (KAN-369, src/content/letter-preview.js): a batch tab's row
// for a cover letter the student's Claude wrote opens a preview of the letter
// that is on the form, before the student presses Submit: the box's own text
// (read back, so their edit shows), or for an upload the text WorkIt made the
// PDF of and the file the form shows. Copy copies it. Nothing is submitted.
// The WorkIt API is faked (fake-api.ts); the forms are the Fill engine's saved
// ones. Dummy data only.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms, SavedWorkable } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Loaded } from "./loaded-extension";

const LETTER = "Dear Example Recruiting Team:\n\nI build tools people rely on, and I would like to build yours.\n\nSincerely,\nTest Person";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

/** The panel's cover letter row on `form`. */
const letterRow = (form: Page) =>
  form.locator("#workit-autofiller-overlay-host .row").filter({ has: form.locator(".label", { hasText: /^Cover letter( \(optional\))?$/i }) });

/** Opens the batch, waits for the tab's cover letter question to reach WorkIt, and saves the student's Claude's letter. */
async function letterFromClaude(api: FakeApi, url: string): Promise<Page> {
  await signIn(loaded.context);
  const page = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await page.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(page, { type: "run/open" });
  await expect.poll(() => api.written.get("job-0")?.find((q) => /cover letter/i.test(q.label))?.name, { timeout: 60_000 }).toBeTruthy();
  const name = api.written.get("job-0")!.find((q) => /cover letter/i.test(q.label))!.name;
  api.saveAnswer("job-0", name, LETTER);
  return loaded.context.pages().find((p) => p.url().startsWith(url))!;
}

test("a cover letter in a text box previews what the box shows, and Copy copies it", async () => {
  test.setTimeout(150_000);
  const form = new SavedWorkable("workable-scout");
  const api = new FakeApi().queue({ id: "job-0", apply_url: form.url });
  // Focused: the clipboard takes text only from a page that has focus, as the student's clicked tab does.
  loaded = await loadExtension([api.handler, webapp, form.handler], { focused: true });
  await loaded.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(form.url).origin });
  const tab = await letterFromClaude(api, form.url);
  const box = tab.locator("textarea[name=cover_letter], #cover_letter").first();
  await expect(box).toHaveValue(LETTER, { timeout: 30_000 });

  const row = letterRow(tab);
  await row.getByRole("button", { name: "See cover letter" }).click();
  const preview = row.locator(".letter-preview");
  await expect.poll(() => preview.locator(".letter-text").evaluate((el) => el.textContent)).toBe(LETTER);
  await expect(preview).not.toContainText("Attached as");

  // The student's edit of the box is what the preview shows, once WorkIt reads it back.
  const edited = `${LETTER}\nP.S. I can start in June.`;
  await box.fill(edited);
  await expect.poll(() => preview.locator(".letter-text").evaluate((el) => el.textContent), { timeout: 15_000 }).toBe(edited);

  await tab.bringToFront();
  await preview.getByRole("button", { name: "Copy" }).click();
  await expect(preview.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await tab.evaluate(() => navigator.clipboard.readText())).toBe(edited);

  await row.getByRole("button", { name: "Hide cover letter" }).click();
  await expect(row.locator(".letter-preview")).toHaveCount(0);
  expect(form.server.submissions).toEqual([]);
});

test("a cover letter attached as a PDF previews the letter's text and the file the form shows", async () => {
  test.setTimeout(150_000);
  const forms = new SavedForms(["ashby-patreon"]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url("ashby-patreon") });
  // cover_letter "always" (brought from Apply): Patreon's optional Cover Letter upload is written too.
  api.fillProfile = { profile: {}, policies: { cover_letter: "always" } };
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  const tab = await letterFromClaude(api, forms.url("ashby-patreon"));

  const row = letterRow(tab);
  await row.getByRole("button", { name: "See cover letter" }).click({ timeout: 30_000 });
  const preview = row.locator(".letter-preview");
  await expect(preview).toContainText("Attached as Test_Person_Cover_Letter.pdf");
  await expect.poll(() => preview.locator(".letter-text").evaluate((el) => el.textContent)).toBe(LETTER);

  // Edit myself on an upload says how to replace the file; it changes nothing on the form.
  await preview.getByRole("button", { name: "Edit myself" }).click();
  await expect(preview).toContainText("remove WorkIt's file");
  expect(forms.submissions).toEqual([]);
});
