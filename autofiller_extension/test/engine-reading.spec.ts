// KAN-329's review: the extension reads a job through the Fill engine (the same
// URLs, queries and company names Apply asks), and shows a field whose page
// shows something other than its planned answer as failed.
import { expect, test } from "@playwright/test";
import { FakeLever } from "../fill-engine/test/fake-lever";
import { loadHar } from "../fill-engine/test/fake-job-server";
import { planFill } from "../src/background/engine.js";
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
