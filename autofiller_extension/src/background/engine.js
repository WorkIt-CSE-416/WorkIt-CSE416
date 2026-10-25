// The extension's side of the Fill engine (the fill-engine submodule, KAN-329):
// the WorkIt profile mapped to the engine's profile, and the two fill
// messages. Everything about a job and its form is the engine's: which job
// systems it covers (`jobOf`), the job's Question set, names and text, read
// from the job system's public APIs with the background's fetch, the Plan,
// and the fill, done in the application's page (the page's MAIN world,
// ENGINE_FILES), which this module reaches through `call`: the background
// makes it with chrome.scripting.executeScript and the test with
// Playwright's page.evaluate, both running `runEngine` in the page.
//
// The background holds its own copy of the engine for what needs no page
// (reading a job, planning). No chrome.* API is used at import time, so the
// extension's test imports this file as it is.
import "../../fill-engine/dist/engine.js";
import { DEV_WEB_URL, PROD_SITES } from "../shared/config.js";

/** The engine's own copy here, for what needs no page. */
const engine = globalThis.FillEngine;

/**
 * The job system and job an application page belongs to, when the engine
 * covers it; null on any other page, which the extension leaves alone (the
 * engine's `jobOf`: its `form`, and whether this page is it).
 * @param {string} url
 */
export function jobOf(url) {
  const practice = practiceJob(url);
  if (practice) return practice.page === "apply" ? { site: "lever", practice: true, company: practice.company, job: practice.job, form: url, onForm: true } : null;
  return engine.jobOf(url);
}

/**
 * Whether `url` is a page a job system shows only once an application is
 * sent (Greenhouse's confirmation, Lever's thanks): the student's submit
 * went through (the engine's `submittedPage`).
 * @param {string} url
 */
export function submittedPage(url) {
  return engine.submittedPage(url);
}

// WorkIt's own web origins: the only ones whose practice forms are filled.
const WEB_ORIGINS = [DEV_WEB_URL, ...PROD_SITES.map((site) => site.web)];
const PRACTICE_PATH = /^\/practice\/([a-z0-9-]+)\/([0-9a-f-]{36})\/(apply|thanks)\/?$/;

/**
 * A practice job's page on WorkIt's own site (onboarding's practice batch,
 * KAN-378; frontend/src/lib/practice-form.ts): its form (`apply`) or the
 * page its Submit opens (`thanks`). Null for any other page. The practice
 * form is laid out as Lever's, so `jobOf` gives it to the engine's Lever
 * Filler, and its Question set is read from its own HTML as a Lever form's is.
 * @param {string} url
 * @returns {{ company: string, job: string, page: "apply" | "thanks" } | null}
 */
export function practiceJob(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!WEB_ORIGINS.includes(parsed.origin)) return null;
  const m = PRACTICE_PATH.exec(parsed.pathname);
  return m ? { company: m[1], job: m[2], page: m[3] } : null;
}

/** The link to open for an application: its form, where the engine covers the job system. */
export function formUrl(url) {
  return jobOf(url)?.form ?? url;
}

/**
 * Runs in the application's page, so it reads nothing outside itself: the
 * engine's own dispatcher, `FillEngine.call`, which answers `{ value }` or
 * `{ error: { name, message } }` (an error thrown in the page would lose its name).
 * @param {{ name: string, args: unknown[] }} request
 */
export async function runEngine({ name, args }) {
  if (typeof globalThis.FillEngine === "undefined") return { error: { name: "Error", message: "The fill engine is not loaded in this page" } };
  return globalThis.FillEngine.call(name, args);
}

/**
 * A `call(name, ...args)` from a function that runs `runEngine` in the page,
 * throwing the engine's errors again with their names (FillError, NoForm).
 * @param {(request: { name: string, args: unknown[] }) => Promise<any>} run
 */
export function engineCaller(run) {
  return async (name, ...args) => {
    const answer = await run({ name, args });
    if (answer?.error) throw Object.assign(new Error(answer.error.message), { name: answer.error.name });
    return answer?.value;
  };
}

/**
 * How WorkIt answers the questions no student fact covers. Nothing here is a
 * student's choice made for them: pay, defense roles, consent boxes and
 * cover letters stay the student's to answer. "How did you hear about this
 * job?" is WorkIt (a free-text box) or the form's own "Job Board" (a list),
 * as the extension answered it before the engine.
 */
export const POLICIES = {
  how_heard: { prefer: ["job board", "other"], text: "WorkIt" },
  marketing_opt_in: false,
  sms_opt_in: false,
  high_stakes_job_systems: [],
};

