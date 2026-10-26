// The extension's Greenhouse tests (KAN-340): the fill run as Chrome runs it
// (extension.ts) on a saved Greenhouse form from a WorkIt-shaped profile, and
// the Plan's rows for essays.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { FakeJobServer, FORMS, loadHar } from "../fill-engine/test/fake-job-server";
import { ENGINE_FILES } from "../src/shared/content-scripts.js";
import { engineCaller, planFill, planRows, runEngine } from "../src/background/engine.js";
import { STUDENT, bridge, failed, inject, settled, shown } from "./extension";

const EXTENSION = join(__dirname, "..");

test("fills a saved Greenhouse form from a WorkIt profile and submits nothing", async ({ context }) => {
  const arc = new FakeJobServer("greenhouse-arc");
  const page = await arc.open(context);
  const job = readFileSync(join(FORMS, "greenhouse-arc", "questions.json"), "utf8");
  await bridge(page, async () => job);

  await inject(page);
  const { phase, rows } = await settled(page);

  expect(phase).toBe("filled");
  expect(shown(rows)).toMatchObject({
    first_name: "Test",
    last_name: "Person",
    email: "test.person@example.com",
    phone: "(555) 010-0199", // formatted for the US once its country is picked
    country: "United States", // the picker beside Phone: Greenhouse won't send a number without it
    question_18871501008: "https://www.linkedin.com/in/test-person",
    question_18871502008: "Yes",
    question_18871503008: "No",
    veteran_status: "I am not a protected veteran",
    hispanic_ethnicity: "No",
    race: "Asian",
    gender: "Decline To Self Identify",
    resume: "resume.pdf",
  });
  expect(failed(rows)).toEqual({});
  expect(arc.submissions).toEqual([]);
});

test("each filled field says where its answer came from, and a guess is marked for checking", async ({ context }) => {
  const pure = new FakeJobServer("greenhouse-purestorage");
  const page = await pure.open(context);
  const job = readFileSync(join(FORMS, "greenhouse-purestorage", "questions.json"), "utf8");
  // The Job Board API's answer for the job, and the rest (the posting page, its education lists) from the saved form.
  const saved = new Map(loadHar("greenhouse-purestorage").log.entries.map((e: any) => [e.request.url, e.response.content.text ?? ""]));
  await bridge(page, async (url) => {
    if (url.startsWith("https://boards-api.greenhouse.io/")) return job;
    if (!saved.has(url)) throw new Error(`not saved: ${url}`);
    return saved.get(url)!;
  });

  await inject(page);
  const { rows } = await settled(page);
  const source = Object.fromEntries(rows.filter((r) => r.status === "filled").map((r) => [r.label, r.source]));

  expect(source).toMatchObject({ "First Name": "profile", Email: "profile", Phone: "profile", "Resume/CV": "profile" });
  // "How did you hear?" is WorkIt's own default, not something the student said.
  expect(source["How did you hear about this job?"]).toBe("guessed");
  // The overlay labels each one, and marks the guess.
  const panel = page.locator("#workit-autofiller-overlay-host");
  await expect(panel.locator('[data-key="first_name"] [data-source]')).toHaveText("Profile");
  await expect(panel.locator(`[data-key="${rows.find((r) => r.source === "guessed")!.key}"]`)).toHaveAttribute("data-guessed", "");
  expect(pure.submissions).toEqual([]);
});

