// Write early, reuse saved answers, keep the student's edits (KAN-379), end
// to end through the loaded extension (spec seam 1): queueing reads each
// queued job's questions from its link before its tab opens; a question the
// answer bank holds is filled from it and never sent for the student's
// Claude; the student's own words in a written answer are saved. The API is
// faked (fake-api.ts); the backend's side is tested over MCP in
// backend/tests/test_connector_saved_answers.py.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { FakeWorkdays, SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Loaded } from "./loaded-extension";

const DATACOR = "greenhouse-datacor";
const HARVEY = "ashby-harvey";
const GOALS = "Please write a few sentences around what you are looking to gain from an internship.";
const WHY = "Why are you interested in working at Harvey?";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

async function start(api: FakeApi, forms: SavedForms): Promise<void> {
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const page = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await page.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(page, { type: "run/open" });
}

const formTabs = (forms: SavedForms, name: string): Page[] => loaded.context.pages().filter((p) => p.url().startsWith(forms.url(name)));

/** The overlay's row for one question, by its label. */
const row = (form: Page, label: string) => form.locator(".row", { hasText: label });

test("queueing reads each queued job's questions from its link before its tab opens", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([DATACOR]);
  // Six queued: five tabs open at once, the sixth only once one of them is done.
  const api = new FakeApi().queue(...Array.from({ length: 6 }, (_, n) => ({ id: `job-${n}`, apply_url: forms.url(DATACOR) })));
  await start(api, forms);

  await expect.poll(() => api.written.get("job-5"), { timeout: 60_000 }).toEqual([
    { name: expect.any(String), label: GOALS, required: true, max_length: null, answer: null },
  ]);
  // Sent before the job was handed to a tab.
  const sent = api.events.indexOf("questions:job-5");
  const opened = api.events.indexOf("next:job-5");
  expect(opened === -1 || sent < opened, api.events.join(", ")).toBe(true);
  expect(forms.submissions).toEqual([]);
});

test("a question the answer bank holds is filled from it, and never sent for the student's Claude", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([DATACOR]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(DATACOR) });
  const saved = "To learn how a real engineering team plans, builds and ships software.";
  api.bank[GOALS] = { answer: saved, own: false };
  await start(api, forms);

  await expect.poll(() => formTabs(forms, DATACOR).length, { timeout: 30_000 }).toBe(1);
  const [form] = formTabs(forms, DATACOR);
  await expect(row(form, GOALS).locator(".source")).toHaveText("Saved Answer", { timeout: 60_000 });
  expect(await form.evaluate((text) => [...document.querySelectorAll("textarea")].some((t) => t.value === text), saved)).toBe(true);
  // Nothing was left to write: no question reached the API, early or from the tab.
  expect(api.written.get("job-0") ?? []).toEqual([]);
  expect(forms.submissions).toEqual([]);
});

test("the student's own words in a written answer are saved for later forms", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([HARVEY]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(HARVEY) });
  await start(api, forms);
  await expect.poll(() => api.written.get("job-0")?.length, { timeout: 60_000 }).toBe(1);
  const name = api.written.get("job-0")![0].name;
  const [form] = formTabs(forms, HARVEY);
  const box = form.locator(`[data-field-path="${name}"] textarea`);

  // Their Claude's answer arrives and fills: WorkIt's own fill is not taken for the student's.
  api.saveAnswer("job-0", name, "I want to build legal tools that lawyers trust.");
  await expect(box).toHaveValue("I want to build legal tools that lawyers trust.", { timeout: 20_000 });
  await form.waitForTimeout(3_000);
  expect(api.own).toEqual([]);

  // The student rewrites it.
  await box.fill("I want to build tools lawyers rely on, and I learn fastest on a small team.");
  await expect.poll(() => api.own, { timeout: 15_000 }).toEqual([
    { jobId: "job-0", name, label: WHY, answer: "I want to build tools lawyers rely on, and I learn fastest on a small team.", own: true },
  ]);
  await expect(row(form, WHY).locator(".source")).toHaveText("You");
  expect(forms.submissions).toEqual([]);
});

test("the student's edit of their Claude's answer stays Claude's, and WorkIt's checks still apply", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([HARVEY]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(HARVEY) });
  await start(api, forms);
  await expect.poll(() => api.written.get("job-0")?.length, { timeout: 60_000 }).toBe(1);
  const name = api.written.get("job-0")![0].name;
  const [form] = formTabs(forms, HARVEY);
  const box = form.locator(`[data-field-path="${name}"] textarea`);
  const claudes = "I want to build legal tools that lawyers trust, because I saw how slow research was at my internship.";
  api.saveAnswer("job-0", name, claudes);
  await expect(box).toHaveValue(claudes, { timeout: 20_000 });
  await expect(row(form, WHY).locator(".source")).toHaveText("Claude"); // the fill is done

  // The student changes a few words: most of the text is still their Claude's.
  const touched = claudes.replace("legal tools", "careful legal tools");
  await box.fill(touched);

  await expect.poll(() => api.own, { timeout: 15_000 }).toEqual([{ jobId: "job-0", name, label: WHY, answer: touched, own: false }]);
  await expect(row(form, WHY).locator(".source")).toHaveText("Claude");

  // A touch-up that fails WorkIt's checks (here, too long for the form) is not saved, and the row says why.
  api.refuseEdits = ["The form takes at most 300 characters; this is 320."];
  await box.fill(touched + " And more.");
  await expect(row(form, WHY)).toContainText("at most 300 characters", { timeout: 15_000 });
  expect(api.own).toHaveLength(1);
  expect(forms.submissions).toEqual([]);
});

