// KAN-329's review: the extension reads a job through the Fill engine (the same
// URLs, queries and company names Apply asks), and shows a field whose page
// shows something other than its planned answer as failed.
import { expect, test } from "@playwright/test";
import { FakeLever } from "../fill-engine/test/fake-lever";
import { loadHar } from "../fill-engine/test/fake-job-server";
import { planFill, questionsToWrite, readJobAhead } from "../src/background/engine.js";
import { STUDENT, bridge, inject, settled } from "./extension";

/** A call to the engine in a page that shows no questions (Eightfold's form, read from the page). */
const noQuestions = async (name: string) => {
  if (name === "readQuestions") return [];
  throw new Error(`the page was asked for ${name}`);
};

test("names an Eightfold careers site's company as Apply does (Lockheed Martin's too)", async () => {
  const fetchText = async (url: string) => {
    if (url === "https://lockheedmartin.eightfold.ai/api/apply/v2/jobs/996477106402") return JSON.stringify({ name: "Software Engineer Intern" });
    throw new Error(`${url} answered 404`);
  };
  const prepared = await planFill({
    url: "https://lockheedmartin.eightfold.ai/careers/apply?pid=996477106402", profile: STUDENT, today: "2026-10-22", call: noQuestions, fetchText,
  });

  expect(prepared.posting).toMatchObject({ company: "Lockheed Martin", title: "Software Engineer Intern" });
});

// TikTok and ByteDance: the form is behind the site's own sign-in, so its questions are read off the open page.
const TIKTOK_FORM = "https://lifeattiktok.com/resume/7693732178706974981/apply";
const TIKTOK_SIGN_IN = "https://lifeattiktok.com/login?redirect_path=/resume/7693732178706974981/apply";
const SIGN_IN_LINE = "Sign in to TikTok, then press Fill. WorkIt never signs in for you.";
/** The engine on TikTok's sign-in page: readQuestions hands the form to the student. */
const onSignIn = async (name: string) => {
  if (name === "readQuestions") throw Object.assign(new Error(SIGN_IN_LINE), { name: "Handoff" });
  throw new Error(`the page was asked for ${name}`);
};

test("reads a TikTok form's questions off the page, and asks no job API for them", async () => {
  const asked: unknown[][] = [];
  const call = async (...args: unknown[]) => {
    asked.push(args);
    return args[0] === "readQuestions" ? [{ name: "name", label: "Name", kind: "text", required: true, options: [] }] : (args[1] as unknown);
  };
  const fetched: string[] = [];
  const fetchText = async (url: string) => {
    fetched.push(url);
    throw new Error(`${url} answered 404`);
  };
  const prepared = await planFill({ url: TIKTOK_FORM, profile: STUDENT, today: "2026-10-26", call, fetchText });

  expect(asked[0]).toEqual(["readQuestions", "tiktok"]);
  expect(prepared).toMatchObject({ covered: true, site: "tiktok", answers: { name: "Test Person" } });
  expect(fetched.every((url) => url.startsWith("https://lifeattiktok.com/search/"))).toBe(true); // only the posting's names and text
  expect(readJobAhead(TIKTOK_FORM, fetchText)).toBe(false);
  expect(await questionsToWrite({ url: TIKTOK_FORM, profile: STUDENT, today: "2026-10-26", fetchText })).toBeNull();
});

test("on TikTok's sign-in the Plan is the student's sign-in, with nothing to fill", async () => {
  for (const url of [TIKTOK_SIGN_IN, TIKTOK_FORM]) {
    const prepared = await planFill({ url, profile: STUDENT, today: "2026-10-26", call: onSignIn, fetchText: async () => "" });
    expect(prepared, url).toEqual({ covered: true, site: "tiktok", signIn: SIGN_IN_LINE });
  }
});

test("a TikTok posting offers its form, behind the sign-in", async () => {
  const prepared = await planFill({ url: "https://lifeattiktok.com/search/7693732178706974981", profile: STUDENT, today: "2026-10-26", call: onSignIn, fetchText: async () => "" });
  expect(prepared).toEqual({ covered: true, site: "tiktok", openForm: TIKTOK_FORM });
});

test("asks Ashby for the company with the query Ashby's own page asks", async () => {
  const bodies: string[] = [];
  const fetchText = async (url: string, init?: { method: string; body: string }) => {
    if (init) bodies.push(init.body);
    throw new Error(`${url} answered 404`);
  };
  await planFill({
    url: "https://jobs.ashbyhq.com/skydio/79fdda46-4ff5-42c7-b208-55f2084cdb8c/application", profile: STUDENT, today: "2026-10-22",
    call: noQuestions, fetchText,
  });

  const organization = bodies.map((b) => JSON.parse(b)).find((b) => b.operationName === "ApiOrganizationFromHostedJobsPageName");
  expect(organization.query).toContain("$searchContext");
});

test("a field the page shows otherwise than its planned answer is failed, with what it shows", async ({ context }) => {
  const immuta = new FakeLever("lever-immuta");
  const page = await immuta.open(context);
  const html = loadHar("lever-immuta").log.entries[0].response.content.text;
  await bridge(page, async (url) => {
    if (url === "https://jobs.lever.co/immuta/b9b21075-74a4-4b64-8f1b-f0be1fb0b24d/apply") return html;
    throw new Error(`${url} answered 404`);
  });
  // The page writes the name its own way once typed.
  await page.evaluate(() => {
    const box = document.querySelector<HTMLInputElement>("input[name=name]")!;
    box.addEventListener("change", () => { box.value = box.value.toUpperCase(); });
  });

  await inject(page);
  const { rows } = await settled(page);

  expect(rows.find((r) => r.key === "name")).toMatchObject({ status: "failed", reason: "meant 'Test Person', page shows 'TEST PERSON'" });
  expect(rows.find((r) => r.key === "email")).toMatchObject({ status: "filled" });
  expect(immuta.submissions).toEqual([]);
});

test("a Plan asks for the job's questions, names and text at once, while the saved answers are still coming", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { FORMS } = await import("../fill-engine/test/fake-job-server");
  const job = readFileSync(join(FORMS, "greenhouse-arc", "questions.json"), "utf8");
  let release!: () => void;
  const answered = new Promise<void>((done) => (release = done));
  const asked: string[] = [];
  const fetchText = async (url: string) => {
    asked.push(url);
    await answered;
    return job;
  };
  // The job's saved answers (GET .../answer-bank), still on their way.
  const bank = answered.then(() => ({}));
  const planning = planFill({ url: "https://boards.greenhouse.io/example/jobs/1", profile: STUDENT, bank, today: "2026-10-26", call: noQuestions, fetchText });
  await new Promise((done) => setTimeout(done, 50));
  // Before any answer: the questions and the job's text are both asked (the names come from the questions' answer).
  expect(asked.some((u) => /questions=true/.test(u))).toBe(true);
  expect(asked.some((u) => /\/jobs\/1$/.test(u))).toBe(true);
  release();
  const prepared: any = await planning;
  expect(prepared.questions.length).toBeGreaterThan(0);
});
