// The résumé's actions on the Resume/CV row's card (KAN-399, moved there by
// KAN-424 from the Resume tab): the attached file by name, Preview, and
// Change, which opens Choose a Resume (every résumé the student has, the
// attached one marked, and Upload a New Resume). A pick or an upload saves
// the choice for the application and attaches the new file to the form in
// place. Anduril's saved Greenhouse form, as a batch tab.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { STUDENT } from "./extension";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Loaded } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";
const pdf = (words: string) => Buffer.from(`%PDF-1.4\n% ${words}\n%%EOF\n`).toString("base64");
const BASE = { id: "built-base", name: "Base Resume", job_posting_id: null, pdf: pdf("base"), match: { matched: ["Python"], missing: ["C++", "Rust", "Linux", "ROS"] } };
const TAILORED = {
  id: "built-anduril", name: "Anduril Resume", job_posting_id: "job-0", pdf: pdf("tailored"),
  match: { matched: ["Python", "C++", "Linux"], missing: ["Rust", "ROS"] },
};

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const hostOf = (form: Page) => form.locator("#workit-autofiller-overlay-host");
// The Resume/CV row (Greenhouse's field is "resume"), its card once opened, and Choose a Resume.
const rowOf = (form: Page) => hostOf(form).locator('.row[data-key="resume"]');
const cardOf = (form: Page) => rowOf(form).locator(".resume-card");
const dialogOf = (form: Page) => hostOf(form).getByRole("dialog", { name: "Choose a Resume" });

/** Anduril's form filled as a batch tab, its Resume/CV row opened (from the folded Filled line). */
async function anduril(api: FakeApi): Promise<{ form: Page; forms: SavedForms }> {
  const forms = new SavedForms([ANDURIL]);
  api.queue({ id: "job-0", apply_url: forms.url(ANDURIL), title: "Software Engineer Intern", company: "Anduril" });
  api.builtResumes.push(BASE, TAILORED);
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const app = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await app.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(app, { type: "run/open" });
  await expect.poll(() => api.stages.get("job-0"), { timeout: 60_000 }).toBe("needs_you");
  const form = loaded.context.pages().find((p) => p.url() === forms.url(ANDURIL))!;
  await hostOf(form).locator('.group[data-group="filled"] .group-head').click();
  await rowOf(form).locator(".label").click();
  await expect(cardOf(form)).toBeVisible();
  return { form, forms };
}

// Greenhouse shows the attached file's name in place of its file box.
const attachedName = (form: Page) => form.locator('[aria-labelledby="upload-label-resume"] .file-upload__filename').innerText();

test("the Resume/CV row's card names the attached resume and previews it; Change lists every resume, the attached one marked", async () => {
  test.setTimeout(120_000);
  const api = new FakeApi();
  const { form, forms } = await anduril(api);
  const card = cardOf(form);

  await expect(card.locator(".resume-name")).toHaveText(STUDENT.resume.filename);
  await expect(card).toContainText("Attached · Uploaded file");
  expect(await attachedName(form)).toBe(STUDENT.resume.filename);

  const preview = loaded.context.waitForEvent("page");
  await card.getByRole("button", { name: "Preview" }).click();
  expect((await preview).url()).toMatch(/^blob:/);

  await card.getByRole("button", { name: "Change" }).click();
  const dialog = dialogOf(form);
  await expect(dialog.locator(".resume-option .option-name")).toHaveText([STUDENT.resume.filename, "Base Resume", "Anduril Resume"]);
  await expect(dialog.locator(".resume-option").first()).toContainText("Attached");
  await expect(dialog.locator(".resume-option").nth(2)).toContainText("Tailored for this job");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
  expect(forms.submissions).toEqual([]);
});

test("a resume picked in Choose a Resume is saved for the application and attached to the form", async () => {
  test.setTimeout(120_000);
  const api = new FakeApi();
  const { form, forms } = await anduril(api);
  await cardOf(form).getByRole("button", { name: "Change" }).click();
  await dialogOf(form).locator(".resume-option", { hasText: "Anduril Resume" }).click();
  await expect(cardOf(form)).toContainText("Attached Anduril Resume.pdf.");
  expect(api.sentResumes.get("job-0")).toEqual({ built_resume_id: TAILORED.id });
  await expect.poll(() => attachedName(form)).toBe("Anduril Resume.pdf");
  await expect(cardOf(form).locator(".resume-name")).toHaveText("Anduril Resume.pdf");
  // The uploaded file is now among the others, under the attached one.
  await cardOf(form).getByRole("button", { name: "Change" }).click();
  await expect(dialogOf(form).locator(".resume-option .option-name")).toHaveText(["Anduril Resume.pdf", STUDENT.resume.filename, "Base Resume"]);
  expect(forms.submissions).toEqual([]);
});

test("Upload a New Resume saves the file to the student's Resumes and attaches it; a file they have is used, not saved twice", async () => {
  test.setTimeout(120_000);
  const api = new FakeApi();
  const { form, forms } = await anduril(api);

  await cardOf(form).getByRole("button", { name: "Change" }).click();
  const chooser = form.waitForEvent("filechooser");
  await dialogOf(form).getByRole("button", { name: "Upload a New Resume" }).click();
  await (await chooser).setFiles({ name: "New Resume.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf("new"), "base64") });
  await expect(cardOf(form)).toContainText("Attached New Resume.pdf.");
  expect(api.uploads.map((u) => u.filename)).toEqual(["New Resume.pdf"]);
  expect(api.sentResumes.get("job-0")).toEqual({ uploaded_resume_id: api.uploads[0].id });
  await expect(cardOf(form).locator(".resume-name")).toHaveText("New Resume.pdf");
  await expect.poll(() => attachedName(form)).toBe("New Resume.pdf");

  // The file they uploaded first: WorkIt uses that one and saves nothing.
  await cardOf(form).getByRole("button", { name: "Change" }).click();
  const again = form.waitForEvent("filechooser");
  await dialogOf(form).getByRole("button", { name: "Upload a New Resume" }).click();
  await (await again).setFiles({ name: STUDENT.resume.filename, mimeType: "application/pdf", buffer: Buffer.from(STUDENT.resume.base64, "base64") });
  await expect(cardOf(form)).toContainText(`You uploaded this resume before, so WorkIt used that one. Attached ${STUDENT.resume.filename}.`);
  expect(api.uploads).toHaveLength(1);
  await expect(cardOf(form).locator(".resume-name")).toHaveText(STUDENT.resume.filename);
  expect(forms.submissions).toEqual([]);
});