// The words a form reads, for each of the autofill answers' option keys
// (frontend/src/lib/autofill-answers.ts's labels, where a rule reads words).
const CITIZENSHIP = {
  us_citizen: "US citizen",
  permanent_resident: "U.S. Permanent Resident (Green Card)",
  f1_student: "F-1 Student (CPT, OPT or STEM OPT)",
  h1b: "H-1B",
  other_visa: "Other Visa",
  asylee_refugee: "Asylee or Refugee",
};
const CLEARANCE = {
  none: "None", public_trust: "Public Trust", confidential: "Confidential", secret: "Secret", top_secret: "Top Secret", ts_sci: "Top Secret / SCI",
};
const GENDER = { male: "Male", female: "Female", non_binary: "Non-Binary", declined: "decline" };
const RACE = {
  american_indian_alaska_native: "American Indian or Alaska Native",
  asian: "Asian",
  black_african_american: "Black or African American",
  native_hawaiian_pacific_islander: "Native Hawaiian or Other Pacific Islander",
  white: "White",
  two_or_more: "Two or More Races",
  declined: "decline",
};
const VETERAN = { protected_veteran: true, not_protected_veteran: "I am not a protected veteran", declined: "decline" };
const YES_NO_DECLINE = { yes: true, no: false, declined: "decline" };
const YES_NO = { yes: true, no: false };

/** Bank entries of one section, the latest first (one still going comes first). */
function latest(entries, section) {
  const ends = (e) => (e.end_kind === "present" ? "9999" : (e.end_month ?? ""));
  return entries.filter((e) => e.section === section).sort((a, b) => ends(b).localeCompare(ends(a)));
}

/** Drops the keys whose value is null or undefined, so a fact WorkIt lacks is absent, not "null". */
function present(object) {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== null && v !== undefined));
}

/**
 * The WorkIt profile (background/api.js's AutofillProfile) as the engine's
 * profile: facts as nested sections, named as the engine's rules read them.
 * Only what WorkIt holds is given; a question about anything else stays the
 * student's (a Missing fact in the plan). The school is the latest education
 * entry; the jobs are the experience entries, latest first.
 * @param {import("../shared/types.js").AutofillProfile} profile
 */
export function engineProfile(profile) {
  const [first, ...rest] = (profile.full_name ?? "").trim().split(/\s+/);
  const entries = profile.bank?.entries ?? [];
  const [school] = latest(entries, "education");
  const answers = profile.answers ?? {};
  return {
    identity: present({ legal_first_name: first || null, legal_last_name: rest.join(" ") || null, email: profile.email, phone: profile.phone_number }),
    links: present({ linkedin_url: profile.linkedin_url, github_url: profile.github_url, portfolio_url: profile.portfolio_url ?? profile.other_url }),
    files: present({ resume_pdf: profile.resume?.filename }),
    education: school
      ? present({
          school: school.title,
          degree: school.degree ? engine.degreeLevel(school.degree) : null,
          majors: school.field_of_study ? [school.field_of_study] : null,
          gpa_cumulative: school.gpa,
          gpa_scale: school.gpa_scale,
          start_date: school.start_month,
          expected_graduation: school.end_kind === "present" ? null : school.end_month,
        })
      : {},
    experience_facts: {
      employment_history: latest(entries, "experience").map((e) =>
        present({ employer: e.organization, title: e.title, start: e.start_month, end: e.end_kind === "present" ? null : e.end_month, location: e.location }),
      ),
    },
    work_authorization: present({
      authorized_to_work_us: YES_NO[answers.work_authorized_us],
      requires_sponsorship_now_or_future: YES_NO[answers.needs_sponsorship],
      citizenship: CITIZENSHIP[answers.work_authorization_status],
      security_clearance: CLEARANCE[answers.security_clearance],
    }),
    voluntary_self_id: present({
      gender: GENDER[answers.gender],
      hispanic_or_latino: YES_NO_DECLINE[answers.hispanic_latino],
      race: RACE[answers.race],
      veteran: VETERAN[answers.veteran_status],
      disability: YES_NO_DECLINE[answers.disability_status],
    }),
  };
}

