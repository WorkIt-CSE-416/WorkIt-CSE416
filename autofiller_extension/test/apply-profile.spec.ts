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

test("WorkIt applies to US roles only, so a question about working in the UK is No", async () => {
  const asked = "Do you have the right to work in the UK?";
  const prepared: any = await planFill({
    url: "https://boards.greenhouse.io/example/jobs/1", profile: STUDENT, today: "2026-10-22",
    call: async () => { throw new Error("no page"); },
    fetchText: async () => job("greenhouse-arc"),
    extra: [{ name: "uk_right_to_work", label: asked, kind: "select", required: true, options: ["Yes", "No"] }],
  });

  expect(prepared.plan.answers.uk_right_to_work).toBe("No");
});

test("a middle name stays out of the last name", async () => {
  const named = { ...STUDENT, full_name: "Test Middle Person", first_name: "Test", middle_name: "Middle", last_name: "Person" };
  const { labels } = await planned("greenhouse-arc", named);

  expect(labels["First Name"]).toBe("Test");
  expect(labels["Last Name"]).toBe("Person");
});

test("jobs go most recently started first, as the student lists them, a job held now among them", () => {
  const job = (id: string, organization: string, start_month: string, end_month: string | null) => ({
    id, section: "experience", title: "Intern", organization, location: null, start_month, end_month,
    end_kind: end_month ? "month" : "present", bullets: [],
  });
  const bank = { entries: [job("j1", "Initech", "2026-01", null), job("j2", "Globex", "2026-06", "2026-08"), job("j3", "Acme", "2025-06", "2025-08")], skills: [] };

  const history = engineProfile({ ...STUDENT, bank }).experience_facts.employment_history;

  // A form's first Work Experience then has an end date (Greenhouse requires the first entry's).
  expect(history.map((j: any) => j.employer)).toEqual(["Globex", "Initech", "Acme"]);
});

test("the bank's skills (languages first) and earlier schools reach the engine; an empty list keeps what was brought", () => {
  const skill = (name: string, group: string | null) => ({ id: name, name, group });
  const school = (id: string, title: string, degree: string, end_month: string) => ({
    ...STUDENT.bank.entries[0], id, title, degree, field_of_study: null, start_month: null, end_month, end_kind: "month",
  });
  const bank = {
    entries: [...STUDENT.bank.entries, school("e2", "Example High School", "High School Diploma", "2024-06")],
    // As the bank orders them: by group, then name, so "Frameworks" comes before "Languages".
    skills: [skill("React", "Frameworks"), skill("Java", "Languages"), skill("Python", "Languages"), skill("Git", "Tools"), skill("Figma", null)],
  };

  const profile = engineProfile({ ...STUDENT, bank });

  expect(profile.experience_facts.skills).toEqual(["Java", "Python", "React", "Git", "Figma"]);
  expect(profile.education.school).toBe("Example State University");
  expect(profile.education.past_schools).toEqual([{ school: "Example High School", degree: "High School Diploma", end: "2024-06" }]);
  // STUDENT's bank has no skills and one school: what the student brought from Apply stays.
  const brought = engineProfile({ ...STUDENT, fill: { profile: { experience_facts: { skills: ["Rust"] }, education: { past_schools: [{ school: "Old School" }] } } } });
  expect(brought.experience_facts.skills).toEqual(["Rust"]);
  expect(brought.education.past_schools).toEqual([{ school: "Old School" }]);
});

test("a queued full-time job's start date is the day the student graduates, not the internship start", async () => {
  const available = { ...BROUGHT, fill: { ...BROUGHT.fill, profile: { ...BROUGHT.fill.profile,
    education: { graduation_day: 15 }, logistics: { earliest_start_date: "2029-06-01" } } } };
  const prepared: any = await planFill({
    url: "https://boards.greenhouse.io/example/jobs/1", profile: available, today: "2026-10-22", jobType: "full_time",
    call: async () => { throw new Error("no page"); },
    fetchText: async () => job("greenhouse-arc"),
    extra: [{ name: "date_available", label: "Date available", kind: "text", required: true, options: [] }],
  });

  expect(prepared.posting.job_type).toBe("full_time");
  expect(prepared.plan.answers.date_available).toBe("2028-05-15"); // the bank's graduation, on the day brought from Apply
});
