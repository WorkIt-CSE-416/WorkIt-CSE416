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

/** The Fill engine this extension ships, as its bundle names itself (fill-engine build.mjs: package.json version + a hash of src/). */
export const ENGINE_VERSION = engine.version;

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
 * The job systems an employer's own domain may host, each with the selector
 * that marks its pages (Workday's career site, SuccessFactors'): the engine's
 * PAGE_MARKS, looked for in the tab, where the engine isn't loaded.
 */
export const PAGE_MARKS = engine.PAGE_MARKS;

/**
 * `url` marked as `site`'s (`ats=<site>`), as the engine reads such a link,
 * or `url` itself where the engine covers it; null where it covers neither.
 * @param {string} url
 * @param {string | null} site
 */
export function markedLink(url, site) {
  return engine.markedLink(url, site);
}

/**
 * The posting's company and title, as the Fill engine reads them from its
 * job system (the panel's job card when WorkIt has no posting for the page).
 * @param {string} url
 */
export function jobNamesOf(url, fetchText = getText) {
  return engine.jobNames(url, fetchText);
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
const WEB_ORIGINS = [DEV_WEB_URL, ...PROD_SITES.map((site) => site.web)].filter(Boolean);
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

// Job systems whose questions only the open form shows: Eightfold's questions API answers only the
// page's own session, Waymo's careers site builds its own form, SmartRecruiters' shows its questions
// a page at a time, and TikTok's and ByteDance's form is behind the site's own sign-in (Workday's and Oracle's
// steps are read on their own, readQuestions).
const READ_OFF_PAGE = new Set(["eightfold", "tiktok", "waymo", "smartrecruiters"]);
const readOffPage = (job) => engine.stepped(job.site) || READ_OFF_PAGE.has(job.site);

/**
 * Whether `url` is a careers site's own sign-in on the way to its form
 * (TikTok's and ByteDance's, `lifeattiktok.com/login?redirect_path=...`),
 * which the student goes through themselves: WorkIt never signs in there.
 * @param {string} url
 */
export function signInFirst(url) {
  const job = jobOf(url);
  // TikTok USDS keeps its pages, sign-in too, under /usds.
  return job?.site === "tiktok" && !job.onForm && /^(\/usds)?\/(login|create-?account|register)\b/i.test(new URL(url).pathname);
}

/** The link to open for an application: its form, where the engine covers the job system. */
export function formUrl(url) {
  return jobOf(url)?.form ?? url;
}

/**
 * The link a batch tab opens, and write-early reads, for an application:
 * `formUrl`, then Greenhouse's embedded form where the job's board shows it
 * on the company's own site (its hosted page sends the student there, the
 * form in an iframe the fill never reaches) or where an embed link lacks its
 * board (the engine's `greenhouseForm`; any other link, or a failed read, is
 * `formUrl`'s).
 * @param {string} url
 * @param {(url: string) => Promise<string>} [fetchText] a GET (the engine asks Greenhouse only GETs)
 */
export async function formFor(url, fetchText = getText) {
  return (await boardForm(url, fetchText)) ?? engine.greenhouseForm(formUrl(url), fetchText);
}

/**
 * Greenhouse's embedded form for a `?gh_jid=` link on a company's own site,
 * when the company's Greenhouse board is named as its site is (stripe.com's
 * is `stripe`) and the Job Board API says the job is shown on that site.
 * Such a link may land on a page with no form at all: Stripe's sends it to
 * the job's description, and the form is a page further, behind Apply
 * (live, 2026-10-28), so the batch tab filled nothing. Any other link, or a
 * failed read, is null, and the link opens as it is (embedded-forms.js).
 * @param {string} url
 * @param {(url: string) => Promise<string>} fetchText
 */
async function boardForm(url, fetchText) {
  let link;
  try {
    link = new URL(url);
  } catch {
    return null;
  }
  const id = link.searchParams.get("gh_jid") ?? "";
  if (jobOf(url) || /(^|\.)greenhouse\.io$/.test(link.hostname) || !/^\d+$/.test(id)) return null;
  const board = link.hostname.split(".").at(-2);
  try {
    const job = JSON.parse(await fetchText(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`));
    if (new URL(job.absolute_url).hostname !== link.hostname) return null;
    return `https://job-boards.greenhouse.io/embed/job_app?for=${board}&token=${id}`;
  } catch {
    return null;
  }
}

async function getText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${new URL(url).hostname} answered ${response.status}`);
  return response.text();
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
 * job?" is WorkIt (a free-text box); a list takes WorkIt, else LinkedIn, in
 * whatever wording it gives them, before the careers site and "Job Board"
 * (Workday's prompt is searched for each in turn). WorkIt lists US roles
 * only, so a question about working abroad is No (us_roles_only).
 */
export const POLICIES = {
  how_heard: { first: ["WorkIt", "LinkedIn"], prefer: ["job board", "other"], text: "WorkIt" },
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
// "Never served" is "I am not a veteran" (the engine's isVeteran reads it as false): it also answers
// "have you ever served?" and a branch or status (N/A); "not a protected veteran" says nothing of service.
const VETERAN = {
  protected_veteran: true, not_protected_veteran: "I am not a protected veteran", not_veteran: "I am not a veteran", declined: "decline",
};
const ORIENTATION = {
  heterosexual: "Heterosexual", gay: "Gay", lesbian: "Lesbian", bisexual: "Bisexual", asexual: "Asexual", queer: "Queer", declined: "decline",
};
// "He/him" fits "He/Him/His" and "He/him/his" alike (the engine takes the shortest option it starts).
const PRONOUNS = { he_him: "He/him", she_her: "She/her", they_them: "They/them", declined: "decline" };
const COMMUNITY = {
  disability: "Person with disability", neurodiverse: "Neurodiverse", veteran: "Veteran", parent: "Parent",
  refugee_immigrant: "Refugee or immigrant", first_generation: "First-generation", lgbtq: "LGBTQ+",
};
const ROLE_INTEREST = {
  backend: "Backend", frontend: "Frontend", full_stack: "Full-Stack", mobile: "Mobile", embedded: "Embedded", ml: "Machine Learning",
  data: "Data", infrastructure: "Infrastructure", security: "Security", robotics: "Robotics",
};
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
  return layered(layered(POLICIES, profile?.fill?.policies), { compensation: pay(profile?.answers ?? {}) });
}

/** Pay as the student answered it (Application answers), never a WorkIt default: their hourly figure,
 * and whether a posting's stated range is fine, which a question asking in words reads as their words. */
function pay(answers) {
  const accepts = yes(answers.accept_posted_pay);
  return present({
    fallback_hourly: typeof answers.expected_hourly_pay === "number" ? answers.expected_hourly_pay : undefined,
    accept_stated_rate: accepts,
    expectation: accepts ? "Open to the posted range" : undefined,
  });
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

/** The bank's skill names, languages first and then the bank's own order (by group, then name), as the
 * engine's rules read a resume's Skills line: "languages most comfortable" ticks the first it names. */
function skillNames(skills) {
  const language = (s) => /language/i.test(s.group ?? "");
  return [...skills.filter(language), ...skills.filter((s) => !language(s))].map((s) => s.name);
}

/** "Undergraduate" or "Graduate" for a degree the student is still in (the engine's degree_level_now); null once finished. */
function levelNow(school) {
  if (!school.degree || school.end_kind === "month") return null;
  const level = engine.degreeLevel(school.degree);
  if (level === "Bachelor's Degree" || level === "Associate's Degree") return "Undergraduate";
  return level === "Master's Degree" || level === "Doctorate" ? "Graduate" : null;
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
 * entry, the earlier ones its past schools; the skills are the bank's, languages first; the jobs are the experience entries, most recently started first. Under all of
 * it lies the engine profile the student brought from Apply
 * (`profile.fill`): WorkIt's own fields win where both hold a value.
 * @param {import("../shared/types.js").AutofillProfile} profile
 */
export function engineProfile(profile, today = new Date().toISOString().slice(0, 10)) {
  return layered(profile.fill?.profile, workitProfile(profile, today));
}

/** A yes/no answer as the engine's boolean; unanswered stays undefined. */
const yes = (answer) => (answer === "yes" ? true : answer === "no" ? false : undefined);

/** "2028-05" as a month count, null when it isn't one. */
function monthIndex(text) {
  const m = /^(\d{4})-(\d{2})/.exec(text ?? "");
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
}

const CLASS_YEARS = ["4th Year Undergrad (Senior)", "3rd Year Undergrad (Junior)", "2nd Year Undergrad (Sophomore)", "1st Year Undergrad (Freshman)"];

/**
 * The school-year facts the latest education entry implies, no new input: an undergraduate's
 * class year this academic year (July to June; a December graduate is a senior that fall), and
 * whether they go back to school after the internship (graduation after its last month: the
 * Application answers' end date, else three months after the start).
 */
function schoolYear(school, answers, today) {
  const graduation = school && school.end_kind !== "present" ? monthIndex(school.end_month) : null;
  if (graduation === null) return {};
  const now = monthIndex(today);
  const classOf = Math.floor(graduation / 12) + (graduation % 12 >= 7 ? 1 : 0);
  const yearEnds = Math.floor(now / 12) + (now % 12 >= 6 ? 1 : 0);
  const start = monthIndex(answers.earliest_start);
  const end = monthIndex(answers.latest_end) ?? (start === null ? null : start + 3);
  return present({
    class_year: levelNow(school) === "Undergraduate" ? CLASS_YEARS[classOf - yearEnds] : undefined,
    returning_to_school_after_internship: end === null ? undefined : graduation > end,
  });
}

/** The Application answers (My Profile's section, KAN-369) as the engine's logistics, home address,
 * languages and screeners. A screener is only ever the student's own answer: an empty list is their "none". */
function applicationFacts(answers, place) {
  const list = (value) => (Array.isArray(value) ? value : undefined);
  return {
    logistics: present({
      onsite_5_days_ok: yes(answers.onsite_ok),
      can_work_full_time_40h: yes(answers.full_time_40h),
      earliest_start_date: answers.earliest_start,
      latest_end_date: answers.latest_end,
      available_terms: list(answers.available_terms),
      willing_to_relocate_for_summer: yes(answers.willing_to_relocate),
      // Ranked, one place an area, as the engine's office rules read them; the city alone too,
      // as offices are often named in full ("Seattle, Washington (Seattle Metro Area)" for "Seattle, WA").
      location_preferences: list(answers.location_preferences)?.map((placeName) =>
        [...new Set([placeName, placeName.split(",")[0].trim()])]),
      referrals: list(answers.referred_at),
    }),
    identity: present({
      home_address: answers.address_line1 || answers.postal_code
        ? present({ line1: answers.address_line1, zip: answers.postal_code, city: place?.city, state: place?.state, country: place?.country })
        : undefined,
      summer_2027_location: answers.internship_location,
      languages: list(answers.languages)?.map((language) => ({ language, spoken: true, written: true })),
    }),
    screeners: present({
      relatives_at: list(answers.relatives_at),
      relative_of_public_official: yes(answers.relative_public_official),
      prior_us_government_employment: yes(answers.prior_government_work),
      non_compete_or_conflicting_agreements: yes(answers.non_compete),
      pending_offers: list(answers.pending_offers),
    }),
  };
}

/** Communities as the engine's list ([] is "none of these"), or "decline" for a student who declined. */
function communities(keys) {
  if (!Array.isArray(keys)) return undefined;
  return keys.includes("declined") ? "decline" : keys.map((k) => COMMUNITY[k]).filter(Boolean);
}

/** How many internships the bank's jobs hold (titled intern or co-op); unknown while it holds no job. */
function internships(jobs) {
  return jobs.length ? jobs.filter((e) => /\bintern(ship)?\b|\bco-?op\b/i.test(e.title ?? "")).length : undefined;
}

/** The company of the job held now, the most recently started first; none held, none named. */
function currentCompany(jobs) {
  return jobs.find((e) => e.end_kind === "present" && e.organization)?.organization;
}

/** The engine profile from WorkIt's own fields alone. */
function workitProfile(profile, today) {
  // The profile's own name parts where it has them, so a middle name never joins the last name.
  const [first, ...rest] = (profile.full_name ?? "").trim().split(/\s+/);
  const named = Boolean(profile.first_name && profile.last_name);
  const entries = profile.bank?.entries ?? [];
  const [school, ...earlier] = latest(entries, "education");
  const skills = skillNames(profile.bank?.skills ?? []);
  const answers = profile.answers ?? {};
  const place = home(profile.location);
  const facts = applicationFacts(answers, place);
  const jobs = newest(entries, "experience");
  return {
    logistics: facts.logistics,
    screeners: facts.screeners,
    identity: present({
      ...facts.identity,
      legal_first_name: (named ? profile.first_name : first) || null,
      legal_middle_name: named ? profile.middle_name || null : null,
      legal_last_name: (named ? profile.last_name : rest.join(" ")) || null,
      email: profile.email, phone: profile.phone_number,
      // Where the student lives, as they typed it (KAN-372), read by the engine; one it can't read is left out.
      current_location: place,
      age_18_or_over: yes(answers.age_18_or_over),
      pronouns: PRONOUNS[answers.pronouns],
      current_company: currentCompany(jobs),
    }),
    links: present({
      linkedin_url: profile.linkedin_url, github_url: profile.github_url, portfolio_url: profile.portfolio_url ?? profile.other_url,
      x_twitter_url: answers.x_url,
    }),
    // The engine's names for the files it plans (rules.ts): the resume and the unofficial transcript (KAN-369).
    files: present({ resume_pdf: profile.resume?.filename, unofficial_transcript_pdf: profile.transcript?.filename }),
    education: school
      ? present({
          school: school.title,
          degree: school.degree ? engine.degreeLevel(school.degree) : null,
          degree_level_now: levelNow(school),
          // As written ("B.S."): the kind a list of kinds (BA, BS) picks by.
          degree_type: school.degree,
          majors: school.field_of_study ? [school.field_of_study] : null,
          gpa_cumulative: school.gpa,
          gpa_scale: school.gpa_scale,
          start_date: school.start_month,
          expected_graduation: school.end_kind === "present" ? null : school.end_month,
          // The earlier schools (a high school among them), as the engine's high-school and degrees-completed rules read them.
          past_schools: earlier.length
            ? earlier.map((e) => present({ school: e.title, degree: e.degree, end: e.end_kind === "present" ? null : e.end_month }))
            : null,
          ...schoolYear(school, answers, today),
        })
      : {},
    experience_facts: present({
      employment_history: jobs.map((e) =>
        present({
          employer: e.organization, title: e.title, start: e.start_month, end: e.end_kind === "present" ? null : e.end_month, location: e.location,
          // A Role Description (Workday's Work Experience) is the job's bullets, one a line, as Apply gives it.
          description: [...(e.bullets ?? [])].sort((a, b) => a.position - b.position).map((b) => b.text).join("\n") || null,
        }),
      ),
      // Workday's "Type to Add Skills" and "languages most comfortable" read these.
      skills: skills.length ? skills : null,
      prior_internships_count: internships(jobs),
      role_interests: Array.isArray(answers.role_interests) ? answers.role_interests.map((k) => ROLE_INTEREST[k]).filter(Boolean) : undefined,
    }),
    work_authorization: present({
      authorized_to_work_us: YES_NO[answers.work_authorized_us],
      requires_sponsorship_now_or_future: YES_NO[answers.needs_sponsorship],
      citizenship: CITIZENSHIP[answers.work_authorization_status],
      // Any country's, for a list of countries of citizenship (two: a dual citizen's, theirs to pick).
      citizenship_countries: Array.isArray(answers.citizenship_countries) && answers.citizenship_countries.length ? answers.citizenship_countries : undefined,
      security_clearance: CLEARANCE[answers.security_clearance],
    }),
    voluntary_self_id: present({
      gender: GENDER[answers.gender],
      hispanic_or_latino: YES_NO_DECLINE[answers.hispanic_latino],
      race: RACE[answers.race],
      veteran: VETERAN[answers.veteran_status],
      disability: YES_NO_DECLINE[answers.disability_status],
      sexual_orientation: ORIENTATION[answers.sexual_orientation],
      transgender: YES_NO_DECLINE[answers.transgender],
      communities: communities(answers.communities),
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
 * its words under the student's name and contact line, named for the student
 * as their resume is ("First_Last_Cover_Letter.pdf", the first name they go
 * by), since the field takes only a file.
 */
export function asUploads(answers, questions, profile) {
  const files = new Set((questions ?? []).filter((q) => q.kind === "file").map((q) => q.name));
  const { identity = {}, links = {} } = engineProfile(profile);
  // The name the student goes by (one brought from Apply), else the legal one, as Apply names its letter.
  const name = [identity.preferred_first_name || identity.legal_first_name, identity.preferred_last_name || identity.legal_last_name];
  const who = name.filter(Boolean).join("_").replace(/[^\p{L}\p{N}_-]+/gu, "_");
  // The letter's header, as the resume's: phone | email | LinkedIn | GitHub.
  const contact = [phoneAsWritten(identity.phone), identity.email, bare(links.linkedin_url), bare(links.github_url)];
  const header = { name: name.filter(Boolean).join(" "), contact: contact.filter(Boolean).join(" | ") };
  return Object.fromEntries(
    Object.entries(answers ?? {}).map(([name, value]) => {
      if (!files.has(name) || typeof value !== "string" || !value.trim()) return [name, value];
      const label = questions.find((q) => q.name === name).label;
      const what = /cover/i.test(label) ? "Cover_Letter" : "Answer";
      return [name, { file: `${who ? `${who}_` : ""}${what}.pdf`, type: "application/pdf", base64: letterPdf(value, header) }];
    }),
  );
}

/** A US phone as a resume writes it, (555) 010-0199; any other as typed. */
function phoneAsWritten(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : phone;
}

/** A link as a resume writes it: linkedin.com/in/someone. */
const bare = (url) => url && String(url).replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");

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
 * (Eightfold's questions API answers only the page's own session, TikTok's
 * form is behind the site's sign-in; Workday
 * shows its questions a step at a time, once the student has signed in;
 * Ashby's query is undocumented, so on any failure its form is read).
 * A stepped job system's (Workday, Oracle: the engine's Stepper seam) also gives the step it is
 * on and the engine's state; Oracle's email gate comes as a step with `gate` and no questions.
 */
async function readQuestions({ job, url, call, fetchText, state }) {
  if (engine.stepped(job.site)) {
    const shown = await call("readQuestions", job.site, state ?? (job.site === "workday" ? { tenant: job.tenant, trees: {} } : {}));
    const step = { name: shown.step, sections: shown.sections, sends: shown.sends, review: shown.review, wentWrong: Boolean(shown.wentWrong), gate: shown.gate ?? null };
    return { questions: shown.questions, step, state: shown.state };
  }
  // Waymo's careers site builds its own form, whose fields only the page names; SmartRecruiters'
  // questions show a page at a time on its one-click form.
  if (READ_OFF_PAGE.has(job.site)) return { questions: await call("readQuestions", job.site) };
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
 * job's page that isn't its form, `openForm`; on a careers site's own
 * sign-in (TikTok's: the engine hands the form to the student, Handoff),
 * `signIn`, the line to show, and nothing is filled. On Workday it is the step
 * shown, with `step` and the engine's `state`.
 * @param {{
 *   url: string, profile: import("../shared/types.js").AutofillProfile, bank?: object | Promise<object> | Function, today: string,
 *   call: (name: string, ...args: unknown[]) => Promise<any>,
 *   fetchText: (url: string, init?: { method: string, body: string }) => Promise<string>,
 *   extra?: object[], state?: object, jobType?: string | null,
 * }} options `jobType`: the queued job's job_type (a batch tab's), which picks the start date the engine answers.
 */
export async function planFill({ url, profile, bank = {}, today, call, fetchText, extra = [], state, jobType = null }) {
  const job = jobOf(url);
  if (!job) return { covered: false };
  const { site } = job;
  if (!job.onForm && !signInFirst(url)) return { covered: true, site, openForm: job.form };
  const fetchOnce = once(fetchText);
  // The job's names and text need no question: asked beside the questions, not after them.
  const reading = readNames(url, fetchOnce);
  let read;
  try {
    read = await readQuestions({ job, url, call, fetchText: fetchOnce, state });
  } catch (error) {
    if (site === "tiktok" && error.name === "Handoff") return { covered: true, site, signIn: error.message };
    throw error;
  }
  const known = new Set(read.questions.map((q) => q.name));
  // Each text field's own limit, as the form on the page sets it (KAN-380): a written answer is checked against it before it is saved.
  const asked = [...read.questions, ...extra.filter((q) => !known.has(q.name))];
  const questions = await optional(() => call("limits", asked), asked);
  const { posting, plan, planFor } = await planQuestions({ job, url, questions, profile, bank, today, fetchText: fetchOnce, jobType, reading });
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
 * Starts asking the job system's public API for what a Plan of `url` will
 * read with `fetchText` (its questions, names and text), before its page is
 * open (plan-reads.js); nothing for a job whose questions only its open form
 * shows (Workday, Eightfold, TikTok, a practice form). Failures are left to the Plan.
 * @returns {boolean} whether anything was asked
 */
export function readJobAhead(url, fetchText) {
  const job = jobOf(url);
  if (!job?.onForm || job.practice || readOffPage(job)) return false;
  optional(() => engine.questionSet(url, fetchText), null);
  readNames(url, fetchText);
  return true;
}

/** The job's company and title and its text, both asked at once; each empty when the job system doesn't say. */
async function readNames(url, fetchText) {
  const [names, html] = await Promise.all([
    optional(() => engine.jobNames(url, fetchText), { company: "", title: "" }),
    optional(() => engine.jobDescription(url, fetchText), ""),
  ]);
  return { names, text: engine.textOf(html) };
}

/**
 * The engine's Plan for a job's questions, with the job's names and text
 * read for it. `bank`: the saved answers this job's form may reuse
 * (GET .../applications/{job}/answer-bank, KAN-379), the engine's Answer bank, which fills a question answered
 * before, and says where it may be reused, or a promise of them (still being fetched while the questions are read);
 * or a function of the page's company that answers them (a form outside a batch, GET .../answer-bank?company=).
 * `reading`: the job's names and text (readNames), when already asked.
 */
async function planQuestions({ job, url, questions, profile, bank, today, fetchText, jobType = null, reading = readNames(url, fetchText) }) {
  const { names, text } = await reading;
  // job_type: WorkIt's own for the job (full_time, internship, ...), unknown outside a batch.
  const posting = { id: String(job.job ?? job.shortcode ?? job.pid ?? url), ...names, url, job_type: jobType };
  bank = typeof bank === "function" ? (questions.length ? await bank(names.company) : {}) : await bank;
  // `planFor`: the same Plan for another profile (the self-identification's probe, KAN-387).
  const planFor = (someone) => engine.plan(questions, engineProfile(someone, today ?? undefined), enginePolicies(someone), bank ?? {}, { posting, today, postingText: text, employerText: text });
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
 * Null when only the open form shows its questions (Workday, Eightfold, TikTok, an
 * Ashby form whose query failed), or the link is no form the engine covers.
 * @param {{ url: string, profile: object, bank?: object, today: string, fetchText: Function, jobType?: string | null }} options
 * @returns {Promise<{ name: string, label: string, required: boolean, max_length: null }[] | null>}
 */
export async function questionsToWrite({ url, profile, bank = {}, today, fetchText, jobType = null }) {
  const job = jobOf(url);
  if (!job || job.practice || readOffPage(job)) return null;
  const fetchOnce = once(fetchText);
  let questions;
  try {
    questions = await engine.questionSet(url, fetchOnce);
  } catch {
    return null;
  }
  const { plan } = await planQuestions({ job, url, questions, profile, bank, today, fetchText: fetchOnce, jobType });
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
 * fill next; a field not filled yet then has no result. `events`: the
 * panel's key for following the fill (content/progress.js, KAN-398): the
 * engine says on the page how each field goes, stops when the student
 * presses Stop autofill (`stopped`, and no result for the fields not
 * reached) and leaves a field the student skipped as "left".
 * @returns {Promise<{ results: Record<string, Result>, more?: object[], state?: object, stopped?: true }>}
 * @typedef {{ status: "filled", shows: string | string[] } | { status: "skipped" | "failed" | "left", reason: string }} Result
 */
export async function fillPage({ call, site, questions, answers, accepted, state, sections, events }) {
  try {
    const filled = await call("fillEach", site, questions, answers, { accepted: accepted ?? {}, state, sections, ...(events ? { events } : {}) });
    return { results: filled.results, ...(filled.moreQuestions ? { more: filled.moreQuestions } : {}), state: filled.state ?? state, ...(filled.stopped ? { stopped: true } : {}) };
  } catch (error) {
    const named = ["FillError", "Handoff", "NoForm"].includes(error.name);
    const reason = named ? error.message : `Fill failed: ${error.message}`;
    // The error's name, and an unnamed one's stack, for a problem report (content/report.js), which takes the values out of both.
    const failed = { status: "failed", reason, error: named ? error.name : "Error", ...(!named && error.stack ? { stack: String(error.stack).slice(0, 4000) } : {}) };
    return { results: Object.fromEntries(Object.keys(answers).map((name) => [name, failed])), state };
  }
}

/**
 * What the overlay lists besides the planned answers, from the Plan:
 * - `written`: questions for the student's Claude to answer (the Plan's
 *   essays, and every one-off draft but a file), each with `max_length`,
 *   its field's own limit as the engine read it from the form (null when it
 *   sets none). A draft that is a choice whose options were read has `kind`
 *   "choice" (a select) or "choices" (a multi-select) and its `options`
 *   (KAN-369), which the connector shows Claude and takes only.
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
  const drafts = plan.drafts ?? [];
  const toClaude = (q) => q.kind !== "file" && !tooManyOptions(q);
  const notes = [...(plan.handoffs ?? [])];
  if (plan.not_eligible) notes.push(`You may not meet this requirement: ${plan.not_eligible}`);
  return {
    written: [
      ...plan.essays.map((q) => ({ ...row(q), max_length: q.maxLength ?? null })),
      ...drafts.filter(toClaude).map((q) => ({ ...row(q), max_length: q.maxLength ?? null, ...choice(q) })),
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
 *   trees?: { load(): Promise<object>, save(saved: object): Promise<void> }, jobType?: string | null }} context
 */
export async function handleFill(message, { url, profile, bank, today, call, fetchText, trees, jobType = null }) {
  const withTrees = async (state) => (state && trees ? { ...state, trees: { ...state.trees, ...(await trees.load()) } } : state);
  const keep = async (state) => {
    if (state?.saved && trees && Object.keys(state.saved).length) await trees.save(state.saved);
    return state;
  };
  let answer;
  if (message.type === "fill/plan") {
    let state = message.state;
    if (!state && trees && jobOf(url)?.site === "workday") state = { tenant: jobOf(url).tenant, trees: {} };
    answer = await planFill({ url, profile, bank, today, call, fetchText, extra: message.extra, state: await withTrees(state), jobType });
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
  } else if (message.type === "fill/next") {
    // A form in pages the extension moves through itself (SmartRecruiters): the engine presses Next, never Submit.
    return { step: await call("next", jobOf(url)?.site, message.step) };
  } else if (message.type === "fill/required") {
    // The fields the form won't send without that show nothing, the planned and the unplanned alike
    // (Greenhouse's phone country, required once Phone shows a number, is in no Question set as required),
    // and the required fields the Question set lacks altogether (Ashby, Eightfold), given back as
    // `unasked` questions so the tab reads them again after each edit.
    const unasked = engine.stepped(message.site) ? [] : await call("unaskedQuestions", message.site, message.questions);
    return { empty: await call("emptyRequired", message.site, [...message.questions, ...unasked], message.state), unasked };
  } else {
    throw new Error(`Unknown fill message: ${message.type}`);
  }
  await keep(answer.state);
  return answer;
}
