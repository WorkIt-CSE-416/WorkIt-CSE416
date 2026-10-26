/**
 * The API's limit on uploaded resumes (`backend/app/services/built_resumes.py`,
 * `MAX_RESUMES`): uploads alone count, generated resumes never (KAN-268). The
 * Resumes page and "Did You Apply?" read it, so both refuse at the count the
 * API does; past it, a new file replaces one (Import Updated Resume).
 */
export const MAX_UPLOADS = 5;
