// The extension's Greenhouse tests (KAN-340): the fill run as Chrome runs it
// (extension.ts) on a saved Greenhouse form from a WorkIt-shaped profile, and
// the Plan's rows for essays.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { FakeJobServer, FORMS } from "../fill-engine/test/fake-job-server";
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
    phone: "5550100199",
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

test("an essay question waits for the student to ask for a written answer", async () => {
  const rows = await rowsFor(arcWithEssay("&lt;p&gt;Build boats.&lt;/p&gt;"));

  expect(rows.written).toEqual([{ name: "question_1", label: "Why do you want to work at Arc?", required: true }]);
  expect(rows.yours).toEqual([]);
});

test("on a posting that bans AI-written answers, the essay is left for the student", async () => {
  const rows = await rowsFor(arcWithEssay("&lt;p&gt;Please do not use AI tools to write your application answers.&lt;/p&gt;"));

  expect(rows.written).toEqual([]);
  expect(rows.notes.join(" ")).toMatch(/AI/);
});

test("a one-line question the Plan leaves to a draft is the student's, not an essay", () => {
  // Hermeus's Lever form (live, 2026-10-24): "Nick Name" went to the essay route, which writes 3-5 sentences.
  const nickname = { name: "nick", label: "Nick Name", kind: "text", required: false, options: [] };
  const details = { name: "details", label: "Have you completed at least one previous internship? Please provide details.", kind: "textarea", required: true, options: [] };
  const rows = planRows({ plan: { essays: [], drafts: [nickname, details], missing: [], handoffs: [] } });

  expect(rows.written).toEqual([{ name: "details", label: details.label, required: true }]);
  expect(rows.yours).toEqual([{ name: "nick", label: "Nick Name", required: false }]);
});

test("on a job system the engine doesn't cover, the overlay says so, not as an optional field", async ({ page }) => {
  // SmartRecruiters (live, 2026-10-24): the overlay read "WorkIt can't fill this job system yet (optional)".
  await page.route("https://jobs.example.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<form><input name=first></form>" }));
  await page.goto("https://jobs.example.com/apply/1");
  await bridge(page, async () => { throw new Error("a job API was fetched"); });

  await inject(page);
  await settled(page);

  const text = await page.evaluate(() => document.getElementById("workit-autofiller-overlay-host")!.shadowRoot!.querySelector(".list")!.textContent);
  expect(text).toContain("WorkIt can't fill this job system yet");
  expect(text).not.toContain("(optional)");
  await expect(page.locator("input[name=first]")).toHaveValue("");
});