test("Looks right ×N confirms the guessed consent boxes at once, never a self-identification or legal one", async ({ context }) => {
  const coinbase = new FakeJobServer("greenhouse-coinbase");
  const page = await coinbase.open(context);
  const job = readFileSync(join(FORMS, "greenhouse-coinbase", "questions.json"), "utf8");
  const saved = new Map(loadHar("greenhouse-coinbase").log.entries.map((e: any) => [e.request.url, e.response.content.text ?? ""]));
  // A student whose policies (brought from Apply) tick a consent box that is true: WorkIt's own leave it to them.
  const ticks = { ...STUDENT, fill: { policies: { tick_consent_when_true: true } } };
  await bridge(page, async (url) => (url.startsWith("https://boards-api.greenhouse.io/") ? job : saved.get(url) ?? ""), ticks);
  await inject(page);
  await settled(page);
  // Two more guesses, as another form's would be: a consent box, and a self-identification question.
  await page.evaluate(() => {
    const { status } = (window as any).WIA;
    for (const [key, label, shows] of [["ack", "I acknowledge the candidate privacy notice.", "Yes"], ["gender", "Gender: I consent to share my gender identity", "Decline To Self Identify"]]) {
      status.register(key, label, true, "guessed");
      status.setStatus(key, "filled", undefined, shows);
    }
  });
  const panel = page.locator("#workit-autofiller-overlay-host");
  const source = (label: string) => panel.locator(".row", { hasText: label }).locator(".source");
  const ARBITRATION = "Please confirm receipt of the above linked Global Data Privacy Notice and US Arbitration Agreement.";
  const AI_TOOLS = "I understand that Coinbase may use AI tools to assist in the application and interview process.";
  await expect(source(AI_TOOLS)).toHaveText("Guessed");
  await expect(source(ARBITRATION)).toHaveText("Guessed");

  // Coinbase's AI-tools box and the privacy notice; not the arbitration agreement (legal), Gender or How did you hear.
  await panel.getByRole("button", { name: "Looks right ×2" }).click();
  await expect(source(AI_TOOLS)).toHaveText("You");
  await expect(source("I acknowledge the candidate privacy notice.")).toHaveText("You");
  for (const label of [ARBITRATION, "Gender: I consent", "How did you hear about this job?"]) await expect(source(label)).toHaveText("Guessed");
  await expect(panel.getByRole("button", { name: /Looks right ×/ })).toHaveCount(0);
  expect(coinbase.submissions).toEqual([]);
});

test("Undo after Looks right ×N takes back every answer it saved, and the boxes are guesses again", async ({ context }) => {
  const coinbase = new FakeJobServer("greenhouse-coinbase");
  const page = await coinbase.open(context);
  const job = readFileSync(join(FORMS, "greenhouse-coinbase", "questions.json"), "utf8");
  const saved = new Map(loadHar("greenhouse-coinbase").log.entries.map((e: any) => [e.request.url, e.response.content.text ?? ""]));
  await bridge(page, async (url) => (url.startsWith("https://boards-api.greenhouse.io/") ? job : saved.get(url) ?? ""), STUDENT);
  await inject(page);
  await settled(page);
  // A batch tab's (window.WIA.batch): the background saves and deletes the answers; the test keeps its messages.
  await page.evaluate(() => {
    const w = window as any;
    const { status } = w.WIA;
    for (const [key, label] of [["ack", "I acknowledge the candidate privacy notice."], ["terms", "I agree to the terms and conditions."]]) {
      status.register(key, label, true, "guessed");
      status.setStatus(key, "filled", undefined, "Yes");
    }
    w.WIA.batch = { jobId: "job-0" };
    w.__sent = [];
    const send = w.chrome.runtime.sendMessage;
    w.chrome.runtime.sendMessage = (message: any) => {
      if (!String(message.type).startsWith("batch/")) return send(message);
      w.__sent.push(message.name ? [message.type, message.name] : [message.type]);
      return Promise.resolve({ ok: true });
    };
  });
  const panel = page.locator("#workit-autofiller-overlay-host");
  const row = (key: string) => panel.locator(`[data-key="${key}"]`);
  await panel.getByRole("button", { name: "Looks right ×2" }).click();
  await expect(row("ack")).toContainText("Saved for next time.");
  await expect(row("terms")).toContainText("Saved for next time.");

  await row("terms").getByRole("button", { name: "Undo" }).click();
  for (const key of ["ack", "terms"]) {
    await expect(row(key).locator(".source")).toHaveText("Guessed");
    await expect(row(key).getByRole("button", { name: "Looks right" })).toBeVisible();
  }
  await expect(panel.getByRole("button", { name: "Looks right ×2" })).toBeVisible();
  const sent = await page.evaluate(() => (window as any).__sent.filter(([type]: string[]) => type.startsWith("batch/own-answer")));
  expect(sent.sort()).toEqual([
    ["batch/own-answer", "ack"], ["batch/own-answer", "terms"], ["batch/own-answer-undo", "ack"], ["batch/own-answer-undo", "terms"],
  ]);
  expect(coinbase.submissions).toEqual([]);
});