/** The Plan's answers with each file the profile names given its bytes, as the engine attaches them. */
function withFiles(answers, profile) {
  return Object.fromEntries(
    Object.entries(answers).map(([name, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [name, value];
      const resume = profile.resume;
      return [name, resume && value.file === resume.filename ? { file: resume.filename, type: resume.mimeType, base64: resume.base64 } : value];
    }),
  );
}

/** What `read` gives back, or `fallback` when it fails: for what only names the job (company, title, its text), never the questions. */
async function optional(read, fallback) {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

/** `fetchText` asking each URL (and POST body) once: a job's questions, names and text often come from one answer. */
function once(fetchText) {
  const asked = new Map();
  return (url, init) => {
    const key = `${url}\n${init?.body ?? ""}`;
    if (!asked.has(key)) asked.set(key, fetchText(url, init));
    return asked.get(key);
  };
}

/**
 * The job's Question set as Apply reads it: fetched from the job system's
 * public API and read by the engine, else off the open form by the engine
 * (Eightfold's questions API answers only the page's own session; Workday
 * shows its questions a step at a time, once the student has signed in;
 * Ashby's query is undocumented, so on any failure its form is read).
 * Workday's also gives the step it is on and the engine's state.
 */
async function readQuestions({ job, url, call, fetchText, state }) {
  if (job.site === "workday") {
    const shown = await call("readQuestions", "workday", state ?? { tenant: job.tenant, trees: {} });
    const step = { name: shown.step, sections: shown.sections, sends: shown.sends, review: shown.review, wentWrong: Boolean(shown.wentWrong) };
    return { questions: shown.questions, step, state: shown.state };
  }
  if (job.site === "eightfold") return { questions: await call("readQuestions", "eightfold") };
  // A practice form's questions are in its own page, as a Lever form's are in its /apply page.
  if (job.practice) return { questions: engine.parseQuestions("lever", await fetchText(url)) };
  try {
    return { questions: await engine.questionSet(url, fetchText) };
  } catch (error) {
    if (job.site !== "ashby") throw error;
    return { questions: await call("readQuestions", "ashby") };
  }
}

/**
 * Everything a fill needs, before anything is filled: the job's Question set
 * (with `extra`, the questions earlier fills brought on), and the engine's
 * Plan for the WorkIt profile, with file answers holding their bytes, and the
 * rows the overlay lists besides the planned answers (`planRows`). On a page
 * the engine doesn't cover, `{ covered: false }` and nothing is fetched; on a
 * job's page that isn't its form, `openForm`. On Workday it is the step
 * shown, with `step` and the engine's `state`.
 * @param {{
 *   url: string, profile: import("../shared/types.js").AutofillProfile, today: string,
 *   call: (name: string, ...args: unknown[]) => Promise<any>,
 *   fetchText: (url: string, init?: { method: string, body: string }) => Promise<string>,
 *   extra?: object[], state?: object,
 * }} options
 */
export async function planFill({ url, profile, today, call, fetchText, extra = [], state }) {
  const job = jobOf(url);
  if (!job) return { covered: false };
  const { site } = job;
  if (!job.onForm) return { covered: true, site, openForm: job.form };
  const fetchOnce = once(fetchText);
  const read = await readQuestions({ job, url, call, fetchText: fetchOnce, state });
  const known = new Set(read.questions.map((q) => q.name));
  const questions = [...read.questions, ...extra.filter((q) => !known.has(q.name))];
  const names = await optional(() => engine.jobNames(url, fetchOnce), { company: "", title: "" });
  const text = engine.textOf(await optional(() => engine.jobDescription(url, fetchOnce), ""));
  const posting = { id: String(job.job ?? job.shortcode ?? job.pid ?? url), ...names, url };
  const plan = questions.length
    ? engine.plan(questions, engineProfile(profile), POLICIES, {}, { posting, today, postingText: text, employerText: text })
    : { answers: {}, essays: [], drafts: [], missing: [], handoffs: [], accepted: {}, sources: {} };
  const answers = withFiles(plan.answers, profile);
  const prepared = { covered: true, site, posting, questions, plan, answers, applicantId: profile.id, step: read.step, state: read.state };
  return { ...prepared, rows: planRows(prepared) };
}

/**
 * Fills `answers` on the page through the engine's `fillEach`, which fills
 * the whole page in its own order and says how each answer went, as the
 * overlay shows it: "filled" with what the field shows now, "skipped" when
 * the form never showed the field (it depends on another answer), or
 * "failed" with the engine's reason, including a field that shows something
 * other than its planned answer. `more`: questions the fill brought on
 * (Eightfold's follow-ups, Workday's new panels and follow-ups), to plan and
 * fill next; a field not filled yet then has no result.
 * @returns {Promise<{ results: Record<string, Result>, more?: object[], state?: object }>}
 * @typedef {{ status: "filled", shows: string | string[] } | { status: "skipped" | "failed", reason: string }} Result
 */
export async function fillPage({ call, site, questions, answers, accepted, state, sections }) {
  try {
    const filled = await call("fillEach", site, questions, answers, { accepted: accepted ?? {}, state, sections });
    return { results: filled.results, ...(filled.moreQuestions ? { more: filled.moreQuestions } : {}), state: filled.state ?? state };
  } catch (error) {
    const reason = ["FillError", "Handoff", "NoForm"].includes(error.name) ? error.message : `Fill failed: ${error.message}`;
    return { results: Object.fromEntries(Object.keys(answers).map((name) => [name, { status: "failed", reason }])), state };
  }
}

/**
 * What the overlay lists besides the planned answers, from the Plan:
 * - `written`: questions that need a written answer (the Plan's essays, and
 *   its drafts in a text area). Each waits for the student's one Generate
 *   click, then goes to the essay-answer route.
 * - `yours`: questions WorkIt has no answer for (Missing facts, and drafts
 *   that are a choice or one line, which a written answer can't make).
 * - `notes`: what the Plan leaves to the student and why (an AI trap or ban,
 *   a video), and a screener the student would not pass.
 * A form that bans AI-written text never has `written`: the Plan hands its
 * essays off instead, so nothing AI-written goes where it is banned.
 * @returns {{ written: Row[], yours: Row[], notes: string[] }}
 * @typedef {{ name: string, label: string, required: boolean }} Row
 */
export function planRows({ plan }) {
  const row = (q) => ({ name: q.name, label: q.label, required: q.required });
  // Only a text area takes a written answer: the essay route writes sentences, so a one-line
  // draft ("Nick Name", Hermeus's Lever form) is the student's.
  const takesText = (q) => q.kind === "textarea";
  const drafts = plan.drafts ?? [];
  const notes = [...(plan.handoffs ?? [])];
  if (plan.not_eligible) notes.push(`You may not meet this requirement: ${plan.not_eligible}`);
  return {
    written: [...plan.essays, ...drafts.filter(takesText)].map(row),
    yours: [...plan.missing, ...drafts.filter((q) => !takesText(q))].map(row),
    notes,
  };
}

/**
 * The content script's fill messages, as the background answers them:
 * `fill/plan` (planFill, for the page at `url`), `fill/page` (fillPage) and
 * `fill/read` (what named fields show now, `{ shows: {[name]: value} }`) and
 * `fill/required` (the questions the form requires now that show nothing,
 * `{ empty: [name] }`).
 * On Workday, the nested prompts the engine read for a tenant are kept
 * (`trees`, chrome.storage in the extension) and given back on its next
 * call, as Apply keeps them: reading Workday's own How Did You Hear About
 * Us? takes seconds.
 * @param {{ type: string, [key: string]: any }} message
 * @param {{ url: string, profile: object, today: string, call: Function, fetchText: Function,
 *   trees?: { load(): Promise<object>, save(saved: object): Promise<void> } }} context
 */
export async function handleFill(message, { url, profile, today, call, fetchText, trees }) {
  const withTrees = async (state) => (state && trees ? { ...state, trees: { ...state.trees, ...(await trees.load()) } } : state);
  const keep = async (state) => {
    if (state?.saved && trees && Object.keys(state.saved).length) await trees.save(state.saved);
    return state;
  };
  let answer;
  if (message.type === "fill/plan") {
    let state = message.state;
    if (!state && trees && jobOf(url)?.site === "workday") state = { tenant: jobOf(url).tenant, trees: {} };
    answer = await planFill({ url, profile, today, call, fetchText, extra: message.extra, state: await withTrees(state) });
  } else if (message.type === "fill/page") {
    answer = await fillPage({ call, ...message, state: await withTrees(message.state) });
  } else if (message.type === "fill/read") {
    // What each named field shows now (the engine's read-back), after the student changed the form.
    return { shows: await call("readback", message.site, message.questions, message.names, message.state) };
  } else if (message.type === "fill/required") {
    // The fields the form won't send without that show nothing, the planned and the unplanned alike
    // (Greenhouse's phone country, required once Phone shows a number, is in no Question set as required).
    return { empty: await call("emptyRequired", message.site, message.questions, message.state) };
  } else {
    throw new Error(`Unknown fill message: ${message.type}`);
  }
  await keep(answer.state);
  return answer;
}
