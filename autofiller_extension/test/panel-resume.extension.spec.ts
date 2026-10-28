// The panel's Résumé tab (KAN-399): the résumé this form holds, by name,
// with Preview; its Keyword match against the job ("3 of 5 keywords", the
// matched and missing ones, as the backend gives them); Tailor, which opens
// WorkIt's Tailor for the job; and switching to another of the student's
// résumés, which saves the choice for the application and attaches the new
// file to the form in place. Anduril's saved Greenhouse form, as a batch tab.
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
const tabOf = (form: Page) => hostOf(form).locator('.tab[data-tab="resume"]');

/** Anduril's form filled as a batch tab, its Résumé tab open. */
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
  await hostOf(form).locator('.tabs button[data-tab="resume"]').click();
  return { form, forms };
}

// Greenhouse shows the attached file's name in place of its file box.
const attachedName = (form: Page) => form.locator('[aria-labelledby="upload-label-resume"] .file-upload__filename').innerText();

test("the Résumé tab names the attached résumé, previews it, and Tailor opens WorkIt's Tailor for the job", async () => {
  test.setTimeout(120_000);
  const api = new FakeApi();
  const { form, forms } = await anduril(api);
  const tab = tabOf(form);

  await expect(tab.locator(".resume-name")).toHaveText(STUDENT.resume.filename);
  expect(await attachedName(form)).toBe(STUDENT.resume.filename);
  // An uploaded file has no Keyword match: only a résumé built in WorkIt does.
  await expect(tab.locator(".keywords")).toHaveText("Keyword match is for résumés built in WorkIt. Tailor one for this job.");

  const preview = loaded.context.waitForEvent("page");
  await tab.getByRole("button", { name: "Preview" }).click();
  const opened = await preview;
  expect(opened.url()).toMatch(/^blob:/);

  // The others the student can switch to: the base résumé and the one tailored for this job.
  await expect(tab.locator(".resume-option .option-name")).toHaveText(["Base Resume", "Anduril Resume"]);
  await expect(tab.locator(".resume-option").nth(1)).toContainText("Tailored for this job");

  const tailor = loaded.context.waitForEvent("page");
  await tab.getByRole("button", { name: "Tailor for this job" }).click();
  expect((await tailor).url()).toBe("http://localhost:3000/jobs/job-0/tailor");
  expect(forms.submissions).toEqual([]);
});

test("switching to the tailored résumé saves the choice, attaches it to the form and shows its Keyword match", async () => {
  test.setTimeout(120_000);
  const api = new FakeApi();
  const { form, forms } = await anduril(api);
  const tab = tabOf(form);
  await expect(tab.locator(".resume-name")).toHaveText(STUDENT.resume.filename);

  await tab.locator(".resume-option", { hasText: "Anduril Resume" }).getByRole("button", { name: "Use this" }).click();
  await expect(tab.locator(".said")).toHaveText("Attached Anduril Resume.pdf.");
  expect(api.sentResumes.get("job-0")).toEqual({ built_resume_id: TAILORED.id });
  await expect.poll(() => attachedName(form)).toBe("Anduril Resume.pdf");

  await expect(tab.locator(".resume-name")).toHaveText("Anduril Resume.pdf");
  // A posting's first read may spend a Tailor use: never without the student's press.
  const check = tab.getByRole("button", { name: "Check keyword match (uses 1 Tailor run today)" });
  await expect(check).toBeVisible();
  await form.waitForTimeout(1_000);
  expect(api.calls.filter((c) => c.includes("/keyword-match"))).toEqual([]);
  await check.click();
  // The backend's own count and lists, matched first.
  await expect(tab.locator(".keywords .count")).toHaveText("3 of 5 keywords");
  await expect(tab.locator(".keywords .matched li")).toHaveText(["Python", "C++", "Linux"]);
  await expect(tab.locator(".keywords .missing li")).toHaveText(["Rust", "ROS"]);
  expect(api.calls).toContain(`GET /applicants/${STUDENT.id}/built-resumes/${TAILORED.id}/keyword-match?job_posting_id=job-0`);
  // The uploaded file is now among the others.
  await expect(tab.locator(".resume-option .option-name")).toHaveText([STUDENT.resume.filename, "Base Resume"]);
  // This job's keywords are read now (cached, no use spent): another built résumé's match shows by itself.
  await tab.locator(".resume-option", { hasText: "Base Resume" }).getByRole("button", { name: "Use this" }).click();
  await expect(tab.locator(".resume-name")).toHaveText("Base Resume.pdf");
  await expect(tab.locator(".keywords .count")).toBeVisible();
  await expect(check).toBeHidden();
  expect(forms.submissions).toEqual([]);
});
