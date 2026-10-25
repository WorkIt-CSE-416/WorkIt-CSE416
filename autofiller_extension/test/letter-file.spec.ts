// A written answer to a file question (an optional cover letter upload, which
// a student's cover_letter "always" policy has their Claude write): the
// letter goes up as a PDF named for the student, as their resume does.
// Dummy data only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FakeJobServer, FORMS } from "../fill-engine/test/fake-job-server";
import { engineCaller, handleFill, runEngine } from "../src/background/engine.js";
import { letterPdf } from "../src/background/letter-pdf.js";
import { STUDENT } from "./extension";

const COVER = "5484c998-f68e-43b6-9bfa-e06eaabe637f";
const LETTER = "Dear Example Recruiting Team:\n\nI build tools people rely on, and I would like to build yours.\n\nSincerely,\nTest Person";

test("a letter written for a file question is attached as the student's PDF", async ({ context }) => {
  const patreon = new FakeJobServer("ashby-patreon");
  const page = await patreon.open(context);
  const posting = readFileSync(join(FORMS, "ashby-patreon", "questions.json"), "utf8");
  const call = engineCaller((request) => page.evaluate(runEngine, request));
  await page.evaluate(readFileSync(join(__dirname, "..", "fill-engine/dist/engine.js"), "utf8") + "\n;undefined");
  const context_ = { url: page.url(), profile: STUDENT, today: "2026-10-22", call, fetchText: async () => posting };
  const { questions, site } = await handleFill({ type: "fill/plan" }, context_);

  const filled = await handleFill({ type: "fill/page", site, questions, answers: { [COVER]: LETTER } }, context_);

  expect(filled.results[COVER]).toEqual({ status: "filled", shows: "Test_Person_Cover_Letter.pdf" });
  expect(patreon.submissions).toEqual([]);
});

test("the letter's PDF holds its words", () => {
  const pdf = Buffer.from(letterPdf(LETTER), "base64").toString("latin1");

  expect(pdf.startsWith("%PDF-1.4")).toBe(true);
  expect(pdf).toContain("(Dear Example Recruiting Team:)");
  expect(pdf).toContain("(Test Person)");
  expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
});
