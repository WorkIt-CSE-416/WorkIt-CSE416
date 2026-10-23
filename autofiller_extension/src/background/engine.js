// The extension's side of the Fill engine (the fill-engine submodule, KAN-329):
// which job systems it covers, the WorkIt profile mapped to the engine's
// profile, the Question set fetched and planned, and one field filled at a
// time. The engine itself runs in the application's page (the page's MAIN
// world, ENGINE_FILES); this module reaches it through `call`, which the
// background makes with chrome.scripting.executeScript and the test with
// Playwright's page.evaluate, both running `runEngine` in the page.
//
// No chrome.* API is used at import time, so the extension's test imports
// this file as it is.

// Greenhouse's Job Board API: a job's questions, and the lists its education dropdowns offer.
const GREENHOUSE_API = "https://boards-api.greenhouse.io/v1/boards";
const GREENHOUSE_EDUCATION = "https://boards.greenhouse.io/v1/boards";

/**
 * The job system and job an application page belongs to, when the engine
 * covers it; null on any other page, which the extension leaves alone.
 * Greenhouse only, for now: its hosted form (job-boards. or boards.) and its
 * embedded form (`embed/job_app?for=<board>&token=<job>`).
 * @param {string} url
 * @returns {{ site: "greenhouse", board: string, job: string } | null}
 */
export function jobOf(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)greenhouse\.io$/.test(parsed.hostname)) return null;
  const hosted = /^\/([\w-]+)\/jobs\/(\d+)/.exec(parsed.pathname);
  if (hosted) return { site: "greenhouse", board: hosted[1], job: hosted[2] };
  const board = parsed.searchParams.get("for");
  const job = parsed.searchParams.get("token");
  if (parsed.pathname.startsWith("/embed/job_app") && board && /^\d+$/.test(job ?? "")) return { site: "greenhouse", board, job };
  return null;
}

/**
 * Runs in the application's page, so it reads nothing outside itself: calls
 * `FillEngine[name](...args)` (a dotted name reaches a nested one) and
 * returns `{ value }`, or `{ error: { name, message } }`, since an error
 * thrown in the page loses its name on the way back.
 * @param {{ name: string, args: unknown[] }} request
 */
export async function runEngine({ name, args }) {
  try {
    if (typeof globalThis.FillEngine === "undefined") throw new Error("The fill engine is not loaded in this page");
    const path = name.split(".");
    const owner = path.slice(0, -1).reduce((scope, key) => scope[key], globalThis.FillEngine);
    return { value: await owner[path.at(-1)](...args) };
  } catch (error) {
    return { error: { name: error?.name ?? "Error", message: String(error?.message ?? error) } };
  }
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

/** A free-text degree ("B.S.", "Bachelor of Science") in the words the engine's rules match a form's options with. */
function degreeWords(degree) {
  if (!degree) return undefined;
  const d = degree.toLowerCase().replace(/\./g, "");
  if (/bachelor|^b ?(s|a|eng|sc)\b/.test(d)) return "Bachelor's Degree";
  if (/master|^m ?(s|a|eng|sc|ba)\b/.test(d)) return "Master's Degree";
  if (/doctor|^phd\b/.test(d)) return "Doctorate";
  if (/associate|^a ?(s|a)\b/.test(d)) return "Associate's Degree";
  return degree;
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
          degree: degreeWords(school.degree),
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

/** The text of HTML the Job Board API sends escaped ("&lt;p&gt;"), a line per block, as the page shows it. */
function postingText(html) {
  return unescapeHtml(unescapeHtml(html ?? "").replace(/<[^>]+>/g, "\n"));
}

function unescapeHtml(text) {
  const named = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };
  return (text ?? "").replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, ref) => {
    if (ref[0] !== "#") return named[ref.toLowerCase()] ?? whole;
    return String.fromCodePoint(ref[1].toLowerCase() === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10));
  });
}

/** One of Greenhouse's education lists (degrees or disciplines), read page by page. */
async function educationList(fetchText, board, kind) {
  const items = [];
  for (let page = 1; page < 50; page++) {
    const listed = JSON.parse(await fetchText(`${GREENHOUSE_EDUCATION}/${board}/education/${kind}?page=${page}`));
    items.push(...listed.items.map((item) => item.text));
    if (!listed.items.length || items.length >= listed.meta.total_count) break;
  }
  return items;
}

