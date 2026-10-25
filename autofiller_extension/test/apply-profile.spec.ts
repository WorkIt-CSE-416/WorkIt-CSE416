// The engine profile and policies a student brought from Apply (GET
// .../fill-profile, the profile's `fill`): their facts reach the fill under
// WorkIt's own fields, which win where both hold a value. Dummy data only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FakeJobServer, FORMS } from "../fill-engine/test/fake-job-server";
import { engineProfile, enginePolicies, planFill } from "../src/background/engine.js";
import { STUDENT, bridge, failed, inject, settled, shown } from "./extension";

/** STUDENT with no gender answered in WorkIt, and what they brought from Apply. */
const BROUGHT = {
  ...STUDENT,
  answers: { ...STUDENT.answers, gender: null },
  fill: {
    profile: {
      identity: { legal_first_name: "Brought", email: "brought.person@example.com" },
      voluntary_self_id: { gender: "Female", transgender: false },
      screeners: { previously_employed_by: ["Initech"] },
    },
    policies: { cover_letter: "always", how_heard: { prefer: ["careers page"], text: "Careers page" } },
  },
};

const job = (form: string) => readFileSync(join(FORMS, form, "questions.json"), "utf8");

async function planned(form: string, profile: object) {
  const prepared: any = await planFill({
    url: "https://boards.greenhouse.io/example/jobs/1", profile, today: "2026-10-22",
    call: async () => { throw new Error("no page"); },
    fetchText: async () => job(form),
  });
  const label = (name: string) => prepared.questions.find((q: any) => q.name === name)?.label;
  return { prepared, labels: Object.fromEntries(Object.entries(prepared.plan.answers).map(([n, a]) => [label(n), a])) };
}

test("a brought self-identification fills the form, and WorkIt's own fields win", async ({ context }) => {
  const arc = new FakeJobServer("greenhouse-arc");
  const page = await arc.open(context);
  await bridge(page, async () => job("greenhouse-arc"), BROUGHT as typeof STUDENT);

  await inject(page);
  const { phase, rows } = await settled(page);

  expect(phase).toBe("filled");
  expect(shown(rows)).toMatchObject({
    first_name: "Test", // WorkIt's name, not the brought one
    email: "test.person@example.com",
    gender: "Female", // WorkIt has none; the brought one fills
    race: "Asian", // WorkIt's own
  });
  expect(failed(rows)).toEqual({});
  expect(arc.submissions).toEqual([]);
});

test("a brought screener answers what WorkIt can't", async () => {
  const without = await planned("greenhouse-datacor", STUDENT);
  const withIt = await planned("greenhouse-datacor", BROUGHT);
  const asked = "Have you worked for Datacor or a subsidiary (TrackAbout, Chemstations, Format Solutions, AFT, etc) previously?";

  expect(without.prepared.plan.missing.map((q: any) => q.label)).toContain(asked);
  expect(withIt.labels[asked]).toBe("No");
});

test("brought policies reach the Plan over WorkIt's own", async () => {
  const essays = async (profile: object) => (await planned("greenhouse-arc", profile)).prepared.plan.essays.map((q: any) => q.label);

  // cover_letter "always": the optional Cover Letter is written too.
  expect(await essays(STUDENT)).not.toContain("Cover Letter");
  expect(await essays(BROUGHT)).toContain("Cover Letter");
  // The student's brought policy wins where both say.
  expect(enginePolicies(BROUGHT).how_heard).toEqual({ prefer: ["careers page"], text: "Careers page" });
  expect(enginePolicies(STUDENT).cover_letter).toBeUndefined();
});

test("the name's parts are WorkIt's own first, middle and last names, never a middle name taken as the last", () => {
  const named = { ...BROUGHT, full_name: "Test Middle Person", first_name: "Test", middle_name: "Middle", last_name: "Person",
    fill: { profile: { identity: { legal_first_name: "Test", legal_middle_name: "Middle", legal_last_name: "Person" } } } };
  expect(engineProfile(named).identity).toMatchObject({ legal_first_name: "Test", legal_middle_name: "Middle", legal_last_name: "Person" });
  // A profile with the full name alone: its first and last words, the words between the middle name.
  const { first_name, middle_name, last_name, ...unsplit } = named;
  expect(engineProfile({ ...unsplit, fill: null }).identity).toMatchObject({ legal_first_name: "Test", legal_middle_name: "Middle", legal_last_name: "Person" });
});
