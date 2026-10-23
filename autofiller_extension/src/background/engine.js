// The extension's side of the Fill engine (the fill-engine submodule, KAN-329):
// which job systems it covers, the WorkIt profile mapped to the engine's
// profile, the Question set fetched and planned, and the planned answers
// filled a field (or a group of fields) at a time. The engine itself runs in
// the application's page (the page's MAIN world, ENGINE_FILES); this module
// reaches it through `call`, which the background makes with
// chrome.scripting.executeScript and the test with Playwright's
// page.evaluate, both running `runEngine` in the page.
//
// No chrome.* API is used at import time, so the extension's test imports
// this file as it is.

// The job systems' public APIs a Question set or a posting's text is read from (no sign-in).
const GREENHOUSE_API = "https://boards-api.greenhouse.io/v1/boards";
const GREENHOUSE_EDUCATION = "https://boards.greenhouse.io/v1/boards";
const LEVER_API = "https://api.lever.co/v0/postings";
const ASHBY_GRAPHQL = "https://jobs.ashbyhq.com/api/non-user-graphql";
const RIPPLING_API = "https://ats.rippling.com/api/v1/board";
const WORKABLE_API = "https://apply.workable.com/api";
// The query Ashby's own hosted page reads a posting's form with (undocumented, no login), as Apply asks it.
const ASHBY_POSTING = [
  "query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {",
  " jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {",
  " id title descriptionHtml shouldAskForTextingConsent shouldAskForWhatsAppConsent legalEntityNameForTextingConsent",
  " applicationForm { sections { fieldEntries { ... on FormFieldEntry { id isRequired descriptionHtml field } } } }",
  " surveyForms { sections { fieldEntries { ... on FormFieldEntry { id isRequired descriptionHtml field } } } } } }",
].join("");
const ASHBY_ORGANIZATION = [
  "query ApiOrganizationFromHostedJobsPageName($organizationHostedJobsPageName: String!) {",
  " organization: organizationFromHostedJobsPageName(organizationHostedJobsPageName: $organizationHostedJobsPageName) { name } }",
].join("");
// Eightfold careers sites whose company their host doesn't name.
const EIGHTFOLD_COMPANIES = { "explore.jobs.netflix.net": "Netflix" };

/**
 * The job system and job an application page belongs to, when the engine
 * covers it; null on any other page, which the extension leaves alone.
 * `form` is the link of the job's application form, and `onForm` whether this
 * page is it: a Lever, Ashby, Rippling, Workable or Eightfold posting shows
 * the job on one page and its form on another. A Greenhouse posting holds its
 * form; Workday's form comes after its own Apply button and sign-in.
 * @param {string} url
 * @returns {{ site: string, form: string, onForm: boolean, [id: string]: string | boolean } | null}
 */
export function jobOf(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const { hostname: host, pathname: path, origin } = parsed;
  const query = (name) => parsed.searchParams.get(name);
  const at = (form, onForm, ids) => ({ ...ids, form, onForm });
  let m;
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    // Its hosted form (job-boards. or boards.) and its embedded form (`embed/job_app?for=<board>&token=<job>`).
    if ((m = /^\/([\w-]+)\/jobs\/(\d+)/.exec(path))) return at(url, true, { site: "greenhouse", board: m[1], job: m[2] });
    if (path.startsWith("/embed/job_app") && query("for") && /^\d+$/.test(query("token") ?? "")) {
      return at(url, true, { site: "greenhouse", board: query("for"), job: query("token") });
    }
    return null;
  }
  if (/(^|\.)lever\.co$/.test(host) && (m = /^\/([^/]+)\/([0-9a-f-]{36})(\/apply)?\/?$/.exec(path))) {
    return at(`${origin}/${m[1]}/${m[2]}/apply`, Boolean(m[3]), { site: "lever", company: m[1], job: m[2] });
  }
  if (host === "jobs.ashbyhq.com" && (m = /^\/([^/]+)\/([0-9a-f-]{36})(\/application)?\/?$/.exec(path))) {
    return at(`${origin}/${m[1]}/${m[2]}/application`, Boolean(m[3]), { site: "ashby", board: m[1], job: m[2] });
  }
  if (host === "ats.rippling.com" && (m = /^(\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/]+)\/jobs\/([0-9a-f-]{36}))(\/apply)?\/?$/.exec(path))) {
    return at(`${origin}${m[1]}/apply?step=application`, Boolean(m[4]), { site: "rippling", board: m[2], job: m[3] });
  }
  if (host === "apply.workable.com" && (m = /^\/([^/]+)\/j\/([0-9A-Z]+)(\/apply)?\/?$/.exec(path))) {
    return at(`${origin}/${m[1]}/j/${m[2]}/apply`, Boolean(m[3]), { site: "workable", account: m[1], shortcode: m[2] });
  }
  if (/(^|\.)eightfold\.ai$/.test(host) || host in EIGHTFOLD_COMPANIES) {
    const pid = /^\/careers\/job\/(\d+)/.exec(path)?.[1] ?? query("pid");
    if (pid && /^\d+$/.test(pid)) return at(`${origin}/careers/apply?pid=${pid}`, path.startsWith("/careers/apply"), { site: "eightfold", pid });
    return null;
  }
  if (/(^|\.)(myworkdayjobs|myworkdaysite)\.com$/.test(host)) return at(url, true, { site: "workday", tenant: workdayTenant(parsed) });
  return null;
}

