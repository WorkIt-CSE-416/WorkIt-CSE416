// KAN-341: the extension fills a saved form of each job system the Fill engine
// covers besides Greenhouse, with a WorkIt-shaped profile, through the content
// script and the background's fill handler (extension.ts), and sends nothing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FakeEightfold } from "../fill-engine/test/fake-eightfold";
import { FakeJobServer, FORMS, loadHar } from "../fill-engine/test/fake-job-server";
import { FakeLever } from "../fill-engine/test/fake-lever";
import { FakeRippling } from "../fill-engine/test/fake-rippling";
import { FakeWorkable } from "../fill-engine/test/fake-workable";
import { EDUCATION, FakeWorkday, type Step } from "../fill-engine/test/fake-workday";
import { formUrl, planFill } from "../src/background/engine.js";
import { STUDENT, bridge, failed, inject, settled, shown } from "./extension";

/** A job API's answers by URL, as the background would fetch them: saved ones; any other fails, as an unreachable API does. */
function api(answers: Record<string, string>) {
  return async (url: string) => {
    if (url in answers) return answers[url];
    throw new Error(`${url} answered 404`);
  };
}

/** A saved form's GET answers by URL. */
function saved(form: string): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const { request, response } of loadHar(form).log.entries) {
    if (request.method !== "GET" || request.url in answers) continue;
    const { text = "", encoding } = response.content;
    answers[request.url] = encoding === "base64" ? Buffer.from(text, "base64").toString() : text;
  }
  return answers;
}

test("fills a saved Lever form from a WorkIt profile and submits nothing", async ({ context }) => {
  const immuta = new FakeLever("lever-immuta");
  const page = await immuta.open(context);
  await bridge(page, api(saved("lever-immuta")));

  await inject(page);
  const { phase, rows } = await settled(page);

  expect(phase).toBe("filled");
  expect(shown(rows)).toMatchObject({
    resume: "resume.pdf",
    name: "Test Person",
    email: "test.person@example.com",
    phone: "5550100199",
    "urls[LinkedIn]": "https://www.linkedin.com/in/test-person",
    "urls[GitHub]": "https://github.com/test-person",
  });
  expect(failed(rows)).toEqual({});
  expect(immuta.submissions).toEqual([]);
});

test("fills a saved Ashby form from a WorkIt profile and submits nothing", async ({ context }) => {
  const skydio = new FakeJobServer("ashby-skydio");
  const page = await skydio.open(context);
  const posting = readFileSync(join(FORMS, "ashby-skydio", "questions.json"), "utf8");
  await bridge(page, async (url) => {
    if (url.endsWith("?op=ApiJobPosting")) return posting;
    throw new Error(`${url} answered 404`);
  });

  await inject(page);
  const { phase, rows } = await settled(page);

  expect(phase).toBe("filled");
  expect(shown(rows)).toMatchObject({
    _systemfield_name: "Test Person",
    _systemfield_email: "test.person@example.com",
    _systemfield_resume: "resume.pdf",
    _systemfield_eeoc_veteran_status: "I am not a protected veteran",
  });
  expect(failed(rows)).toEqual({});
  expect(skydio.submissions).toEqual([]);
});

test("fills a saved Rippling form from a WorkIt profile and submits nothing", async ({ context }) => {
  const rippling = new FakeRippling("rippling-rippling");
  const page = await rippling.open(context);
  const [, board, job] = /rippling\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/]+)\/jobs\/([^/?]+)/.exec(rippling.url)!;
  await bridge(page, api({ [`https://ats.rippling.com/api/v1/board/${board}/jobs/${job}`]: JSON.stringify(rippling.job) }));

  await inject(page);
  const { phase, rows } = await settled(page);

  expect(phase).toBe("filled");
  expect(shown(rows)).toMatchObject({
    resume: "resume.pdf",
    first_name: "Test",
    last_name: "Person",
    email: "test.person@example.com",
    linkedin_link: "https://www.linkedin.com/in/test-person",
    "eeoc.race": "Asian",
  });
  expect(failed(rows)).toEqual({});
  expect(rippling.parsed).toEqual(["resume.pdf"]);
  expect(rippling.submissions).toEqual([]);
});

