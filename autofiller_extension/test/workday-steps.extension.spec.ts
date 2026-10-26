// A whole Workday application, end to end in the loaded extension
// (loaded-extension.ts), on a fake tenant (fake-job-systems.ts) with the steps
// of Apply's fake Workday (the Fill engine's STEPS, made-up data): sign-in,
// My Information, My Experience, Application Questions, Voluntary
// Disclosures, Self Identify, Review. The test is the student: it presses
// Save and Continue on each step, and the extension must have filled every
// step as it showed, so Workday takes each save.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { FakeWorkdays } from "./fake-job-systems";
import { STEPS, type Field, type Step } from "../fill-engine/test/fake-workday";
import { loadExtension, sendFromWebapp, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

let loaded: Loaded | undefined;
test.afterEach(async () => {
  await loaded?.close();
  loaded = undefined;
});

const overlay = (p: Page) => p.locator("#workit-autofiller-overlay-host");
const STEP_NOTE = "press Save and Continue";

/** The panel says the step `name` is filled and waits for the student's Save and Continue. */
async function filled(tab: Page, [name, fields]: Step, n: number, of: number): Promise<void> {
  // Step n of the bar is active: a step named as the one before it is another step.
  await expect(tab.locator("[data-automation-id=progressBarActiveStep]")).toContainText(`step ${n} of ${of}`, { timeout: 30_000 });
  // The panel lists this step's fields (not the last step's, a step of the same name) and says it is filled.
  const first = fields.find((f) => "label" in f) as Field;
  await expect(overlay(tab).locator(".row").filter({ hasText: first.label }).first()).toBeVisible({ timeout: 60_000 });
  await expect(overlay(tab).locator(".row").filter({ hasText: `Workday: ${name}` })).toContainText(STEP_NOTE, { timeout: 60_000 });
}

/**
 * The student answers, on step `n`, what the panel leaves to them ("Answer it
 * yourself": the made-up profile has no answer for it), as a person would.
 */
async function answerLeft(tab: Page, steps: Step[], n: number): Promise<string[]> {
  const left = await overlay(tab).locator(".row").filter({ hasText: "Answer it yourself" }).allInnerTexts();
  const labels = left.map((text) => text.split("\n")[0].trim());
  for (const label of labels) {
    const f = steps[n][1].find((g) => "label" in g && g.label === label) as Field | undefined;
    if (!f) throw new Error(`No field on step ${steps[n][0]} is labelled ${label}`);
    const box = tab.locator(`[data-automation-id="formField-${f.key}"]`);
    if (f.kind === "radio" || f.kind === "checkboxes") await box.locator("label", { hasText: f.options!.at(-1)! }).click();
    else if (f.kind === "checkbox") await box.locator("input").check();
    else if (f.kind === "dropdown") {
      await box.locator("button").click();
      await tab.locator("[role=option]", { hasText: f.options!.at(-1)! }).click();
    } else await box.locator("input, textarea").first().fill("Made up");
  }
  return labels;
}

// What the made-up profile has no answer for, which the student answers: a
// country and the company's former workers (not in the profile), and a terms
// box, which WorkIt never ticks for the student.
const LEFT: Record<string, string[]> = {
  "My Information": ["Have you previously worked for this company?", "Country"],
  "Voluntary Disclosures": ["Yes, I have read and consent to the terms and conditions"],
};

/**
 * Walks the application on a fake tenant whose `steps` change as a new page
 * or, `inPlace`, in the same document as live Workday's: from Create Account
 * to Review, the test pressing Save and Continue as the student.
 */
async function walk(steps: Step[], inPlace: boolean): Promise<void> {
  const workdays = new FakeWorkdays(["workday-caci"], steps);
  if (inPlace) workdays.inPlace.add("caci.wd1.myworkdayjobs.com");
  const api = new FakeApi().queue({ id: "wd-0", apply_url: workdays.signInUrl(0) });
  const loads: string[] = [];
  const counted: Handler = (request) => {
    if (request.headers["sec-fetch-dest"] === "document") loads.push(request.url.pathname);
    return undefined;
  };
  loaded = await loadExtension([counted, api.handler, webapp, workdays.handler]);
  await signIn(loaded.context);
  const app = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await app.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(app, { type: "run/open" });
  await expect.poll(() => loaded!.context.pages().some((p) => p.url() === workdays.signInUrl(0)), { timeout: 30_000 }).toBe(true);
  const tab = loaded.context.pages().find((p) => p.url() === workdays.signInUrl(0))!;

  // Sign-in: allowed once, the extension makes the account and goes on to the first step.
  const card = overlay(tab).locator(".moment.workday-accounts");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.locator("[data-allow]").click();
  await tab.waitForURL(workdays.url(0), { timeout: 30_000 });

  for (const [n, [name, fields]] of steps.entries()) {
    await filled(tab, steps[n], n + 2, steps.length + 2);
    expect(await answerLeft(tab, steps, n), `what WorkIt left to the student on ${name}`).toEqual(LEFT[name] ?? []);
    // The student checks the step and presses Save and Continue: Workday refuses a step missing a required answer.
    await tab.locator("[data-automation-id=pageFooterNextButton]").click();
    await tab.waitForURL(workdays.url(0, n + 2), { timeout: 30_000 }).catch(async (error) => {
      const banner = await tab.locator("[data-automation-id=errorHeading]").innerText().catch(() => "");
      throw new Error(`${name} wasn't saved. Workday: ${banner}\n${error.message}`);
    });
    expect(Object.keys(workdays.saved(0))).toEqual(expect.arrayContaining(fields.map((f) => f.key)));
  }
  await expect(overlay(tab).locator(".row").filter({ hasText: "Workday: Review" })).toContainText("This is the last step", { timeout: 60_000 });

  expect(workdays.saved(0)).toMatchObject({
    "legalName--firstName": "Test", "legalName--lastName": "Person", phoneNumber: expect.stringContaining("555"),
    authorized: "Yes", sponsorship: "No", veteranStatus: "I am not a protected veteran",
    // The résumé reached Workday's uploader.
    resumeAttachments: { name: "resume.pdf" },
  });
  // In place, the sign-in was the only page loaded; else each step was a page.
  expect(loads.filter((path) => path.startsWith("/__fake__/")).length).toBe(inPlace ? 1 : steps.length + 2);
  expect(workdays.submissions).toEqual([]);
}

test("every Workday step from sign-in to Review is filled as it shows, and each Save and Continue goes through", async () => {
  test.setTimeout(300_000);
  await walk(STEPS, false);
});

test("Workday's steps drawn in the same page, as live, are each filled as they show", async () => {
  test.setTimeout(300_000);
  await walk(STEPS, true);
});

test("a step named as the one before it (two Application Questions, as Workday names a second questionnaire) is filled too", async () => {
  test.setTimeout(300_000);
  const questions = STEPS[2];
  const more: Step = [questions[0], [
    { key: "eligible", label: "Are you legally eligible to work in the United States?", kind: "dropdown", required: true, options: ["Yes", "No"] },
    { key: "phoneNumberAgain", label: "Phone Number", kind: "text", required: true },
  ]];
  await walk([...STEPS.slice(0, 3), more, ...STEPS.slice(3)], true);
});
