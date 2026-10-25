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
import { letterPdf } from "./letter-pdf.js";
import { unansweredSelfId } from "./self-id.js";

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
 * as the extension answered it before the engine. WorkIt lists US roles
 * only, so a question about working abroad is No (us_roles_only).
 */
export const POLICIES = {
  how_heard: { prefer: ["job board", "other"], text: "WorkIt" },
  marketing_opt_in: false,
  sms_opt_in: false,
  high_stakes_job_systems: [],
  us_roles_only: true,
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

/** Whether a fact is there: not null, empty text, an empty list or an empty section. */
function holds(value) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.values(value).some(holds);
  return true;
}

/**
 * `over` laid over `under`, section by section: a value `over` holds wins,
 * one it lacks leaves `under`'s. Lists are values, never merged.
 */
export function layered(under, over) {
  const out = { ...(under ?? {}) };
  const sections = (v) => v && typeof v === "object" && !Array.isArray(v);
  for (const [key, value] of Object.entries(over ?? {})) {
    if (sections(value) && sections(out[key])) out[key] = layered(out[key], value);
    else if (holds(value)) out[key] = value;
  }
  return out;
}

/** The student's policies: WorkIt's own (POLICIES), with what they brought from Apply over them (a
 * student's own rules are how they apply, so Apply's how-heard beats WorkIt's default). */
export function enginePolicies(profile) {
  return layered(POLICIES, profile?.fill?.policies);
}

/** Bank entries of one section, the most recently started first, as a resume lists jobs (and Apply's
 * profile does): a job held now sits by its start, so a form's first job usually has an end date. */
function newest(entries, section) {
  const ends = (e) => (e.end_kind === "present" ? "9999" : (e.end_month ?? ""));
  return entries
    .filter((e) => e.section === section)
    .sort((a, b) => (b.start_month ?? "").localeCompare(a.start_month ?? "") || ends(b).localeCompare(ends(a)));
}

/** Bank entries of one section, the latest first (one still going comes first). */
function latest(entries, section) {
  const ends = (e) => (e.end_kind === "present" ? "9999" : (e.end_month ?? ""));
  return entries.filter((e) => e.section === section).sort((a, b) => ends(b).localeCompare(ends(a)));
}

/** Drops the keys whose value is null or undefined, so a fact WorkIt lacks is absent, not "null". */
function present(object) {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== null && v !== undefined));
}

/** The profile's free-text home ("Stony Brook, NY") as the engine's city, state and country; null when it reads none. */
function home(location) {
  const place = location ? engine.homePlace(location) : {};
  return Object.keys(place).length ? place : null;
}

/**
 * The WorkIt profile (background/api.js's AutofillProfile) as the engine's
 * profile: facts as nested sections, named as the engine's rules read them.
 * Only what WorkIt holds is given; a question about anything else stays the
 * student's (a Missing fact in the plan). The home is the profile's location
 * as the engine reads it (city and state). The school is the latest education
 * entry; the jobs are the experience entries, most recently started first. Under all of
 * it lies the engine profile the student brought from Apply
 * (`profile.fill`): WorkIt's own fields win where both hold a value.
 * @param {import("../shared/types.js").AutofillProfile} profile
 */
export function engineProfile(profile) {
  return layered(profile.fill?.profile, workitProfile(profile));
}

/** The engine profile from WorkIt's own fields alone. */
function workitProfile(profile) {
  // The profile's own name parts where it has them, so a middle name never joins the last name.
  const [first, ...rest] = (profile.full_name ?? "").trim().split(/\s+/);
  const named = Boolean(profile.first_name && profile.last_name);
  const entries = profile.bank?.entries ?? [];
  const [school] = latest(entries, "education");
  const answers = profile.answers ?? {};
  return {
    identity: present({
      legal_first_name: (named ? profile.first_name : first) || null,
      legal_middle_name: named ? profile.middle_name || null : null,
      legal_last_name: (named ? profile.last_name : rest.join(" ")) || null,
      email: profile.email, phone: profile.phone_number,
      // Where the student lives, as they typed it (KAN-372), read by the engine; one it can't read is left out.
      current_location: home(profile.location),
    }),
    links: present({ linkedin_url: profile.linkedin_url, github_url: profile.github_url, portfolio_url: profile.portfolio_url ?? profile.other_url }),
    // The engine's names for the files it plans (rules.ts): the resume and the unofficial transcript (KAN-369).
    files: present({ resume_pdf: profile.resume?.filename, unofficial_transcript_pdf: profile.transcript?.filename }),
    education: school
      ? present({
          school: school.title,
          degree: school.degree ? engine.degreeLevel(school.degree) : null,
          // As written ("B.S."): the kind a list of kinds (BA, BS) picks by.
          degree_type: school.degree,
          majors: school.field_of_study ? [school.field_of_study] : null,
          gpa_cumulative: school.gpa,
          gpa_scale: school.gpa_scale,
          start_date: school.start_month,
          expected_graduation: school.end_kind === "present" ? null : school.end_month,
        })
      : {},
    experience_facts: {
      employment_history: newest(entries, "experience").map((e) =>
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
      const file = [profile.resume, profile.transcript].find((f) => f && value.file === f.filename);
      return [name, file ? { file: file.filename, type: file.mimeType, base64: file.base64 } : value];
    }),
  );
}

