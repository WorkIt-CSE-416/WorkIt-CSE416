// Write early (KAN-379): a queued job's questions that need writing, read
// from its form's link by the Fill engine with no page, and planned with the
// student's saved answers, as background/batch.js's writeEarly sends them.
// The loaded extension's end to end is write-early.extension.spec.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FORMS, boardAndJob, loadHar } from "../fill-engine/test/fake-job-server";
import { formUrl, questionsToWrite } from "../src/background/engine.js";
import { STUDENT } from "./extension";

const DATACOR = "greenhouse-datacor";
const GOALS = "Please write a few sentences around what you are looking to gain from an internship.";

/** The background's fetch, answering only Greenhouse's Job Board API for the saved form (no form page). */
function jobBoardApi(name: string) {
  const asked: string[] = [];
  const fetchText = async (url: string) => {
    asked.push(url);
    const [board, job] = boardAndJob(loadHar(name).log.entries[0].request.url);
    if (url.startsWith(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${job}`)) return readFileSync(join(FORMS, name, "questions.json"), "utf8");
    throw new Error(`${url} answered 404`);
  };
  return { asked, fetchText };
}

const link = (name: string) => formUrl(loadHar(name).log.entries[0].request.url);

test("reads a queued job's questions that need writing from its link, with no page", async () => {
  const { asked, fetchText } = jobBoardApi(DATACOR);

  const questions = await questionsToWrite({ url: link(DATACOR), profile: STUDENT, today: "2026-10-25", fetchText });

  // Datacor's internship question reaches the student's Claude (decision 33): WorkIt keeps no stock answers.
  expect(questions).toEqual([{ name: expect.any(String), label: GOALS, required: true, max_length: null }]);
  expect(asked.every((url) => url.startsWith("https://boards-api.greenhouse.io/"))).toBe(true);
});

test("a question the saved answers hold is not sent to be written", async () => {
  const { fetchText } = jobBoardApi(DATACOR);
  const bank = { [GOALS.toUpperCase()]: { answer: "Real work on a team that ships.", own: false } };

  expect(await questionsToWrite({ url: link(DATACOR), profile: STUDENT, bank, today: "2026-10-25", fetchText })).toEqual([]);
});

test("a form that shows its questions only once open waits for its tab", async () => {
  const fetchText = async (url: string): Promise<string> => {
    throw new Error(`${url} was asked`);
  };
  for (const url of [
    "https://caci.wd1.myworkdayjobs.com/en-US/External/job/Remote/Software-Engineer-Intern_332776/apply",
    "https://lockheedmartin.eightfold.ai/careers/apply?pid=996477106402",
    "https://www.linkedin.com/jobs/view/1",
  ]) {
    expect(await questionsToWrite({ url, profile: STUDENT, today: "2026-10-25", fetchText }), url).toBeNull();
  }
});
