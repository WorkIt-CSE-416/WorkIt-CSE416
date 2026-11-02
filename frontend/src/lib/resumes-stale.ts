/**
 * "A resume changed in this tab since the Resumes page last read its list",
 * for the writes that cannot clear the router's copies with
 * `revalidatingResumes` (`./resume-revalidate.ts`): the editor's per-edit
 * saves and Fit, where a revalidation would compile the PDF again on every
 * edit, and the Tailor run, which streams through a route handler. A Back
 * to the Resumes page shows the router's copy of the list, so the page reads
 * the list again on mount when this is set (`(seeker)/resumes/built-resumes.tsx`).
 *
 * A module variable is safe here, unlike My Profile's cache
 * (`(seeker)/profile-cache.tsx`): it holds one flag, never a resume, so nothing of
 * one account reaches the next person in the tab. After a link visit the
 * page's list is fresh already, so that mount reads it once more; the flag
 * is cleared then too.
 */
let stale = false;

export function markResumesStale() {
  stale = true;
}

/** Whether the list needs reading again, clearing the flag. */
export function takeResumesStale(): boolean {
  const was = stale;
  stale = false;
  return was;
}