/**
 * The answers with each written one to a file question (an upload: an
 * optional cover letter, written under the cover_letter policy) made a PDF of
 * its words, named for the student as their resume is
 * ("First_Last_Cover_Letter.pdf"), since the field takes only a file.
 */
export function asUploads(answers, questions, profile) {
  const files = new Set((questions ?? []).filter((q) => q.kind === "file").map((q) => q.name));
  const { identity = {} } = engineProfile(profile);
  const who = [identity.legal_first_name, identity.legal_last_name].filter(Boolean).join("_").replace(/[^\p{L}\p{N}_-]+/gu, "_");
  return Object.fromEntries(
    Object.entries(answers ?? {}).map(([name, value]) => {
      if (!files.has(name) || typeof value !== "string" || !value.trim()) return [name, value];
      const label = questions.find((q) => q.name === name).label;
      const what = /cover/i.test(label) ? "Cover_Letter" : "Answer";
      return [name, { file: `${who ? `${who}_` : ""}${what}.pdf`, type: "application/pdf", base64: letterPdf(value) }];
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
 *   url: string, profile: import("../shared/types.js").AutofillProfile, bank?: object, today: string,
 *   call: (name: string, ...args: unknown[]) => Promise<any>,
 *   fetchText: (url: string, init?: { method: string, body: string }) => Promise<string>,
 *   extra?: object[], state?: object,
 * }} options
 */
export async function planFill({ url, profile, bank = {}, today, call, fetchText, extra = [], state }) {
  const job = jobOf(url);
  if (!job) return { covered: false };
  const { site } = job;
  if (!job.onForm) return { covered: true, site, openForm: job.form };
  const fetchOnce = once(fetchText);
  const read = await readQuestions({ job, url, call, fetchText: fetchOnce, state });
  const known = new Set(read.questions.map((q) => q.name));
  // Each text field's own limit, as the form on the page sets it (KAN-380): a written answer is checked against it before it is saved.
  const asked = [...read.questions, ...extra.filter((q) => !known.has(q.name))];
  const questions = await optional(() => call("limits", asked), asked);
  const { posting, plan, planFor } = await planQuestions({ job, url, questions, profile, bank, today, fetchText: fetchOnce });
  const answers = withFiles(plan.answers, profile);
  const prepared = { covered: true, site, posting, questions, plan, answers, applicantId: profile.id, step: read.step, state: read.state };
  return { ...prepared, rows: planRows(prepared), selfId: selfIdAsked(questions, profile, plan, planFor) };
}

/**
 * The self-identification questions this form asks that the student hasn't
 * answered (KAN-387): onboarding no longer asks them, so the first form that
 * does asks the student. Which questions are self-identification is the
 * engine's to say, never a list of labels here: the Plan is made again as if
 * the student had answered every missing one ("declined"), and the questions
 * that only then get an answer are theirs. Null when there are none.
 * @returns {{ keys: string[], names: string[] } | null}
 */
function selfIdAsked(questions, profile, plan, planFor) {
  const keys = unansweredSelfId(profile.answers);
  if (!keys.length || !questions.length) return null;
  const answered = { ...profile.answers, ...Object.fromEntries(keys.map((key) => [key, "declined"])) };
  const probe = planFor({ ...profile, answers: answered });
  const names = Object.keys(probe.answers).filter((name) => !(name in plan.answers));
  return names.length ? { keys, names } : null;
}

/**
 * The engine's Plan for a job's questions, with the job's names and text
 * read for it. `bank`: the saved answers this job's form may reuse
 * (GET .../applications/{job}/answer-bank, KAN-379), the engine's Answer bank, which fills a question answered
 * before, and says where it may be reused; or a function of the page's company that answers them (a form
 * outside a batch, GET .../answer-bank?company=).
 */
async function planQuestions({ job, url, questions, profile, bank, today, fetchText }) {
  const names = await optional(() => engine.jobNames(url, fetchText), { company: "", title: "" });
  const text = engine.textOf(await optional(() => engine.jobDescription(url, fetchText), ""));
  const posting = { id: String(job.job ?? job.shortcode ?? job.pid ?? url), ...names, url };
  if (typeof bank === "function") bank = questions.length ? await bank(names.company) : {};
  // `planFor`: the same Plan for another profile (the self-identification's probe, KAN-387).
  const planFor = (someone) => engine.plan(questions, engineProfile(someone), enginePolicies(someone), bank ?? {}, { posting, today, postingText: text, employerText: text });
  const plan = questions.length
    ? planFor(profile)
    : { answers: {}, essays: [], drafts: [], missing: [], handoffs: [], accepted: {}, sources: {} };
  return { posting, plan, planFor };
}

/**
 * Write early (KAN-379): the questions a queued job's form needs written,
 * read from its form's link (`formUrl`) with no tab open, and planned as its tab will plan
 * them, so the student's Claude can write them before the tab opens. In the
 * shape PUT .../applications/{job}/questions takes; the form's own length
 * limit is unknown until the tab reads its fields, so `max_length` is null.
 * Null when only the open form shows its questions (Workday, Eightfold, an
 * Ashby form whose query failed), or the link is no form the engine covers.
 * @param {{ url: string, profile: object, bank?: object, today: string, fetchText: Function }} options
 * @returns {Promise<{ name: string, label: string, required: boolean, max_length: null }[] | null>}
 */
export async function questionsToWrite({ url, profile, bank = {}, today, fetchText }) {
  const job = jobOf(url);
  if (!job || job.practice || job.site === "workday" || job.site === "eightfold") return null;
  const fetchOnce = once(fetchText);
  let questions;
  try {
    questions = await engine.questionSet(url, fetchOnce);
  } catch {
    return null;
  }
  const { plan } = await planQuestions({ job, url, questions, profile, bank, today, fetchText: fetchOnce });
  return planRows({ plan }).written.map((q) => ({
    name: q.name.slice(0, WRITTEN_NAME_MAX),
    label: q.label.slice(0, WRITTEN_LABEL_MAX),
    required: Boolean(q.required),
    max_length: null,
    ...(q.kind ? { kind: q.kind, options: q.options } : {}),
  }));
}

// The connector's limits on a question (backend/app/schemas/applications.py), as content-script.js cuts them.
const WRITTEN_NAME_MAX = 200;
const WRITTEN_LABEL_MAX = 2000;

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
 * - `written`: questions for the student's Claude to answer (the Plan's
 *   essays, and every one-off draft but a file), each with `max_length`,
 *   its field's own limit as the engine read it from the form (null when it
 *   sets none). A draft that is a choice whose options were read has `kind`
 *   "choice" (a select) or "choices" (a multi-select) and its `options`
 *   (KAN-369), which the connector shows Claude and takes only. `generate`:
 *   the essay-answer route writes it (an essay, or a draft in a text area),
 *   so outside a batch tab it waits for the student's one Generate click;
 *   the rest are the student's there (content-script.js).
 * - `yours`: questions WorkIt has no answer for (Missing facts, and a draft
 *   that is a file).
 * - `notes`: what the Plan leaves to the student and why (an AI trap or ban,
 *   a video), and a screener the student would not pass.
 * A form that bans AI-written text never has `written`: the Plan hands its
 * essays off instead, so nothing AI-written goes where it is banned.
 * @returns {{ written: Row[], yours: Row[], notes: string[] }}
 * @typedef {{ name: string, label: string, required: boolean, max_length?: number | null }} Row
 */
