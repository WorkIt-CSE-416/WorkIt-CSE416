// JSDoc-only — no TypeScript build step in this prototype, so these typedefs
// are the shared contract between background/content/popup instead of a
// compiler-checked one. Keep them in sync with what they describe by hand.

/**
 * @typedef {Object} Session
 * @property {string} access_token
 * @property {string} refresh_token
 * @property {number} expires_at  Unix seconds
 */

/**
 * One parsed education/experience/etc. entry. Shape matches
 * backend/app/models/dto.py's ParsedResume sub-models exactly — this is the
 * same JSON GET /applicants/{id}/resumes/{resume_id} returns as parsed_json,
 * not a shape invented here.
 * @typedef {Object} ParsedResume
 * @property {Array<{institution: string, degree?: string, field_of_study?: string, gpa?: number, start_date?: string, end_date?: string, description?: string}>} education
 * @property {Array<{company_name: string, title: string, location?: string, start_date?: string, end_date?: string, description?: string}>} experience
 * @property {Array<{skill_name: string, category?: string}>} skills
 * @property {Array<{project_name: string, url?: string, start_date?: string, end_date?: string, description?: string}>} projects
 * @property {Array<{cert_name: string, issuer?: string}>} certifications
 */

/**
 * The one object the content script actually fills a page from. Assembled
 * in src/background/api.js by combining three existing WorkIt endpoints
 * (GET /auth/me, GET /applicants/{id}/profile, GET
 * /applicants/{id}/resumes/{default resume id}) — nothing here is new data,
 * it's a read-only reshaping of what WorkIt's own database already holds.
 * @typedef {Object} AutofillProfile
 * @property {string} id
 * @property {string} email  The profile's contact email, else the sign-in
 *   email: the one employers see (KAN-262).
 * @property {string} full_name
 * @property {string | null} phone_number
 * @property {string | null} headline
 * @property {string | null} linkedin_url
 * @property {string | null} portfolio_url
 * @property {string | null} github_url
 * @property {string | null} other_url
 * @property {ParsedResume | null} resume  null when the applicant has no
 *   default resume yet — the popup should say so rather than the content
 *   script silently filling nothing.
 * @property {number} fetched_at  Unix ms, for cache-staleness decisions.
 */

/**
 * "skipped" is an optional field with nothing to fill it from — distinct
 * from "failed", which only ever means a required field that couldn't be
 * filled. This split is the direct fix for JobRight's Minor(s) bug: an
 * empty optional field is a non-event, not a red flag.
 * @typedef {"pending" | "filled" | "failed" | "skipped"} FieldStatus
 */

/**
 * One row in the on-page status overlay — the four-state tracker from the
 * JobRight research, fixed to roll sub-fields up honestly (see
 * src/content/lib-status.js's own docs).
 * @typedef {Object} FieldResult
 * @property {string} key           Stable id, e.g. "email" or "education[0].institution"
 * @property {string} label         What the overlay shows, e.g. "Email"
 * @property {boolean} required     From the form field itself (aria-required /
 *   required / a visible asterisk), never assumed — this is JobRight's
 *   "Minor(s) flagged red though not required" bug, fixed at the source.
 * @property {FieldStatus} status
 * @property {string} [reason]      Shown on hover when status is "failed" —
 *   e.g. "No matching option for \"SUNY Korea\""
 */
