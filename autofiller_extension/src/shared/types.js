// JSDoc-only — no TypeScript build step in this prototype, so these typedefs
// are the shared contract between background/content/popup instead of a
// compiler-checked one. Keep them in sync with what they describe by hand.

/**
 * @typedef {Object} Session
 * @property {string} access_token
 * @property {string} refresh_token
 * @property {number} expires_at  Unix seconds
 * @property {string} web_origin  the webapp origin the cookie was read from
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
 * The nine questions hiring systems repeat on every application (KAN-283).
 * Shape matches backend/app/schemas/autofill_answers.py's AutofillAnswers
 * exactly — the same JSON GET /applicants/{id}/autofill-answers returns,
 * each value one of the option keys `frontend/src/lib/autofill-answers.ts`
 * defines (never the label shown on screen; background/engine.js maps each to the
 * words the Fill engine's rules read). `work_authorized_us` and `needs_sponsorship` are filled
 * in by background/api.js's fetchAutofillProfile when they're still
 * unanswered here, inferred from the onboarding "Visa Sponsorship"
 * job-search filter — a real saved answer always wins over that inference.
 * Hispanic or Latino and race are two separate questions (KAN-299), not one
 * combined "race/ethnicity" — `hispanic_latino` is its own yes/no/decline,
 * `race` one of the EEO-1 categories.
 * @typedef {Object} AutofillAnswers
 * @property {"yes" | "no" | null} work_authorized_us
 * @property {"yes" | "no" | null} needs_sponsorship
 * @property {"us_citizen" | "permanent_resident" | "f1_student" | "h1b" | "other_visa" | "asylee_refugee" | null} work_authorization_status
 * @property {"none" | "public_trust" | "confidential" | "secret" | "top_secret" | "ts_sci" | null} security_clearance
 * @property {"male" | "female" | "non_binary" | "declined" | null} gender
 * @property {"yes" | "no" | "declined" | null} hispanic_latino
 * @property {"american_indian_alaska_native" | "asian" | "black_african_american" | "native_hawaiian_pacific_islander" | "white" | "two_or_more" | "declined" | null} race
 * @property {"protected_veteran" | "not_protected_veteran" | "declined" | null} veteran_status
 * @property {"yes" | "no" | "declined" | null} disability_status
 */

/**
 * The one object the content script actually fills a page from. Assembled
 * in src/background/api.js by combining existing WorkIt endpoints (auth,
 * profile, the experience bank, job preferences, and the autofill answer
 * bank) — nothing here is new data, it's a read-only reshaping of what
 * WorkIt's own database already holds.
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
 * @property {AutofillAnswers} answers  Never null — every key is simply
 *   null until the student answers it (KAN-283's onboarding Profile step,
 *   or My Profile).
 * @property {{ filename: string, mimeType: string, base64: string } | null} resume
 *   Whichever resume My Profile calls the student's default (an upload or a
 *   built resume, backend/app/models/CLAUDE.md's "Built resumes"), already
 *   resolved to file bytes — null when there is none, or when resolving it
 *   failed (background/api.js's resolveResumeFile is best-effort and never
 *   fails the rest of the profile over this one field).
 * @property {number} fetched_at  Unix ms, for cache-staleness decisions.
 */

/**
 * "skipped" is an optional field with nothing to fill it from — distinct
 * from "failed", which only ever means a required field that couldn't be
 * filled. This split is the direct fix for JobRight's Minor(s) bug: an
 * empty optional field is a non-event, not a red flag. "needs_generation"
 * is its own fourth state: an open-ended question WorkIt could draft an
 * answer for but hasn't, pending the student's one opt-in click in the
 * overlay (the Fill engine's Plan, content-script.js,
 * overlay.js's promptForEssays) — never "pending", since nothing in the
 * normal fill pass is ever going to resolve it on its own.
 * @typedef {"pending" | "filled" | "failed" | "skipped" | "needs_generation"} FieldStatus
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
