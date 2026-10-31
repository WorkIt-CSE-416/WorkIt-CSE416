// What the extension keeps for one signed-in account, and its clearing when
// that account signs out or another signs in on the same Chrome (KAN-469).
// On a shared or lab Chrome, the last student's résumé, transcript, self-ID
// answers and bank must not stay on disk after they sign out.
//
// auth.js's getSession hands every session it reads to keepFor, and watches
// the webapp's session cookie, so a sign-out clears this at once even when
// nothing else asks for the session after it.
//
// Kept on purpose: the Workday logins this Chrome saved (workday-logins.js)
// and the sites the student allowed (site-access.js) belong to the browser,
// not to one WorkIt account; and the moments shown (moments.js), which are
// kept by student and hold no personal data.

/** The cached AutofillProfile (api.js). */
export const PROFILE_CACHE_KEY = "workit_autofill_profile";
/** Each tab's switched résumé, the file itself (resume-tab.js). */
export const TAB_RESUMES_KEY = "resume_by_tab";
/** A problem report's preview, by tab and frame (report.js previewKey). */
const REPORT_PREFIX = "report:";
/** Whose data the rest is: the signed-in account's id, or null signed out. */
const OWNER_KEY = "workit_account";

/** Deletes every per-account value this extension keeps. */
export async function forgetAccount() {
  const session = await chrome.storage.session.get(null);
  await Promise.all([
    chrome.storage.local.remove(PROFILE_CACHE_KEY),
    chrome.storage.session.remove([TAB_RESUMES_KEY, ...Object.keys(session).filter((key) => key.startsWith(REPORT_PREFIX))]),
  ]);
}

// One check at a time: the calls a sign-in sets off together must not each clear what another just kept.
let queue = Promise.resolve();

/**
 * Notes whose data the extension now keeps, and clears the last account's
 * when it isn't this one: signed out (`session` null), or another account.
 * @param {import("../shared/types.js").Session | null} session
 */
export function keepFor(session) {
  const owner = session ? String(session.user_id) : null;
  const run = queue.then(async () => {
    const { [OWNER_KEY]: last } = await chrome.storage.local.get(OWNER_KEY);
    if (last === owner) return;
    await forgetAccount();
    await chrome.storage.local.set({ [OWNER_KEY]: owner });
  });
  queue = run.catch(() => {});
  return run;
}
