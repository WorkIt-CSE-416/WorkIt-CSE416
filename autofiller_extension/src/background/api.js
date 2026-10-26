// Client for WorkIt's own FastAPI backend. Most calls here reuse an
// endpoint that already exists for the webapp (backend/app/routers/auth.py,
// profiles.py, bank.py, preferences.py, autofill_answers.py, auto_apply.py,
// documents.py)
// — straight from the extension's background service worker instead of a
// Server Action. Two routes are new, built for this extension specifically
// because no existing one was safe/usable from here: essay-answer
// generation (no way to hold a model key client-side) and
// getResumeFileBytes (a signed Storage URL lives outside this extension's
// host_permissions and Storage's own CORS policy proved unreliable from a
// chrome-extension:// origin — see that function's own doc comment).
//
// That only works because MV3 background workers bypass CORS for origins
// listed in manifest.json's host_permissions — the backend needed zero
// changes for this to work. If that assumption turns out wrong on first
// real test (see autofiller_extension/CLAUDE.md's Open Items), enabling
// CORS on the FastAPI app for this extension's origin is the fallback.

import { DEV_API_URL, PROD_SITES } from "../shared/config.js";
import { getSession } from "./auth.js";

const CACHE_KEY = "workit_autofill_profile";
// Re-fetch after this long even on a cache hit, so a profile edit made in
// the webapp shows up here without an explicit "refresh" click.
const CACHE_TTL_MS = 10 * 60 * 1000;
// A profile older than CACHE_TTL_MS but younger than this is used while a fresh one is fetched.
const STALE_OK_MS = 24 * 60 * 60 * 1000;
/** The profile fetch under way, if any (getAutofillProfile): its callers share it. */
let fetching = null;

/** Resolved once per service-worker lifetime, not on every call. */
let devApiReachable = null;