export function planRows({ plan }) {
  const row = (q) => ({ name: q.name, label: q.label, required: q.required });
  // Only a text area takes the essay route's answer: it writes sentences, so a one-line draft
  // ("Nick Name", Hermeus's Lever form) or a choice is the student's Claude's alone.
  const takesText = (q) => q.kind === "textarea";
  const drafts = plan.drafts ?? [];
  const toClaude = (q) => q.kind !== "file" && !tooManyOptions(q);
  const notes = [...(plan.handoffs ?? [])];
  if (plan.not_eligible) notes.push(`You may not meet this requirement: ${plan.not_eligible}`);
  return {
    written: [
      ...plan.essays.map((q) => ({ ...row(q), max_length: q.maxLength ?? null, generate: true })),
      ...drafts.filter(toClaude).map((q) => ({ ...row(q), max_length: q.maxLength ?? null, generate: takesText(q), ...choice(q) })),
    ],
    yours: [...plan.missing, ...drafts.filter((q) => !toClaude(q))].map(row),
    notes,
  };
}

// The connector's limits on a choice's options (backend/app/schemas/applications.py): a longer
// list (a country, a school) is no one-off question, and stays the student's.
const OPTIONS_MAX = 300;
const OPTION_MAX = 500;
const CHOICE_KINDS = { select: "choice", multi_select: "choices" };

