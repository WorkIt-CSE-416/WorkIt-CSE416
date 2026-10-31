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
  // The student's brought policy wins where both say; WorkIt's own sources are still tried first.
  expect(enginePolicies(BROUGHT).how_heard).toEqual({ first: ["WorkIt", "LinkedIn"], prefer: ["careers page"], text: "Careers page" });
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

test("a job's bullets, in order and one a line, are its description (Workday's Role Description)", () => {
  const bullets = [{ id: "b2", position: 1, text: "Cut a report's run time by half." }, { id: "b1", position: 0, text: "Built a made-up dashboard." }];
  const job = (id: string, bullets: object[]) => ({
    id, section: "experience", title: "Intern", organization: "Acme", location: null, start_month: "2025-06", end_month: "2025-08", end_kind: "month", bullets,
  });
  const bank = { entries: [job("j1", bullets), job("j2", [])], skills: [] };

  const history = engineProfile({ ...STUDENT, bank }).experience_facts.employment_history;

  expect(history.map((j: any) => j.description ?? null)).toEqual(["Built a made-up dashboard.\nCut a report's run time by half.", null]);
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
  // Still in a bachelor's: an undergraduate, which the degrees-completed and highest-education rules ask.
  expect(profile.education.degree_level_now).toBe("Undergraduate");
  const finished = { ...STUDENT.bank.entries[0], end_kind: "month" };
  expect(engineProfile({ ...STUDENT, bank: { entries: [finished], skills: [] } }).education.degree_level_now).toBeUndefined();
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

test("the Application answers reach the engine, and the school year comes from the education entry", () => {
  const answers = {
    ...STUDENT.answers, onsite_ok: "yes", full_time_40h: "no", earliest_start: "2027-05-24", latest_end: "2027-08-13",
    available_terms: ["summer 2027"], willing_to_relocate: "yes", location_preferences: ["Springfield, IL", "Remote"],
    internship_location: "Springfield, IL", address_line1: "1 Example Way", postal_code: "00000", languages: ["English", "Spanish"],
    relatives_at: [], relative_public_official: "no", referred_at: ["Initech"], prior_government_work: "no", non_compete: "yes", pending_offers: [],
  };
  const profile = engineProfile({ ...STUDENT, location: "Springfield, IL", answers }, "2026-10-26");

  expect(profile.logistics).toEqual({
    onsite_5_days_ok: true, can_work_full_time_40h: false, earliest_start_date: "2027-05-24", latest_end_date: "2027-08-13",
    available_terms: ["summer 2027"], willing_to_relocate_for_summer: true, location_preferences: [["Springfield, IL", "Springfield"], ["Remote"]],
    referrals: ["Initech"],
  });
  expect(profile.identity.home_address).toEqual({ line1: "1 Example Way", zip: "00000", city: "Springfield", state: "IL", country: "United States" });
  expect(profile.identity.summer_2027_location).toBe("Springfield, IL");
  expect(profile.identity.languages).toEqual([
    { language: "English", spoken: true, written: true }, { language: "Spanish", spoken: true, written: true }]);
  // A screener is the student's own answer: an empty list is their "none".
  expect(profile.screeners).toEqual({
    relatives_at: [], relative_of_public_official: false, prior_us_government_employment: false,
    non_compete_or_conflicting_agreements: true, pending_offers: [],
  });
  // STUDENT graduates in May 2028: a junior this year, back at school after an August internship.
  expect(profile.education.class_year).toBe("3rd Year Undergrad (Junior)");
  expect(profile.education.returning_to_school_after_internship).toBe(true);

  // Nothing answered: no fact, never a default.
  const unanswered = engineProfile(STUDENT, "2026-10-26");
  expect(unanswered.screeners ?? {}).toEqual({});
  expect(unanswered.logistics ?? {}).toEqual({});
  expect(unanswered.education.returning_to_school_after_internship).toBeUndefined();
});

test("never served, age, pay, the EEO extras, interests and an X link reach the engine; the bank gives the internships and current company", () => {
  const answers = {
    ...STUDENT.answers, veteran_status: "not_veteran", age_18_or_over: "yes", expected_hourly_pay: 32.5, accept_posted_pay: "yes",
    sexual_orientation: "declined", transgender: "no", pronouns: "they_them", communities: [], role_interests: ["backend", "ml"],
    x_url: "https://x.com/example",
  };
  const job = (id: string, title: string, organization: string, end_kind: string, end_month: string | null) => ({
    ...STUDENT.bank.entries[0], id, section: "experience", title, organization, degree: null, field_of_study: null,
    start_month: "2024-06", end_month, end_kind, bullets: [],
  });
  const bank = { entries: [...STUDENT.bank.entries, job("x1", "Software Engineering Intern", "Initech", "month", "2024-08"),
    job("x2", "Research Co-op", "Example Lab", "month", "2025-08"), job("x3", "Teaching Assistant", "Example State University", "present", null)], skills: [] };
  const profile = engineProfile({ ...STUDENT, answers, bank }, "2026-10-26");

  expect(profile.voluntary_self_id).toMatchObject({ veteran: "I am not a veteran", sexual_orientation: "decline", transgender: false, communities: [] });
  expect(profile.identity).toMatchObject({ age_18_or_over: true, pronouns: "They/them", current_company: "Example State University" });
  expect(profile.experience_facts).toMatchObject({ prior_internships_count: 2, role_interests: ["Backend", "Machine Learning"] });
  expect(profile.links.x_twitter_url).toBe("https://x.com/example");
  // Pay is the student's own answer, laid over WorkIt's policies.
  expect(enginePolicies({ ...STUDENT, answers }).compensation).toEqual({
    fallback_hourly: 32.5, accept_stated_rate: true, expectation: "Open to the posted range" });
  expect(enginePolicies(STUDENT).compensation).toBeUndefined();

  // A bank with no jobs says nothing of internships; no job held now, no current company.
  const none = engineProfile(STUDENT, "2026-10-26");
  expect(none.experience_facts?.prior_internships_count).toBeUndefined();
  expect(none.identity.current_company).toBeUndefined();
});

test("the countries of citizenship reach the engine", () => {
  const answers = { ...STUDENT.answers, citizenship_countries: ["India"] };
  expect(engineProfile({ ...STUDENT, answers }).work_authorization.citizenship_countries).toEqual(["India"]);
});