/**
 * Everything the fill needs, before anything is filled: the job's Question
 * set (from the job system's API and the posting page as served, read by
 * the engine), and the engine's Plan
 * for the WorkIt profile, with file answers holding their bytes. On a page
 * the engine doesn't cover, `{ covered: false }` and nothing is fetched.
 * @param {{
 *   url: string, profile: import("../shared/types.js").AutofillProfile, today: string,
 *   call: (name: string, ...args: unknown[]) => Promise<any>, fetchText: (url: string) => Promise<string>,
 * }} options
 */
export async function planFill({ url, profile, today, call, fetchText }) {
  const found = jobOf(url);
  if (!found) return { covered: false };
  const { site, board, job: jobId } = found;
  const source = await fetchText(`${GREENHOUSE_API}/${board}/jobs/${jobId}?questions=true`);
  const job = JSON.parse(source);
  let questions = await call("parseQuestions", site, source);
  if (["education_required", "education_optional"].includes(job.education)) {
    const degrees = await educationList(fetchText, board, "degrees");
    const disciplines = await educationList(fetchText, board, "disciplines");
    // The page as served: once Greenhouse's app starts, the page no longer holds its education_config.
    const page = await fetchText(url);
    questions = [...questions, ...(await call("greenhouseQuestions.education", page, degrees, disciplines))];
  }
  const posting = { id: String(job.id ?? jobId), company: job.company_name ?? "", title: job.title ?? "", url };
  const description = postingText(job.content);
  const plan = await call("plan", questions, engineProfile(profile), POLICIES, {}, { posting, today, postingText: description, employerText: description });
  return { covered: true, site, posting, questions, plan, answers: withFiles(plan.answers, profile) };
}

/** The order the planned answers are filled in: the Plan's (the form's) order, files last, since an uploader may not be ready at first. */
export function fillOrder({ questions, answers }) {
  const isFile = (name) => questions.find((q) => q.name === name)?.kind === "file";
  const names = Object.keys(answers);
  return [...names.filter((n) => !isFile(n)), ...names.filter(isFile)];
}

/**
 * Fills one planned answer through the engine and says how it went, as the
 * overlay shows it: "filled" with what the field shows now, "skipped" when
 * the form never showed the field (it depends on another answer), or
 * "failed" with the engine's reason.
 * @returns {Promise<{ status: "filled", shows: string | string[] } | { status: "skipped" | "failed", reason: string }>}
 */
export async function fieldResult(call, { site, questions }, name, value) {
  let readback;
  try {
    readback = await call("fill", site, questions, { [name]: value });
  } catch (error) {
    return { status: "failed", reason: error.name === "FillError" ? error.message.replace(/^[^:]+: /, "") : `Fill failed: ${error.message}` };
  }
  const shows = readback?.[name];
  if (shows === undefined || shows === "" || (Array.isArray(shows) && shows.length === 0)) {
    return { status: "skipped", reason: "The form didn't show this question" };
  }
  return { status: "filled", shows };
}

/**
 * What the overlay lists besides the planned answers, from the Plan:
 * - `written`: questions that need a written answer (the Plan's essays, and
 *   its drafts that take text). Each waits for the student's one Generate
 *   click, then goes to the essay-answer route.
 * - `yours`: questions WorkIt has no answer for (Missing facts, and drafts
 *   that are a choice, which a written answer can't make).
 * - `notes`: what the Plan leaves to the student and why (an AI trap or ban,
 *   a video), and a screener the student would not pass.
 * A form that bans AI-written text never has `written`: the Plan hands its
 * essays off instead, so nothing AI-written goes where it is banned.
 * @returns {{ written: Row[], yours: Row[], notes: string[] }}
 * @typedef {{ name: string, label: string, required: boolean }} Row
 */
export function planRows({ plan }) {
  const row = (q) => ({ name: q.name, label: q.label, required: q.required });
  const takesText = (q) => q.kind === "text" || q.kind === "textarea";
  const drafts = plan.drafts ?? [];
  const notes = [...(plan.handoffs ?? [])];
  if (plan.not_eligible) notes.push(`You may not meet this requirement: ${plan.not_eligible}`);
  return {
    written: [...plan.essays, ...drafts.filter(takesText)].map(row),
    yours: [...plan.missing, ...drafts.filter((q) => !takesText(q))].map(row),
    notes,
  };
}
