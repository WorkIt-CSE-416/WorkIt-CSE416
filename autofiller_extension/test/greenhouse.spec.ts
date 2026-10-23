// The extension's one fill test (KAN-340): the Fill engine loaded the way the
// content-script list loads it, filling a saved Greenhouse form from a
// WorkIt-shaped profile through the same calls the background makes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { FakeJobServer, FORMS } from "../fill-engine/test/fake-job-server";
import { ENGINE_FILES } from "../src/shared/content-scripts.js";
import { engineCaller, fieldResult, fillOrder, planFill, planRows, runEngine } from "../src/background/engine.js";

const EXTENSION = join(__dirname, "..");

/** A WorkIt applicant as background/api.js's fetchAutofillProfile returns one. Dummy data only. */
const STUDENT = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "test.person@example.com",
  full_name: "Test Person",
  phone_number: "+1 555 010 0199",
  headline: null,
  linkedin_url: "https://www.linkedin.com/in/test-person",
  portfolio_url: null,
  github_url: "https://github.com/test-person",
  other_url: null,
  bank: {
    entries: [
      {
        id: "e1", section: "education", title: "Example State University", organization: null, location: null,
        start_month: "2024-08", end_month: "2028-05", end_kind: "expected", degree: "B.S.", field_of_study: "Computer Science",
        gpa: 3.7, gpa_scale: 4, coursework: [], honors: null, link: null, issuer: null, award_date: null, bullets: [],
      },
    ],
    skills: [],
  },
  answers: {
    work_authorized_us: "yes", needs_sponsorship: "no", work_authorization_status: "us_citizen", security_clearance: "none",
    gender: "declined", hispanic_latino: "no", race: "asian", veteran_status: "not_protected_veteran", disability_status: "declined",
  },
  resume: { filename: "resume.pdf", mimeType: "application/pdf", base64: Buffer.from("%PDF-1.4\n%%EOF\n").toString("base64") },
  fetched_at: 0,
};

test("fills a saved Greenhouse form from a WorkIt profile and submits nothing", async ({ context }) => {
  const arc = new FakeJobServer("greenhouse-arc");
  const page = await arc.open(context);
  for (const file of ENGINE_FILES) await page.addScriptTag({ path: join(EXTENSION, file) });
  const call = engineCaller((request) => page.evaluate(runEngine, request));
  const job = readFileSync(join(FORMS, "greenhouse-arc", "questions.json"), "utf8");

  const prepared = await planFill({
    url: arc.url, profile: STUDENT, today: "2026-10-22", call,
    fetchText: async () => job,
  });
  const results: Record<string, unknown> = {};
  for (const name of fillOrder(prepared)) {
    results[name] = await fieldResult(call, prepared, name, prepared.answers[name]);
  }

  const shown = Object.fromEntries(Object.entries(results).map(([name, r]: [string, any]) => [name, r.shows]));
  expect(shown).toMatchObject({
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
  expect(Object.values(results).every((r: any) => r.status === "filled")).toBe(true);
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