test("leaves a job system the engine doesn't cover alone", async () => {
  const prepared = await planFill({
    url: "https://example.com/careers/apply/123", profile: STUDENT, today: "2026-10-22",
    call: async () => { throw new Error("the engine was called"); },
    fetchText: async () => { throw new Error("a job API was fetched"); },
  });

  expect(prepared).toEqual({ covered: false });
});

/** The bundle evaluated on its own, as a page-less call: plan and parseQuestions need no page. */
function pagelessCall() {
  const scope: any = {};
  runInNewContext(readFileSync(join(EXTENSION, ENGINE_FILES[0]), "utf8"), scope);
  (globalThis as any).FillEngine = scope.FillEngine; // runEngine reads the global, as it does in a page
  return engineCaller(runEngine);
}

/** greenhouse-arc's job with an essay question added, and `content` as its posting text. */
function arcWithEssay(content: string) {
  const job = JSON.parse(readFileSync(join(FORMS, "greenhouse-arc", "questions.json"), "utf8"));
  job.questions.push({ label: "Why do you want to work at Arc?", description: null, required: true, fields: [{ name: "question_1", type: "textarea", values: [] }] });
  job.content = content;
  return JSON.stringify(job);
}

async function rowsFor(job: string) {
  const prepared = await planFill({
    url: "https://job-boards.greenhouse.io/arcboatcompany/jobs/5442881008", profile: STUDENT, today: "2026-10-22",
    call: pagelessCall(), fetchText: async () => job,
  });
  return planRows(prepared);
}

test("the profile's home answers the form's location and picks the phone's country", async () => {
  // KAN-372's free-text location, as the student typed it; one the engine can't read leaves both to the student.
  const job = readFileSync(join(FORMS, "greenhouse-purestorage", "questions.json"), "utf8");
  const saved = new Map(loadHar("greenhouse-purestorage").log.entries.map((e: any) => [e.request.url, e.response.content.text ?? ""]));
  const fetchText = async (url: string) => (url.startsWith("https://boards-api.greenhouse.io/") ? job : saved.get(url) ?? "");
  const plan = async (location: string | null) => (await planFill({
    url: "https://job-boards.greenhouse.io/purestorage/jobs/7210487", profile: { ...STUDENT, phone_number: "+44 20 7946 0958", location },
    today: "2026-10-22", call: pagelessCall(), fetchText,
  })).answers;

  expect(await plan("Stony Brook, NY")).toMatchObject({ location: "Stony Brook, New York, United States", country: "United States" });
  const unread = await plan("Long Island");
  expect(unread.location).toBeUndefined();
  expect(unread.country).toBeUndefined(); // a +44 number with no home on file: the student picks
});

test("an essay question waits for the student to ask for a written answer", async () => {
  const rows = await rowsFor(arcWithEssay("&lt;p&gt;Build boats.&lt;/p&gt;"));

  expect(rows.written).toEqual([{ name: "question_1", label: "Why do you want to work at Arc?", required: true, max_length: null, generate: true }]);
  expect(rows.yours).toEqual([]);
});

test("an essay's limit is its field's own, as the engine reads it from the form", async ({ context }) => {
  const page = await new FakeJobServer("greenhouse-arc").open(context);
  // The essay's box on the form, with the limit the employer set.
  await page.evaluate(() => {
    const box = document.createElement("textarea");
    box.id = "question_1";
    box.maxLength = 600;
    document.body.append(box);
  });
  const prepared = await planFill({
    url: "https://job-boards.greenhouse.io/arcboatcompany/jobs/5442881008", profile: STUDENT, today: "2026-10-22",
    call: engineCaller((request) => page.evaluate(runEngine, request)), fetchText: async () => arcWithEssay("&lt;p&gt;Build boats.&lt;/p&gt;"),
  });

  expect(planRows(prepared).written).toEqual([{ name: "question_1", label: "Why do you want to work at Arc?", required: true, max_length: 600, generate: true }]);
});

