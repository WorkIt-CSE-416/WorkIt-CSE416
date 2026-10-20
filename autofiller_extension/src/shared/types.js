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
 * One experience-bank entry. Shape matches backend/app/schemas/bank.py's
 * EntryResponse exactly — this is the same JSON GET /applicants/{id}/bank
 * returns in `entries`, not a shape invented here. `title` and
 * `organization` mean different things per `section` (GLOSSARY.md /
 * frontend/src/app/(seeker)/bank/sections.ts's SECTIONS): for "education",
 * `title` is the school and `organization` is the college or department;
 * for "experience", `title` is the job title and `organization` is the
 * company.
 * @typedef {Object} BankEntry
 * @property {string} id
 * @property {"education"|"experience"|"projects"|"leadership"|"awards"|"certifications"} section
 * @property {string} title
 * @property {string | null} organization
 * @property {string | null} location
 * @property {string | null} start_month  "YYYY-MM"
 * @property {string | null} end_month  "YYYY-MM"
 * @property {"month"|"present"|"expected" | null} end_kind
 * @property {string | null} degree
 * @property {string | null} field_of_study
 * @property {number | null} gpa
 * @property {number | null} gpa_scale
 * @property {string[]} coursework
 * @property {string | null} honors
 * @property {string | null} link
 * @property {string | null} issuer
 * @property {string | null} award_date  "YYYY-MM"
 * @property {Array<{id: string, position: number, text: string}>} bullets
 */

/**
 * One experience-bank skill. Matches backend/app/schemas/bank.py's
 * SkillResponse.
 * @typedef {Object} BankSkill
 * @property {string} id
 * @property {string} name
 * @property {string | null} group
 */

/**
 * The whole experience bank, as GET /applicants/{id}/bank returns it.
 * @typedef {Object} Bank
 * @property {BankEntry[]} entries
 * @property {BankSkill[]} skills
 */

/**
 * The one object the content script actually fills a page from. Assembled
 * in src/background/api.js by combining two existing WorkIt endpoints
 * (GET /auth/me, GET /applicants/{id}/profile) with the experience bank
 * (GET /applicants/{id}/bank) — nothing here is new data, it's a read-only
 * reshaping of what WorkIt's own database already holds.
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
 * @property {Bank | null} bank  null when the applicant's experience bank
 *   has no entries yet — the popup should say so rather than the content
 *   script silently filling nothing.
 * @property {"sponsors" | "not_ruled_out" | null} visa  The onboarding
 *   "Visa Sponsorship" pick (backend/app/schemas/preferences.py's
 *   JobPreferences.visa, GET /applicants/{id}/preferences) — a job-search
 *   filter ("which postings do I want to see"), not a work-authorization
 *   status field; WorkIt stores no such field. field-map.js reads it as the
 *   best available signal for a posting's own "are you authorized to work"/
 *   "will you need sponsorship" questions.
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