/** Whether a choice has more options, or longer ones, than the connector takes. */
function tooManyOptions(q) {
  return Boolean(CHOICE_KINDS[q.kind]) && (q.options.length > OPTIONS_MAX || q.options.some((o) => o.length > OPTION_MAX));
}

/** A draft's `kind` and `options` for the student's Claude when it is a choice whose options were read
 * (not only "Select..." placeholders, which the engine answers in words); else none (written in words). */
function choice(q) {
  const unread = q.options.every((o) => /^\W*((select|choose|pick)\b.*)?$/i.test(o.trim()));
  if (!CHOICE_KINDS[q.kind] || unread) return {};
  return { kind: CHOICE_KINDS[q.kind], options: q.options };
}

/**
 * The content script's fill messages, as the background answers them:
 * `fill/plan` (planFill, for the page at `url`), `fill/page` (fillPage) and
 * `fill/read` (what named fields show now, `{ shows: {[name]: value} }`),
 * `fill/moot` (the named follow-ups the answers given don't call for, `{ moot: {[name]: {answer}} }`,
 * `answer` the N/A to fill or null to leave blank) and
 * `fill/required` (the questions the form requires now that show nothing,
 * `{ empty: [name], unasked: [Question] }`, `unasked` being the required
 * fields the Question set lacks, which `empty` covers too).
 * On Workday, the nested prompts the engine read for a tenant are kept
 * (`trees`, chrome.storage in the extension) and given back on its next
 * call, as Apply keeps them: reading Workday's own How Did You Hear About
 * Us? takes seconds.
 * @param {{ type: string, [key: string]: any }} message
 * @param {{ url: string, profile: object, bank?: object, today: string, call: Function, fetchText: Function,
 *   trees?: { load(): Promise<object>, save(saved: object): Promise<void> } }} context
 */
export async function handleFill(message, { url, profile, bank, today, call, fetchText, trees }) {
  const withTrees = async (state) => (state && trees ? { ...state, trees: { ...state.trees, ...(await trees.load()) } } : state);
  const keep = async (state) => {
    if (state?.saved && trees && Object.keys(state.saved).length) await trees.save(state.saved);
    return state;
  };
  let answer;
  if (message.type === "fill/plan") {
    let state = message.state;
    if (!state && trees && jobOf(url)?.site === "workday") state = { tenant: jobOf(url).tenant, trees: {} };
    answer = await planFill({ url, profile, bank, today, call, fetchText, extra: message.extra, state: await withTrees(state) });
  } else if (message.type === "fill/page") {
    answer = await fillPage({ call, ...message, answers: asUploads(message.answers, message.questions, profile), state: await withTrees(message.state) });
  } else if (message.type === "fill/read") {
    // What each named field shows now (the engine's read-back), after the student changed the form.
    return { shows: await call("readback", message.site, message.questions, message.names, message.state) };
  } else if (message.type === "fill/moot") {
    // The follow-ups among `names` that the answers now on the form don't call for (a parent the
    // student's Claude or the student answered after the Plan), each with its answer: N/A, or none.
    const byName = new Map(message.questions.map((q) => [q.name, q]));
    const moot = {};
    for (const name of message.names) {
      const q = byName.get(name);
      const [notNeeded, answer] = q ? engine.notCalledFor(q, message.questions, message.answers) : [false, null];
      if (notNeeded) moot[name] = { answer };
    }
    return { moot };
  } else if (message.type === "fill/required") {
    // The fields the form won't send without that show nothing, the planned and the unplanned alike
    // (Greenhouse's phone country, required once Phone shows a number, is in no Question set as required),
    // and the required fields the Question set lacks altogether (Ashby, Eightfold), given back as
    // `unasked` questions so the tab reads them again after each edit.
    const unasked = message.site === "workday" ? [] : await call("unaskedQuestions", message.site, message.questions);
    return { empty: await call("emptyRequired", message.site, [...message.questions, ...unasked], message.state), unasked };
  } else {
    throw new Error(`Unknown fill message: ${message.type}`);
  }
  await keep(answer.state);
  return answer;
}