test("on a posting that bans AI-written answers, the essay is left for the student", async () => {
  const rows = await rowsFor(arcWithEssay("&lt;p&gt;Please do not use AI tools to write your application answers.&lt;/p&gt;"));

  expect(rows.written).toEqual([]);
  expect(rows.notes.join(" ")).toMatch(/AI/);
});

test("a one-line or choice draft goes to the student's Claude, never the essay route", () => {
  // Hermeus's Lever form (live, 2026-10-24): "Nick Name" went to the essay route, which writes 3-5 sentences.
  const nickname = { name: "nick", label: "Nick Name", kind: "text", required: false, options: [] };
  const details = { name: "details", label: "Have you completed at least one previous internship? Please provide details.", kind: "textarea", required: true, options: [] };
  const size = { name: "size", label: "Which team size do you prefer?", kind: "select", required: true, options: ["Small", "Large"] };
  const unread = { name: "unread", label: "Which office?", kind: "select", required: true, options: ["Select..."] };
  const sample = { name: "sample", label: "Work sample", kind: "file", required: false, options: [] };
  const rows = planRows({ plan: { essays: [], drafts: [nickname, details, size, unread, sample], missing: [], handoffs: [] } });

  expect(rows.written).toEqual([
    { name: "nick", label: "Nick Name", required: false, max_length: null, generate: false },
    { name: "details", label: details.label, required: true, max_length: null, generate: true },
    { name: "size", label: size.label, required: true, max_length: null, generate: false, kind: "choice", options: ["Small", "Large"] },
    // Options not read (a closed list): answered in words, which the engine fits to the list.
    { name: "unread", label: unread.label, required: true, max_length: null, generate: false },
  ]);
  expect(rows.yours).toEqual([{ name: "sample", label: "Work sample", required: false }]);
});

test("on a job system the engine doesn't cover, the overlay says so, not as an optional field", async ({ page }) => {
  // SmartRecruiters (live, 2026-10-24): the overlay read "WorkIt can't fill this job system yet (optional)".
  await page.route("https://jobs.example.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<form><input name=first></form>" }));
  await page.goto("https://jobs.example.com/apply/1");
  await bridge(page, async () => { throw new Error("a job API was fetched"); });

  await inject(page);
  console.log(JSON.stringify((await settled(page)).rows.map((r) => [r.label.slice(0, 50), r.status, r.source, r.reason])));

  const text = await page.evaluate(() => document.getElementById("workit-autofiller-overlay-host")!.shadowRoot!.querySelector(".list")!.textContent);
  expect(text).toContain("WorkIt can't fill this job system yet");
  expect(text).not.toContain("(optional)");
  await expect(page.locator("input[name=first]")).toHaveValue("");
});

test("a company's careers page that embeds a Greenhouse form points the student to that form", async ({ page }) => {
  // The page Greenhouse sends a hosted job to when its board has its own careers site: the form is in an iframe.
  const form = "https://job-boards.greenhouse.io/embed/job_app?for=acmerobots&token=123";
  await page.route("https://careers.acmerobots.example/**", (route) => route.fulfill({ contentType: "text/html",
    body: `<h1>Robot Wrangler</h1><iframe id="grnhse_iframe" src="${form}&amp;gh_jid=123"></iframe>` }));
  await page.route("https://job-boards.greenhouse.io/**", (route) => route.fulfill({ contentType: "text/html", body: "<form></form>" }));
  await page.goto("https://careers.acmerobots.example/jobs?gh_jid=123");
  await bridge(page, async () => { throw new Error("a job API was fetched"); });

  await inject(page);
  console.log(JSON.stringify((await settled(page)).rows.map((r) => [r.label.slice(0, 50), r.status, r.source, r.reason])));

  const text = await page.evaluate(() => document.getElementById("workit-autofiller-overlay-host")!.shadowRoot!.querySelector(".list")!.textContent);
  expect(text).toContain(`Open the application form (${form}&gh_jid=123)`);
  expect(text).not.toContain("WorkIt can't fill this job system yet");
});