test("fills a saved Workable form from a WorkIt profile in one engine call and submits nothing", async ({ context }) => {
  const perry = new FakeWorkable("workable-perryhomes");
  const page = await perry.open(context);
  await bridge(page, api(saved("workable-perryhomes")));

  await inject(page);
  const { phase, rows } = await settled(page);

  expect(phase).toBe("filled");
  expect(shown(rows)).toMatchObject({
    firstname: "Test",
    lastname: "Person",
    email: "test.person@example.com",
    resume: "resume.pdf",
  });
  expect(failed(rows)).toEqual({});
  expect(perry.submissions).toEqual([]);
});

test("fills a saved Eightfold form from a WorkIt profile, reading its questions from the page, and submits nothing", async ({ context }) => {
  const netflix = new FakeEightfold("eightfold-netflix");
  const page = await netflix.open(context);
  await bridge(page, api({}));

  await inject(page);
  const { phase, rows } = await settled(page);

  expect(phase).toBe("filled");
  expect(shown(rows)).toMatchObject({ resume: "resume.pdf" });
  expect(failed(rows)).toEqual({});
  expect(netflix.submissions).toEqual([]);
});

// A Workday application of the questions WorkIt can answer, in Workday's steps.
// My Experience asks its Education entries as a repeating section: the
// student's school is a new panel, whose fields the step then asks.
const WORKDAY_STEPS: Step[] = [
  ["My Information", [
    { key: "legalName--firstName", label: "First Name", kind: "text", required: true },
    { key: "legalName--lastName", label: "Last Name", kind: "text", required: true },
    { key: "phoneNumber", label: "Phone Number", kind: "text", required: true },
  ]],
  ["My Experience", [
    { ...EDUCATION, panels: 0, fields: EDUCATION.fields.map((f) => (f.key === "degree" ? { ...f, options: ["Associate's Degree", "Bachelor's Degree", "Master's Degree"] } : f)) },
    { key: "resumeAttachments", label: "Resume/CV", kind: "file", required: true },
    { key: "linkedinQuestion", label: "LinkedIn", kind: "text" },
  ]],
  ["Application Questions", [
    { key: "authorized", label: "Are you legally authorized to work in the United States?", kind: "dropdown", required: true, options: ["Yes", "No"] },
    { key: "sponsorship", label: "Will you now or in the future require sponsorship for employment visa status?", kind: "dropdown", required: true, options: ["Yes", "No"] },
  ]],
  ["Voluntary Disclosures", [
    { key: "veteranStatus", label: "Veteran Status", kind: "dropdown", required: true,
      options: ["I am a protected veteran", "I am not a protected veteran", "I do not wish to self-identify"] },
  ]],
];

test("fills a Workday application step by step as the student moves on, and submits nothing", async ({ context }) => {
  const workday = new FakeWorkday("workday-caci", { steps: WORKDAY_STEPS, liveEvents: true });
  const page = await workday.open(context);
  await bridge(page, api({}));
  const steps: Record<string, Record<string, unknown>> = {};

  await inject(page);
  for (;;) {
    const { phase, rows } = await settled(page);
    const step = rows.find((r) => r.key === "_step")!.label.replace("Workday: ", "");
    steps[step] = shown(rows);
    // Workday's search names the major its own way: shown, but failed, so the student checks it.
    expect(failed(rows), step).toEqual(step === "My Experience"
      ? { "Education 1 / Field of Study": "meant 'Computer Science', page shows 'Computer and Information Science'" } : {});
    if (phase === "last") break;
    expect(phase).toBe("step");
    // The student checks the step and moves on; the step loads as a new page, where the background injects the fill again.
    const from = page.url();
    await Promise.all([page.waitForURL((url) => url.href !== from), page.click("[data-automation-id=pageFooterNextButton]")]);
    await inject(page);
  }

  expect(steps).toEqual({
    "My Information": {
      "My Information / First Name": "Test", "My Information / Last Name": "Person", "My Information / Phone Number": "5550100199",
    },
    "My Experience": {
      "My Experience / Education": "1", // how many entries: the new panel is planned and filled next
      "My Experience / Education 1 / School or University": "Example State University",
      "My Experience / Education 1 / Degree": "Bachelor's Degree",
      "My Experience / Education 1 / From (YYYY)": "2024",
      "My Experience / Resume/CV": "resume.pdf",
      "My Experience / LinkedIn": "https://www.linkedin.com/in/test-person",
    },
    "Application Questions": {
      "Application Questions / Are you legally authorized to work in the United States?": "Yes",
      "Application Questions / Will you now or in the future require sponsorship for employment visa status?": "No",
    },
    "Voluntary Disclosures": { "Voluntary Disclosures / Veteran Status": "I am not a protected veteran" },
    Review: {},
  });
  expect(workday.submissions).toEqual([]);
});