async function reachable(url) {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Dev backend if it's actually running locally, otherwise the deployed API
 * paired with the webapp origin the session came from (a dev session, or
 * an unknown origin, falls back to the first PROD_SITES entry).
 * @param {import("../shared/types.js").Session} session
 */
async function apiUrl(session) {
  devApiReachable ??= await reachable(DEV_API_URL);
  if (devApiReachable) return DEV_API_URL;
  const site = PROD_SITES.find((s) => s.web === session.web_origin) ?? PROD_SITES[0];
  return site.api;
}

class ApiError extends Error {
  /** @param {number} status */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * The authenticated fetch both apiFetch and apiFetchBinary below share:
 * session check, base URL resolution, the Bearer header, and turning a
 * non-2xx response into an ApiError. Returns the raw Response so each
 * caller decides how to read the body — `.json()` for every other endpoint
 * in this file, `.arrayBuffer()` for the one that returns a file
 * (getResumeFileBytes).
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function apiRequest(path, init = {}) {
  const session = await getSession();
  if (!session) throw new ApiError(401, "Not signed in");

  const base = await apiUrl(session);
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new ApiError(response.status, errorMessage(response.status, body));
    // A refusal's reasons by question (the paste route's 422, savePastedAnswer), when the route gives them.
    error.reasons = body?.detail?.reasons;
    throw error;
  }
  return response;
}

/**
 * An error answer's words: the route's own `detail`, or for a body FastAPI
 * refused (a 422 with a list of errors) each error's `msg`, never "[object Object]"
 * or a bare status code.
 * @param {number} status
 * @param {{ detail?: string | { msg?: string }[] }} body
 */
export function errorMessage(status, body) {
  const { detail } = body ?? {};
  if (typeof detail === "string" && detail) return detail;
  if (typeof detail?.message === "string" && detail.message) return detail.message;
  if (Array.isArray(detail) && detail.length) return detail.map((e) => e?.msg ?? String(e)).join("; ");
  // No words from the route: a plain sentence, never the status code (KAN-401); the status stays on ApiError.
  return "WorkIt's server couldn't do that just now.";
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function apiFetch(path, init = {}) {
  const response = await apiRequest(path, init);
  return response.json();
}

/**
 * Same as apiFetch, but for an endpoint that returns a file's bytes rather
 * than JSON (getResumeFileBytes below) — only ever called from this API's
 * own origin, which `manifest.json`'s host_permissions already covers, so
 * (unlike a signed Storage URL) this needs no assumption about a third
 * party's CORS policy.
 * @param {string} path
 */
async function apiFetchBinary(path) {
  const response = await apiRequest(path);
  return response.arrayBuffer();
}

// Who is signed in, kept a short while per session token (a batch asked it
// before nearly every call, a round trip each): a new token (another sign-in)
// or none (signed out) asks again, as does a refused token.
const ME_TTL_MS = 60 * 1000;
/** @type {{ token: string, at: number, account: Promise<any> } | null} */
let account = null;

/** GET /auth/me — also how the popup checks "am I actually signed in". */
async function me() {
  const session = await getSession();
  if (!session) {
    account = null;
    throw new ApiError(401, "Not signed in");
  }
  if (account?.token === session.access_token && Date.now() - account.at < ME_TTL_MS) return account.account;
  const asked = { token: session.access_token, at: Date.now(), account: apiFetch("/auth/me") };
  account = asked;
  asked.account.catch(() => {
    if (account === asked) account = null;
  });
  return asked.account;
}

async function getApplicantProfile(applicantId) {
  return apiFetch(`/applicants/${applicantId}/profile`);
}

/**
 * The Fill engine's own profile and policies for the student
 * (backend/app/routers/profiles.py's get_fill_profile): what they brought
 * from Apply, `{ profile, policies }`, both empty objects when nothing was.
 * engine.js lays WorkIt's own fields over them.
 */
async function getFillProfile(applicantId) {
  return apiFetch(`/applicants/${applicantId}/fill-profile`);
}

/**
 * The experience bank (backend/app/schemas/bank.py's BankResponse): entries
 * and skills, never an uploaded resume's parsed_json. Same rule the
 * recommender and Scout follow (KAN-212, backend/CLAUDE.md): the bank, not
 * a resume, is the source of truth for what the student has done.
 */
async function getBank(applicantId) {
  return apiFetch(`/applicants/${applicantId}/bank`);
}

/**
 * The onboarding "Visa Sponsorship" job-search filter
 * (backend/app/schemas/preferences.py's JobPreferences.visa) — "which
 * postings do I want to see", not a work-authorization status. Read here
 * only as a fallback for fetchAutofillProfile's merge below, for a student
 * who hasn't done onboarding's Profile step (KAN-283) yet. Never 404s: an
 * applicant who hasn't saved preferences gets one back with every field
 * empty/null.
 */
async function getPreferences(applicantId) {
  return apiFetch(`/applicants/${applicantId}/preferences`);
}

/**
 * The student's saved answers to the questions hiring systems repeat on
 * every application (KAN-283, backend/app/schemas/autofill_answers.py):
 * work authorization, sponsorship, citizenship/visa status, security
 * clearance, and the voluntary gender/veteran/disability
 * self-identification. Never 404s: every key comes back null until
 * onboarding's Profile step (or My Profile) saves one.
 */
async function getAutofillAnswers(applicantId) {
  return apiFetch(`/applicants/${applicantId}/autofill-answers`);
}

/**
 * The applicant's uploaded resume files (backend/app/routers/resumes.py's
 * list_resumes): id, original_filename, is_default, among other fields.
 * Read here only to find the one (if any) My Profile calls the default —
 * see resolveResumeFile below.
 */
async function getResumes(applicantId) {
  return apiFetch(`/applicants/${applicantId}/resumes`);
}

/**
 * One uploaded resume's actual file bytes, from this API's own origin
 * (backend/app/routers/resumes.py's get_resume_file_bytes) — not the
 * signed-Storage-URL `.../file` endpoint the webapp's preview link uses,
 * because that URL lives on Storage's own domain, which this extension's
 * `manifest.json` host_permissions doesn't cover: a background-worker
 * fetch to it is subject to whatever CORS policy that bucket happens to
 * have, confirmed inconsistent in practice (passed a manual live check
 * from the webapp's own origin, see autofiller_extension/CLAUDE.md, but
 * the resume still didn't attach from inside the loaded extension — most
 * likely because a chrome-extension:// origin isn't the one Storage's
 * actual CORS config allows). This endpoint needs no such assumption: it's
 * this API's own origin, already trusted.
 */
async function getResumeFileBytes(applicantId, resumeId) {
  return apiFetchBinary(`/applicants/${applicantId}/resumes/${resumeId}/bytes`);
}

/**
 * The applicant's built (generated or tailored) resumes
 * (backend/app/routers/built_resumes.py's list_built_resumes) — same
 * `is_default` shape as getResumes, for a student who used WorkIt's resume
 * builder instead of uploading a file. `default_resume_id` (an upload) and
 * `default_built_resume_id` (one of these) are never both set
 * (backend/app/models/CLAUDE.md, "Built resumes"), so at most one of
 * getResumes/getBuiltResumes ever has an `is_default` row.
 */
async function getBuiltResumes(applicantId) {
  return apiFetch(`/applicants/${applicantId}/built-resumes`);
}

/**
 * Renders one built resume to a PDF, base64-encoded right in the response
 * (backend/app/routers/built_resumes.py's render_pdf, `RenderResponse.pdf`)
 * — no separate Storage fetch needed, unlike an uploaded resume above.
 */
async function getBuiltResumeRender(applicantId, resumeId) {
  return apiFetch(`/applicants/${applicantId}/built-resumes/${resumeId}/render`);
}

/**
 * `btoa(String.fromCharCode(...bytes))` blows the call stack on anything
 * past a few tens of KB, which a real resume PDF already exceeds — chunk it.
 * @param {ArrayBuffer} buffer
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const RESUME_MIME_TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** An uploaded resume (a GET .../resumes row) as the file the engine attaches, its bytes from this API's own origin. */
async function uploadedResumeFile(applicantId, row) {
  const buffer = await getResumeFileBytes(applicantId, row.id);
  const ext = (row.original_filename?.split(".").pop() || "pdf").toLowerCase();
  return {
    filename: row.original_filename || `resume.${ext}`,
    mimeType: RESUME_MIME_TYPES[ext] ?? "application/octet-stream",
    base64: arrayBufferToBase64(buffer),
    uploaded_resume_id: row.id,
  };
}

/** A built resume (a GET .../built-resumes row) as the file the engine attaches: its PDF, rendered. */
async function builtResumeFile(applicantId, row) {
  const rendered = await getBuiltResumeRender(applicantId, row.id);
  return { filename: `${row.name || "Resume"}.pdf`, mimeType: "application/pdf", base64: rendered.pdf, built_resume_id: row.id };
}

/**
 * Whichever resume My Profile calls the student's default — resolved all
 * the way to file bytes here, at profile-fetch time, rather than left as a
 * pointer for later. An uploaded resume now comes through this API's own
 * `.../bytes` route (getResumeFileBytes above), never a signed Storage URL:
 * that URL lives on Storage's own domain, outside this extension's
 * `host_permissions`, and a live loaded-extension test showed the resume
 * still wasn't attaching through it even though a manual cross-origin
 * fetch from the webapp's own tab succeeded — most likely because
 * Storage's actual CORS policy allows the webapp's origin specifically,
 * not a `chrome-extension://` one. Routing through this API's own origin
 * sidesteps that question entirely.
 *
 * Best-effort and non-fatal by design, same principle as `inferredAnswers`
 * below: a student with no resume at all, or any fetch failure along the
 * way, reads the same to the rest of the extension — "nothing to attach" —
 * rather than failing the whole profile load over one optional field.
 * @param {string} applicantId
 * Each file names the resume it came from (`uploaded_resume_id` or
 * `built_resume_id`), so a sent application can say which one went out.
 * @returns {Promise<{ filename: string, mimeType: string, base64: string, uploaded_resume_id?: string, built_resume_id?: string } | null>}
 */
async function resolveResumeFile(applicantId) {
  try {
    const uploaded = await getResumes(applicantId);
    const defaultUpload = uploaded.find((r) => r.is_default);
    if (defaultUpload) return await uploadedResumeFile(applicantId, defaultUpload);

    const built = await getBuiltResumes(applicantId);
    const defaultBuilt = built.find((r) => r.is_default);
    if (defaultBuilt) return await builtResumeFile(applicantId, defaultBuilt);

    // Neither list had an is_default row — a real "no resume" case, not a
    // failure, but logged anyway: silent here and a thrown error below were
    // indistinguishable from the console until this line existed, which is
    // exactly what made a live "why is this skipped" report undebuggable.
    console.warn("resolveResumeFile: no default resume found", {
      uploadedCount: uploaded.length,
      builtCount: built.length,
    });
    return null;
  } catch (error) {
    console.warn("resolveResumeFile: failed to resolve a resume file", error);
    return null;
  }
}

/**
 * The student's unofficial transcript (backend/app/routers/documents.py,
 * KAN-369), as file bytes, for a form's transcript upload: null when they
 * have none, or on any failure (best effort, like the resume). Named apart
 * from the resume when both files share a name, since a planned file is
 * matched to its bytes by name (engine.js's withFiles).
 * @param {string} applicantId
 * @param {Promise<{ filename: string } | null>} resume the resume being resolved (resolveResumeFile, which never rejects)
 * @returns {Promise<{ filename: string, mimeType: string, base64: string } | null>}
 */
async function resolveTranscriptFile(applicantId, resume) {
  try {
    const documents = await apiFetch(`/applicants/${applicantId}/documents`);
    const transcript = documents.find((d) => d.kind === "transcript");
    if (!transcript) return null;
    const buffer = await apiFetchBinary(`/applicants/${applicantId}/documents/transcript/bytes`);
    const ext = (transcript.original_filename?.split(".").pop() || "pdf").toLowerCase();
    const name = transcript.original_filename || `transcript.${ext}`;
    return {
      filename: name === (await resume)?.filename ? `Transcript_${name}` : name,
      mimeType: RESUME_MIME_TYPES[ext] ?? "application/octet-stream",
      base64: arrayBufferToBase64(buffer),
    };
  } catch (error) {
    console.warn("resolveTranscriptFile: failed to fetch the transcript", error);
    return null;
  }
}

/**
 * Before KAN-283 built a real answer bank, this file inferred
 * work_authorized_us/needs_sponsorship from the job-search visa filter —
 * the only visa-adjacent fact WorkIt had. That filter only ever supports
 * two confident inferences: "I Don't Need One" (`null`) means authorized
 * and no sponsorship needed; "Sponsors Visas" (`"sponsors"`) means
 * sponsorship will be needed (it says nothing about current work
 * authorization — an OPT/CPT student can be both, so that one is left
 * unanswered). Kept only as a fallback below, for a student who saved this
 * filter but hasn't answered KAN-283's real questions yet; a real saved
 * answer always wins.
 * @param {"sponsors" | null} visa
 */
function inferredAnswers(visa) {
  return {
    work_authorized_us: visa === null || visa === undefined ? "yes" : null,
    needs_sponsorship: visa === "sponsors" ? "yes" : visa === null || visa === undefined ? "no" : null,
  };
}

/**
 * Combines four existing endpoints into the one shape the content script
 * fills a page from. Not persisted server-side anywhere — this assembly
 * only ever exists in the extension's own cache.
 * @returns {Promise<import("../shared/types.js").AutofillProfile>}
 */
async function fetchAutofillProfile() {
  const account = await me();
  if (account.account_type !== "applicant") {
    throw new Error("WorkIt Autofiller is for applicant accounts. Signed in as a company account.");
  }

  // The parts are asked at once: none needs another's answer (the transcript only the resume's name, once both are in).
  const resuming = resolveResumeFile(account.id);
  const [profile, bank, preferences, answers, resume, transcript, fill] = await Promise.all([
    getApplicantProfile(account.id),
    getBank(account.id),
    getPreferences(account.id),
    getAutofillAnswers(account.id),
    resuming,
    resolveTranscriptFile(account.id, resuming),
    // Best effort, like the resume: without it the fill uses WorkIt's fields alone.
    getFillProfile(account.id).catch(() => null),
  ]);
  const fallback = inferredAnswers(preferences.visa);
  // A real saved answer always wins; the job-search filter only fills the
  // two questions it can confidently speak to, and only while they're
  // still unanswered for real.
  const mergedAnswers = {
    ...answers,
    work_authorized_us: answers.work_authorized_us ?? fallback.work_authorized_us,
    needs_sponsorship: answers.needs_sponsorship ?? fallback.needs_sponsorship,
  };

  return {
    id: account.id,
    // The contact email employers see; empty means the sign-in email (KAN-262).
    email: profile.contact_email || account.email,
    full_name: account.full_name,
    first_name: profile.first_name ?? null,
    middle_name: profile.middle_name ?? null,
    last_name: profile.last_name ?? null,
    phone_number: profile.phone_number,
    headline: profile.headline,
    location: profile.location ?? null,
    linkedin_url: profile.linkedin_url,
    portfolio_url: profile.portfolio_url,
    github_url: profile.github_url,
    other_url: profile.other_url,
    bank: bank.entries.length > 0 ? bank : null,
    answers: mergedAnswers,
    resume,
    transcript,
    fill,
    fetched_at: Date.now(),
  };
}

/**
 * The function everything else calls. Cache-first, with a background
 * refresh once the TTL has passed — callers always get an answer from
 * storage first (fast, works offline-ish), and the next call sees fresher
 * data if it changed server-side.
 *
 * Checks for a live session before trusting a cache hit, now that signing
 * out happens entirely on the webapp's side, outside this file's view:
 * without this check, a user who signs out of WorkIt would keep seeing
 * their last-cached profile here for up to CACHE_TTL_MS, since the cached
 * branch never used to call anything that would notice. One extra
 * chrome.storage read (getSession, below) is cheap insurance against
 * autofilling a stale, signed-out identity.
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<import("../shared/types.js").AutofillProfile>}
 */
export async function getAutofillProfile({ force = false } = {}) {
  const session = await getSession();
  if (!session) throw new ApiError(401, "Not signed in");

  const { [CACHE_KEY]: cached } = await chrome.storage.local.get(CACHE_KEY);
  const age = cached ? Date.now() - cached.fetched_at : Infinity;
  if (!force && age < CACHE_TTL_MS) return cached;
  // Past its ten minutes but under a day old: used at once, and fetched again behind (a cold API
  // took 4-9 s to answer, live), so the next call has the fresh one. Older ones are waited for, as is
  // one of another account's (a sign-in as someone else; `me` is one call, kept a minute).
  if (!force && age < STALE_OK_MS && (await me()).id === cached.id) {
    if (!fetching) refetch().catch((error) => console.warn("[profile] not fetched again:", error.message));
    return cached;
  }

  // A fetch already under way (write early's, another tab's Plan) is waited for, not asked again;
  // a forced one starts afresh, since it may follow an edit the one under way began before.
  if (!force && fetching) return fetching;
  return refetch();
}

/** Fetches the profile and caches it; callers meanwhile share it (`fetching`). */
async function refetch() {
  const run = fetchAutofillProfile().then(async (fresh) => {
    await chrome.storage.local.set({ [CACHE_KEY]: fresh });
    return fresh;
  });
  fetching = run;
  try {
    return await run;
  } finally {
    if (fetching === run) fetching = null;
  }
}

/**
 * Starts the profile fetch, and so wakes a cold API, before anything waits
 * for it: as a batch starts and as the panel opens, so a tab's Plan finds it
 * in hand. Never throws; a signed-out student simply fetches nothing.
 */
export function warmProfile() {
  getAutofillProfile().catch(() => {});
}

/**
 * GET .../applications/next — the oldest queued application whose job
 * posting is open (its `job.form_url`, else `job.apply_url`, is the page
 * to open), past the jobs in `skip` (those batch apply has opened), or
 * null when none is left.
 * @param {string} applicantId
 * @param {string[]} [skip]
 */
export async function nextApplication(applicantId, skip = []) {
  const query = new URLSearchParams(skip.map((id) => ["skip", id])).toString();
  return apiFetch(`/applicants/${applicantId}/applications/next${query ? `?${query}` : ""}`);
}

/**
 * PUT .../applications/{job_id}/fill — how a batch tab's fill left the form:
 * "needs_you" moves the application to needs_you, "ready" back to queued.
 * @param {string} applicantId
 * @param {string} jobId
 * @param {"ready" | "needs_you"} state
 */
export async function recordFill(applicantId, jobId, state) {
  return apiFetch(`/applicants/${applicantId}/applications/${jobId}/fill`, { method: "PUT", body: JSON.stringify({ state }) });
}

/**
 * POST /fill-reports — a problem report the student sent from the panel
 * (KAN-403, background report.js): the job system, posting link, engine
 * version, each failed field's kind, label shape and error name, and their
 * note. Never an answer or the page's text.
 * @param {{ job_system: string, posting_url: string, engine_version: string,
 *   fields: { kind: string, label_shape: string, error: string }[], note: string | null }} report
 */
export async function sendFillReport(report) {
  return apiFetch("/fill-reports", { method: "POST", body: JSON.stringify(report) });
}

/**
 * PUT .../applications/{job_id}/questions — the questions a batch tab's form
 * needs written (KAN-377), for the student's own Claude to answer through
 * the connector. Answers every question the application has, with any
 * answer saved so far.
 * @param {string} applicantId
 * @param {string} jobId
 * @param {{ name: string, label: string, required: boolean, max_length: number | null }[]} questions
 */
export async function askQuestions(applicantId, jobId, questions) {
  return apiFetch(`/applicants/${applicantId}/applications/${jobId}/questions`, { method: "PUT", body: JSON.stringify({ questions }) });
}

/**
 * GET .../applications/{job_id}/questions — those questions, each with the
 * `answer` the student's Claude saved, or null.
 * @param {string} applicantId
 * @param {string} jobId
 */
export async function writtenAnswers(applicantId, jobId) {
  return apiFetch(`/applicants/${applicantId}/applications/${jobId}/questions`);
}

/**
 * GET .../applications?stage=queued — the student's queued applications,
 * newest first, each with its job posting's listing (`job.form_url`, else
 * `job.apply_url`, is its form), for reading their questions early (KAN-379).
 * @param {string} applicantId
 */
export async function queuedApplications(applicantId) {
  return apiFetch(`/applicants/${applicantId}/applications?stage=queued`);
}

/**
 * GET .../applications?scored=true — every application, newest first, each
 * with its job posting's listing, its stage and `applied_at`, and `match`:
 * the Jobs page's Match score (null for a closed posting or an empty
 * experience bank). The panel's job card (KAN-395, panel-top.js).
 * @param {string} applicantId
 */
export async function scoredApplications(applicantId) {
  return apiFetch(`/applicants/${applicantId}/applications?scored=true`);
}

/**
 * GET .../applications/{job_id}/answer-bank — the answers saved on the
 * student's other applications that this one's form may reuse,
 * `{[question wording]: {answer, own}}`: the Fill engine's Answer bank for
 * its Plan (KAN-379). Never an answer about another company.
 * @param {string} applicantId
 * @param {string} jobId
 * @returns {Promise<Record<string, { answer: string, own: boolean }>>}
 */
export async function answerBank(applicantId, jobId) {
  return apiFetch(`/applicants/${applicantId}/applications/${jobId}/answer-bank`);
}

/**
 * GET .../answer-bank?company= — the same for a form filled outside a batch,
 * which has no application: every saved answer it may reuse, one about a
 * company only when `company` (the page's, if read) is that company.
 * @param {string} applicantId
 * @param {string} [company]
 * @returns {Promise<Record<string, { answer: string, own: boolean }>>}
 */
export async function anyFormAnswerBank(applicantId, company) {
  const query = company ? `?company=${encodeURIComponent(company.slice(0, 200))}` : "";
  return apiFetch(`/applicants/${applicantId}/answer-bank${query}`);
}

/**
 * PUT .../applications/{job_id}/answers — the student's own words for one of
 * a batch tab's questions that need writing (KAN-379): kept as the
 * application's answer, and saved for every later form that asks it.
 * @param {string} applicantId
 * @param {string} jobId
 * @param {{ name: string, label: string, answer: string }} answer
 */
export async function saveOwnAnswer(applicantId, jobId, answer) {
  return apiFetch(`/applicants/${applicantId}/applications/${jobId}/answers`, { method: "PUT", body: JSON.stringify(answer) });
}

/**
 * DELETE .../applications/{job_id}/answers?name= — Undo on the guess card
 * (KAN-369, card-guess.js): takes back the answer the student saved for
 * question `name`, so later forms no longer fill it.
 * @param {string} applicantId
 * @param {string} jobId
 * @param {string} name
 */
export async function dropOwnAnswer(applicantId, jobId, name) {
  await apiRequest(`/applicants/${applicantId}/applications/${jobId}/answers?name=${encodeURIComponent(name)}`, { method: "DELETE" });
}

/**
 * POST .../applications/{job_id}/review/keep|rewrite — the flag card's answer
 * to a question the pre-submit review flagged (KAN-369): keep it as it
 * stands, or send it back to the student's Claude to write again.
 * @param {string} applicantId
 * @param {string} jobId
 * @param {"keep" | "rewrite"} action
 * @param {string} name
 */
export async function answerFlag(applicantId, jobId, action, name) {
  await apiRequest(`/applicants/${applicantId}/applications/${jobId}/review/${action}`, { method: "POST", body: JSON.stringify({ name }) });
}

/**
 * PUT .../applications/{job_id}/written-answers — an answer the student
 * pasted in a waiting row's card (KAN-369), saved as the Written Answers
 * page saves one (KAN-385): checked as their Claude's, saved by="student",
 * not as their own words. A refusal is an ApiError 422 whose `reasons`
 * names each question's reasons.
 * @param {string} applicantId
 * @param {string} jobId
 * @param {string} name
 * @param {string} answer
 * @returns {Promise<{ saved: number, left: number }>}
 */
export async function savePastedAnswer(applicantId, jobId, name, answer) {
  return apiFetch(`/applicants/${applicantId}/applications/${jobId}/written-answers`, { method: "PUT", body: JSON.stringify({ answers: [{ name, answer }] }) });
}

/**
 * PUT .../applications/{job_id}/resume — keeps the resume an application
 * went out with as its sent resume (the route's `built_resume_id` or
 * `uploaded_resume_id`, from the profile's resume file).
 * @param {string} applicantId
 * @param {string} jobId
 * @param {{ uploaded_resume_id: string } | { built_resume_id: string }} resume
 */
export async function recordSentResume(applicantId, jobId, resume) {
  return apiFetch(`/applicants/${applicantId}/applications/${jobId}/resume`, { method: "PUT", body: JSON.stringify(resume) });
}

/**
 * POST .../applications/{job_id}/finish — how an application ended:
 * "submitted" marks it applied, "skipped" (the student pressed Skip) skipped.
 * @param {string} applicantId
 * @param {string} jobId
 * @param {"submitted" | "skipped" | "failed"} outcome
 */
/**
 * POST /jobs/saved-by-link: saves the feed's job whose apply link is the
 * page at `url` (the popup's Save to WorkIt on a site WorkIt can't fill, KAN-401).
 * @param {string} url
 * @returns {Promise<{ job_id: string, stage: string }>}
 */
export async function saveJobByLink(url) {
  return apiFetch("/jobs/saved-by-link", { method: "POST", body: JSON.stringify({ url }) });
}

/**
 * POST .../finish: the application's outcome. "unsubmitted" also takes the
 * tab's `state` before the mark ("ready" → queued, "needs_you" → needs_you).
 */
export async function finishApplication(applicantId, jobId, outcome, state = undefined) {
  return apiFetch(`/applicants/${applicantId}/applications/${jobId}/finish`, { method: "POST", body: JSON.stringify(state ? { outcome, state } : { outcome }) });
}

/**
 * GET .../connector — whether the student's Claude holds a live sign-in to
 * WorkIt's connector (`{ added }`, KAN-387).
 * @param {string} applicantId
 */
export async function connectorAdded(applicantId) {
  return (await apiFetch(`/applicants/${applicantId}/connector`)).added;
}

/**
 * DELETE .../connector — revokes the student's Claude's sign-in to WorkIt at
 * once (the webapp's Settings > Connected Apps Disconnect; the panel's
 * settings, KAN-402). Answers 204, no body.
 * @param {string} applicantId
 */
export async function disconnectConnector(applicantId) {
  await apiRequest(`/applicants/${applicantId}/connector`, { method: "DELETE" });
}

/**
 * GET .../writing-samples — the student's writing samples (`samples`, KAN-384).
 * @param {string} applicantId
 */
export async function writingSamples(applicantId) {
  return (await apiFetch(`/applicants/${applicantId}/writing-samples`)).samples;
}

/**
 * PATCH .../autofill-answers — saves the answers `changed` names and keeps
 * the rest (the self-identification a form first asked, KAN-387).
 * @param {string} applicantId
 * @param {Record<string, string>} changed
 */
export async function saveAutofillAnswers(applicantId, changed) {
  return apiFetch(`/applicants/${applicantId}/autofill-answers`, { method: "PATCH", body: JSON.stringify(changed) });
}

/**
 * POST .../essay-answer — a drafted answer to one open-ended application
 * question, grounded in the applicant's experience bank. Never looked up
 * against a stored job posting: `question`/`companyName`/`jobTitle` are
 * read straight off the ATS page's own DOM by content-script.js, since the
 * posting may not be one WorkIt has scraped or a company has posted here.
 * Throws `ApiError` (429 at today's limit, 503 if the model's down, 422 if
 * the draft isn't grounded in the bank) the same as every other call here —
 * background.js's existing message wrapper turns that into `{ ok: false,
 * error, status }` with no new handling needed.
 * @param {string} applicantId
 * @param {{ question: string, companyName: string | null, jobTitle: string | null, maxLength: number | null }} options
 */
export async function generateEssayAnswer(applicantId, { question, companyName, jobTitle, maxLength }) {
  return apiFetch(`/applicants/${applicantId}/essay-answer`, {
    method: "POST",
    body: JSON.stringify({
      question,
      company_name: companyName,
      job_title: jobTitle,
      max_length: maxLength,
    }),
  });
}

/**
 * GET .../built-resumes/{id}/keyword-match?job_posting_id= — the Keyword
 * match of one built resume against one job posting (`matched`, `missing`,
 * required keywords first). A posting read for the first time spends one of
 * today's Tailor uses (backend/app/routers/built_resumes.py).
 * @param {string} applicantId
 * @param {string} resumeId
 * @param {string} jobId
 */
export async function keywordMatch(applicantId, resumeId, jobId) {
  return apiFetch(`/applicants/${applicantId}/built-resumes/${resumeId}/keyword-match?job_posting_id=${encodeURIComponent(jobId)}`);
}

export { ApiError, me, getResumes as uploadedResumes, getBuiltResumes as builtResumes, uploadedResumeFile, builtResumeFile };
