// KAN-329's review: the extension reads a job through the Fill engine (the same
// URLs, queries and company names Apply asks).
import { expect, test } from "@playwright/test";
import { planFill } from "../src/background/engine.js";
import { STUDENT } from "./extension";

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