/** The Workday tenant an application belongs to, which the engine keeps its nested prompts for: the host, or the tenant's path on myworkdaysite.com. */
function workdayTenant({ hostname, pathname }) {
  if (!hostname.endsWith("myworkdaysite.com")) return hostname;
  const path = pathname.split("/").filter(Boolean);
  return `${hostname}/${path.includes("recruiting") ? path[path.indexOf("recruiting") + 1] : path[0]}`;
}

/** The link to open for an application: its form, where the engine covers the job system. */
export function formUrl(url) {
  return jobOf(url)?.form ?? url;
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

/** What `read` gives back, or `fallback` when it fails: for what only names the job (company, title, its text), never the questions. */
async function optional(read, fallback) {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

const json = (text) => JSON.parse(text);
const oneLine = (text) => (text ?? "").replace(/\s+/g, " ").trim();
const post = (body) => ({ method: "POST", body: JSON.stringify(body) });

/**
 * Each job system's Question set and posting, read as Apply reads them: from
 * the job system's public API where it has one (the engine parses what was
 * fetched), else from the open form (Eightfold's questions API answers only
 * the page's own session; Workday shows its questions a step at a time, once
 * the student has signed in). Each gives `{ questions, posting, text }`
 * (text: the posting's own words, which the plan reads for AI bans and pay);
 * Workday's also the step it is on and the engine's state.
 */
const READERS = {
  async greenhouse({ job, url, call, fetchText }) {
    const source = await fetchText(`${GREENHOUSE_API}/${job.board}/jobs/${job.job}?questions=true`);
    const answer = json(source);
    let questions = await call("parseQuestions", "greenhouse", source);
    if (["education_required", "education_optional"].includes(answer.education)) {
      const degrees = await educationList(fetchText, job.board, "degrees");
      const disciplines = await educationList(fetchText, job.board, "disciplines");
      // The page as served: once Greenhouse's app starts, the page no longer holds its education_config.
      const page = await fetchText(url);
      questions = [...questions, ...(await call("greenhouseQuestions.education", page, degrees, disciplines))];
    }
    const posting = { id: String(answer.id ?? job.job), company: answer.company_name ?? "", title: answer.title ?? "" };
    return { questions, posting, text: postingText(answer.content) };
  },

  async lever({ job, call, fetchText }) {
    const html = await fetchText(job.form);
    const [company, title] = (/<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? "").split(" - ").map((part) => oneLine(unescapeHtml(part)));
    const text = await optional(async () => {
      const posting = json(await fetchText(`${LEVER_API}/${job.company}/${job.job}`));
      const lists = (posting.lists ?? []).map((list) => `<h3>${list.text ?? ""}</h3>${list.content ?? ""}`).join("");
      return postingText(`${posting.description ?? ""}${lists}${posting.additional ?? ""}`);
    }, "");
    return { questions: await call("parseQuestions", "lever", html), posting: { id: job.job, company: company ?? "", title: title ?? "" }, text };
  },

  async ashby({ job, call, fetchText }) {
    const variables = { organizationHostedJobsPageName: job.board, jobPostingId: job.job };
    let questions;
    let posting = {};
    try {
      const source = await fetchText(`${ASHBY_GRAPHQL}?op=ApiJobPosting`, post({ operationName: "ApiJobPosting", variables, query: ASHBY_POSTING }));
      questions = await call("parseQuestions", "ashby", source);
      posting = json(source).data.jobPosting;
    } catch {
      // The query is undocumented: on any failure, the questions as the form on the page shows them.
      questions = await call("readQuestions", "ashby");
    }
    const company = await optional(async () => {
      const answer = await fetchText(`${ASHBY_GRAPHQL}?op=ApiOrganizationFromHostedJobsPageName`, post({
        operationName: "ApiOrganizationFromHostedJobsPageName", variables: { organizationHostedJobsPageName: job.board }, query: ASHBY_ORGANIZATION,
      }));
      return json(answer).data.organization.name;
    }, "");
    return { questions, posting: { id: job.job, company, title: posting.title ?? "" }, text: postingText(posting.descriptionHtml) };
  },

  async rippling({ job, call, fetchText }) {
    const source = await fetchText(`${RIPPLING_API}/${job.board}/jobs/${job.job}`);
    const answer = json(source);
    const description = answer.description ?? {};
    return {
      questions: await call("parseQuestions", "rippling", source),
      posting: { id: job.job, company: oneLine(answer.companyName), title: oneLine(answer.name) },
      text: postingText([description.company, description.role].filter(Boolean).join("\n")),
    };
  },

  async workable({ job, call, fetchText }) {
    const source = await fetchText(`${WORKABLE_API}/v1/jobs/${job.shortcode}/form`);
    const posting = await optional(async () => json(await fetchText(`${WORKABLE_API}/v2/accounts/${job.account}/jobs/${job.shortcode}`)), {});
    const account = await optional(async () => json(await fetchText(`${WORKABLE_API}/v1/accounts/${job.account}`)), {});
    return {
      questions: await call("parseQuestions", "workable", source),
      posting: { id: job.shortcode, company: account.name ?? "", title: posting.title ?? "" },
      text: postingText(["description", "requirements", "benefits"].map((part) => posting[part] ?? "").join("\n")),
    };
  },

  async eightfold({ job, url, call, fetchText }) {
    const { host } = new URL(url);
    const posting = await optional(async () => json(await fetchText(`https://${host}/api/apply/v2/jobs/${job.pid}`)), {});
    const company = EIGHTFOLD_COMPANIES[host] ?? host.split(".")[0].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      questions: await call("readQuestions", "eightfold"),
      posting: { id: job.pid, company, title: oneLine(posting.name) },
      text: postingText(posting.job_description),
    };
  },

  async workday({ job, url, call, fetchText, state }) {
    const shown = await call("readQuestions", "workday", state ?? { tenant: job.tenant, trees: {} });
    const posting = await optional(async () => json(await fetchText(workdayJobApi(url))), {});
    const info = posting.jobPostingInfo ?? {};
    return {
      questions: shown.questions,
      // Workday names a legal entity, not the company ("02 CACI, INC.-FEDERAL", live): its leading code is dropped.
      posting: { id: info.jobReqId ?? "", company: oneLine(posting.hiringOrganization?.name).replace(/^\d+\s+/, ""), title: oneLine(info.title) },
      text: postingText(info.jobDescription),
      step: { name: shown.step, sections: shown.sections, sends: shown.sends, review: shown.review, wentWrong: Boolean(shown.wentWrong) },
      state: shown.state,
    };
  },
};

/** The JSON a Workday job page loads (Workday's CXS API, public): `<tenant>.wdN.myworkdayjobs.com/[<locale>/]<site>/job/...`, or `myworkdaysite.com/recruiting/<tenant>/<site>/job/...`. */
function workdayJobApi(url) {
  const { origin, hostname, pathname } = new URL(url);
  const path = pathname.split("/").filter(Boolean);
  const job = path.indexOf("job");
  if (job < 0) throw new Error("not a Workday job's page");
  const board = path.includes("recruiting") ? path.slice(path.indexOf("recruiting") + 1, job) : [hostname.split(".")[0], path[job - 1]];
  const rest = path.slice(job);
  const apply = rest.findIndex((part) => part.startsWith("apply"));
  return `${origin}/wday/cxs/${[...board, ...(apply < 0 ? rest : rest.slice(0, apply))].join("/")}`;
}

/**
 * Everything a fill needs, before anything is filled: the job's Question set
 * (with `extra`, the questions earlier fills brought on), and the engine's
 * Plan for the WorkIt profile, with file answers holding their bytes, cut
 * into the units it is filled in (`fillUnits`) and the rows the overlay lists
 * besides (`planRows`). On a page the engine doesn't cover, `{ covered: false }`
 * and nothing is fetched; on a job's page that isn't its form, `openForm`.
 * On Workday it is the step shown, with `step` and the engine's `state`.
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
  const read = await READERS[site]({ job, url, call, fetchText, state });
  const known = new Set(read.questions.map((q) => q.name));
  const questions = [...read.questions, ...extra.filter((q) => !known.has(q.name))];
  const posting = { ...read.posting, url };
  const plan = questions.length
    ? await call("plan", questions, engineProfile(profile), POLICIES, {}, { posting, today, postingText: read.text, employerText: read.text })
    : { answers: {}, essays: [], drafts: [], missing: [], handoffs: [] };
  const answers = withFiles(plan.answers, profile);
  const prepared = { covered: true, site, posting, questions, plan, answers, applicantId: profile.id, step: read.step, state: read.state };
  return { ...prepared, units: fillUnits(prepared), rows: planRows(prepared) };
}

/**
 * The planned answers cut into the engine calls that fill them, in order: a
 * field per call, so the overlay shows each field's own result and one field
 * the engine can't fill doesn't stop the rest, except where the engine fills
 * fields together:
 * - Files first, as the engine's own fill does: Lever, Rippling, Eightfold and
 *   Workable parse the résumé into the form, over anything already typed.
 *   Greenhouse's last: its uploader may not be ready at first.
 * - Workable in one call: its fill adds the Education and Experience entries
 *   first, and blanks every text box it isn't given (what Workable typed in
 *   itself, such as a guessed address).
 * - Workday's repeating sections in one call first: they add the panels whose
 *   fields the step then asks.
 * @returns {string[][]}
 */
export function fillUnits({ site, questions, answers, step }) {
  const names = questions.map((q) => q.name).filter((name) => name in answers);
  if (site === "workable") return names.length ? [names] : [];
  const isFile = (name) => questions.find((q) => q.name === name)?.kind === "file";
  if (site === "workday") {
    const sections = names.filter((name) => step?.sections?.includes(name));
    return [...(sections.length ? [sections] : []), ...names.filter((name) => !sections.includes(name)).map((name) => [name])];
  }
  const files = names.filter(isFile).map((name) => [name]);
  const fields = names.filter((name) => !isFile(name)).map((name) => [name]);
  return site === "greenhouse" ? [...fields, ...files] : [...files, ...fields];
}

/**
 * Fills one unit of planned answers through the engine and says how each went,
 * as the overlay shows it: "filled" with what the field shows now, "skipped"
 * when the form never showed the field (it depends on another answer), or
 * "failed" with the engine's reason. `more`: questions the fill brought on
 * (Eightfold's follow-ups, Workday's new panels and follow-ups), to plan and
 * fill next; a field Workday hasn't filled yet then has no result.
 * @returns {Promise<{ results: Record<string, Result>, more?: object[], state?: object }>}
 * @typedef {{ status: "filled", shows: string | string[] } | { status: "skipped" | "failed", reason: string }} Result
 */
export async function fillUnit({ call, site, questions, names, answers, state }) {
  const given = Object.fromEntries(names.map((name) => [name, answers[name]]));
  const steps = site === "workday" ? [state] : [];
  let filled;
  try {
    filled = await call("fill", site, questions, given, ...steps);
  } catch (error) {
    const reason = error.name === "FillError" || error.name === "Handoff" ? error.message.replace(/^[^:]+: /, "") : `Fill failed: ${error.message}`;
    return { results: Object.fromEntries(names.map((name) => [name, { status: "failed", reason }])), state };
  }
  if (site === "workday") {
    state = filled.state;
    filled = filled.moreQuestions ? { moreQuestions: filled.moreQuestions } : filled.readback;
  }
  if (filled?.moreQuestions) {
    // Eightfold brings questions on once a field is filled; Workday says so before it fills anything.
    const shown = site === "workday" ? {} : await call("readback", site, questions, names);
    const results = Object.fromEntries(names.filter((name) => !blank(shown[name])).map((name) => [name, { status: "filled", shows: shown[name] }]));
    return { results, more: filled.moreQuestions, state };
  }
  const results = Object.fromEntries(names.map((name) => [name, blank(filled?.[name])
    ? { status: "skipped", reason: "The form didn't show this question" }
    : { status: "filled", shows: filled[name] }]));
  return { results, state };
}

const blank = (shows) => shows === undefined || shows === "" || (Array.isArray(shows) && shows.length === 0);

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

/**
 * The content script's two fill messages, as the background answers them:
 * `fill/plan` (planFill, for the page at `url`) and `fill/unit` (fillUnit).
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
  } else if (message.type === "fill/unit") {
    answer = await fillUnit({ call, ...message, state: await withTrees(message.state) });
  } else {
    throw new Error(`Unknown fill message: ${message.type}`);
  }
  await keep(answer.state);
  return answer;
}