test("on a job's page that isn't its form, says where the form is and fills nothing", async () => {
  const forms = {
    "https://jobs.lever.co/immuta/b9b21075-74a4-4b64-8f1b-f0be1fb0b24d": "https://jobs.lever.co/immuta/b9b21075-74a4-4b64-8f1b-f0be1fb0b24d/apply",
    "https://jobs.ashbyhq.com/skydio/79fdda46-4ff5-42c7-b208-55f2084cdb8c": "https://jobs.ashbyhq.com/skydio/79fdda46-4ff5-42c7-b208-55f2084cdb8c/application",
    "https://ats.rippling.com/rippling/jobs/a07e4e46-3721-4934-b57b-0d58412e22ba": "https://ats.rippling.com/rippling/jobs/a07e4e46-3721-4934-b57b-0d58412e22ba/apply?step=application",
    "https://apply.workable.com/perryhomes/j/D309E69A5B/": "https://apply.workable.com/perryhomes/j/D309E69A5B/apply",
    "https://explore.jobs.netflix.net/careers/job/790318904468": "https://explore.jobs.netflix.net/careers/apply?pid=790318904468",
  };
  for (const [url, form] of Object.entries(forms)) {
    const prepared = await planFill({
      url, profile: STUDENT, today: "2026-10-22",
      call: async () => { throw new Error("the engine was called"); },
      fetchText: async () => { throw new Error("a job API was fetched"); },
    });

    expect(prepared, url).toEqual({ covered: true, site: expect.any(String), openForm: form });
    expect(formUrl(url)).toBe(form);
  }
});

test("asks the essay route for no more than it takes, though the form's box takes more", async ({ context }) => {
  // Scout Clean Energy's Workable form (live, 2026-10-24): its cover letter box has maxlength 200000, the
  // route takes at most 5000 (backend/app/schemas/essay_answer.py), and the 422 failed the row.
  const scout = new FakeWorkable("workable-scout");
  const page = await scout.open(context);
  const asked: any[] = [];
  await bridge(page, api(saved("workable-scout")), STUDENT, (message) => {
    asked.push(message);
    return "I would like to intern at Scout Clean Energy.";
  });

  await inject(page);
  await settled(page);
  await page.evaluate(() => (document.getElementById("workit-autofiller-overlay-host")!.shadowRoot!.querySelector("[data-generate]") as HTMLElement).click());
  await page.waitForFunction(() => !(window as any).WIA.status.summary().fields.some((f: any) => f.status === "needs_generation"));

  expect(asked.length).toBeGreaterThan(0);
  for (const message of asked) expect(message.maxLength ?? 0).toBeLessThanOrEqual(5000);
  const rows = await page.evaluate(() => (window as any).WIA.status.summary().fields);
  expect(rows.find((r: any) => r.key === "cover_letter")).toMatchObject({ status: "filled", shows: "I would like to intern at Scout Clean Energy." });
  expect(scout.submissions).toEqual([]);
});
