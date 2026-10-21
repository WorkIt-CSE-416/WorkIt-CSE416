// Client for WorkIt's own FastAPI backend. Most calls here reuse an
// endpoint that already exists for the webapp (backend/app/routers/auth.py,
// profiles.py, bank.py, preferences.py, autofill_answers.py, auto_apply.py)
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

import { DEV_API_URL, PROD_API_URL } from "../shared/config.js";
import { getSession } from "./auth.js";

const CACHE_KEY = "workit_autofill_profile";
// Re-fetch after this long even on a cache hit, so a profile edit made in
// the webapp shows up here without an explicit "refresh" click.
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Resolved once per service-worker lifetime, not on every call. */
let resolvedApiUrl = null;

async function reachable(url) {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Dev backend if it's actually running locally, otherwise the deployed one. */
async function apiUrl() {
  if (resolvedApiUrl) return resolvedApiUrl;
  resolvedApiUrl = (await reachable(DEV_API_URL)) ? DEV_API_URL : PROD_API_URL;
  return resolvedApiUrl;
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

  const base = await apiUrl();
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
    throw new ApiError(response.status, body.detail ?? `Request failed (${response.status})`);
  }
  return response;
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

/** GET /auth/me — also how the popup checks "am I actually signed in". */
async function me() {
  return apiFetch("/auth/me");
}

async function getApplicantProfile(applicantId) {
  return apiFetch(`/applicants/${applicantId}/profile`);
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
 * @returns {Promise<{ filename: string, mimeType: string, base64: string } | null>}
 */
async function resolveResumeFile(applicantId) {
  try {
    const uploaded = await getResumes(applicantId);
    const defaultUpload = uploaded.find((r) => r.is_default);
    if (defaultUpload) {
      const buffer = await getResumeFileBytes(applicantId, defaultUpload.id);
      const ext = (defaultUpload.original_filename?.split(".").pop() || "pdf").toLowerCase();
      return {
        filename: defaultUpload.original_filename || `resume.${ext}`,
        mimeType: RESUME_MIME_TYPES[ext] ?? "application/octet-stream",
        base64: arrayBufferToBase64(buffer),
      };
    }

    const built = await getBuiltResumes(applicantId);
    const defaultBuilt = built.find((r) => r.is_default);
    if (defaultBuilt) {
      const rendered = await getBuiltResumeRender(applicantId, defaultBuilt.id);
      return {
        filename: `${defaultBuilt.name || "Resume"}.pdf`,
        mimeType: "application/pdf",
        base64: rendered.pdf,
      };
    }

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

  const profile = await getApplicantProfile(account.id);
  const bank = await getBank(account.id);
  const preferences = await getPreferences(account.id);
  const answers = await getAutofillAnswers(account.id);
  const resume = await resolveResumeFile(account.id);
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
    phone_number: profile.phone_number,
    headline: profile.headline,
    linkedin_url: profile.linkedin_url,
    portfolio_url: profile.portfolio_url,
    github_url: profile.github_url,
    other_url: profile.other_url,
    bank: bank.entries.length > 0 ? bank : null,
    answers: mergedAnswers,
    resume,
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
  if (cached && !force && Date.now() - cached.fetched_at < CACHE_TTL_MS) {
    return cached;
  }

  const fresh = await fetchAutofillProfile();
  await chrome.storage.local.set({ [CACHE_KEY]: fresh });
  return fresh;
}

/**
 * GET .../applications/next — the oldest queued application whose job
 * posting is open (its `job.apply_url` is the page to open), or null when
 * the queue is empty.
 * @param {string} applicantId
 */
export async function nextApplication(applicantId) {
  return apiFetch(`/applicants/${applicantId}/applications/next`);
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

export { ApiError, me };
