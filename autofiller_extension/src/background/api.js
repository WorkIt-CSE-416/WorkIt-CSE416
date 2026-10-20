// Client for WorkIt's own FastAPI backend. Every call here reuses an
// endpoint that already exists for the webapp (backend/app/routers/auth.py,
// profiles.py, resumes.py, auto_apply.py) — this file adds no new backend
// surface, it just calls the same ones the Next.js server already calls,
// straight from the extension's background service worker instead of a
// Server Action.
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
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function apiFetch(path, init = {}) {
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
  return response.json();
}

/** GET /auth/me — also how the popup checks "am I actually signed in". */
async function me() {
  return apiFetch("/auth/me");
}

async function getApplicantProfile(applicantId) {
  return apiFetch(`/applicants/${applicantId}/profile`);
}

async function listResumes(applicantId) {
  return apiFetch(`/applicants/${applicantId}/resumes`);
}

async function getResume(applicantId, resumeId) {
  return apiFetch(`/applicants/${applicantId}/resumes/${resumeId}`);
}

/**
 * Combines three existing endpoints into the one shape the content script
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
  const resumes = await listResumes(account.id);
  const defaultResume = resumes.find((r) => r.is_default) ?? resumes[0] ?? null;
  const resume = defaultResume ? await getResume(account.id, defaultResume.id) : null;

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
    resume: resume?.parsed_json ?? null,
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

export { ApiError, me };