test("on Workday, the student's words in a written answer are saved on every step", async () => {
  test.setTimeout(150_000);
  const NAME = [
    { key: "legalName--firstName", label: "First Name", kind: "text", required: true },
    { key: "legalName--lastName", label: "Last Name", kind: "text", required: true },
  ] as const;
  const WHY_CACI = "Why are you interested in working at CACI?";
  const PROJECT = "Describe a software project you are proud of.";
  const TEAM = "Tell us about a time you worked on a team to solve a hard problem.";
  const workdays = new FakeWorkdays(["workday-caci"], [
    ["My Information", [...NAME, { key: "whyCaci", label: WHY_CACI, kind: "textarea", required: true }]],
    ["Application Questions", [{ key: "project", label: PROJECT, kind: "textarea", required: true }]],
    ["Questionnaire", [{ key: "team", label: TEAM, kind: "textarea", required: true }]],
  ]);
  const api = new FakeApi().queue({ id: "wd-0", apply_url: workdays.url(0) });
  loaded = await loadExtension([api.handler, webapp, workdays.handler]);
  await signIn(loaded.context);
  const webappPage = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await webappPage.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(webappPage, { type: "run/open" });
  const asked = (label: string) => api.written.get("wd-0")?.find((q) => q.label === label)?.name;
  const tab = () => loaded.context.pages().find((p) => p.url().startsWith(workdays.url(0).replace(/\/1$/, "/")))!;

  // My Information: the student writes their own answer before their Claude's arrives.
  await expect.poll(() => asked(WHY_CACI), { timeout: 60_000 }).toBeTruthy();
  const why = "I want to build software that keeps critical systems safe, and CACI's mission work is that.";
  await tab().locator("[data-automation-id=formField-whyCaci] textarea").fill(why);
  await expect.poll(() => api.own, { timeout: 15_000 }).toEqual([{ jobId: "wd-0", name: asked(WHY_CACI), label: WHY_CACI, answer: why, own: true }]);

  // Save and Continue loads the next step as a new page: their Claude's answer fills, and the student touches it up.
  await tab().bringToFront();
  await tab().locator("[data-automation-id=pageFooterNextButton]").click();
  await tab().waitForURL(workdays.url(0, 2));
  await expect.poll(() => asked(PROJECT), { timeout: 60_000 }).toBeTruthy();
  const claudes = "I built a micromouse maze solver in C++ that mapped a sixteen by sixteen maze and ran it under ten seconds.";
  api.saveAnswer("wd-0", asked(PROJECT)!, claudes);
  const project = tab().locator("[data-automation-id=formField-project] textarea");
  await expect(project).toHaveValue(claudes, { timeout: 30_000 });
  await expect(row(tab(), PROJECT).locator(".source")).toHaveText("Claude");
  const touched = claudes.replace("maze solver", "fast maze solver");
  await project.fill(touched);
  await expect.poll(() => api.own.slice(1), { timeout: 15_000 }).toEqual([{ jobId: "wd-0", name: asked(PROJECT), label: PROJECT, answer: touched, own: false }]);

  // Live Workday draws the next step in the same page: the new step's edits are kept, and the last step's watch stops.
  await tab().evaluate(async (url) => {
    const next = new DOMParser().parseFromString(await (await fetch(url)).text(), "text/html");
    document.querySelector("[data-automation-id=applyFlowPage]")!.replaceWith(next.querySelector("[data-automation-id=applyFlowPage]")!);
  }, workdays.url(0, 3));
  await expect.poll(() => asked(TEAM), { timeout: 60_000 }).toBeTruthy();
  const team = "On my micromouse team I rewrote our motor control loop with a teammate so the mouse stopped drifting in long runs.";
  await tab().locator("[data-automation-id=formField-team] textarea").fill(team);
  await expect.poll(() => api.own.slice(2), { timeout: 15_000 }).toEqual([{ jobId: "wd-0", name: asked(TEAM), label: TEAM, answer: team, own: true }]);
  await tab().waitForTimeout(3_000);
  expect(api.own).toHaveLength(3);
  expect(workdays.submissions).toEqual([]);
});
