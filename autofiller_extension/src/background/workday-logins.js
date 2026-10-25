// The student's Workday sign-ins (KAN-373). Workday asks for an account on
// each company's site (its tenant), so the extension fills the Create
// Account form with the student's email and a strong password made for that
// tenant alone, and fills the same login on the tenant's Sign In later.
//
// THE PASSWORDS NEVER LEAVE THIS BROWSER. They live only in
// chrome.storage.local (`workday_logins`, by tenant), on the student's own
// computer: never sent to the WorkIt API, never in a message to the webapp.
// Chrome may offer to save them too. Never one password for every company
// (one leak would open them all), and never a password kept on a server.
//
// Once the student allows it (`workday_accounts_for_me`, asked once in the
// page's panel), the content script also ticks each company's terms box and
// presses Create Account or Sign In itself, as Jobright and Simplify do
// (workday.js). A tenant whose application has shown since is marked
// `signedIn`: its account exists, so its Create Account is never pressed.

const LOGINS_KEY = "workday_logins";
const FOR_ME_KEY = "workday_accounts_for_me";
const PASSWORD_LENGTH = 20;
// One of each kind at least, which every Workday password rule seen asks for.
const KINDS = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!#$%&*+-=?@^_~"];

/**
 * The login to fill on a tenant's Workday: the saved one, else, for Create
 * Account (`create`), a new password, saved before it is filled so the
 * account the student makes with it can always be signed in to again. On
 * Sign In with nothing saved, `password` is null (the student made that
 * account without WorkIt).
 * @param {string} tenant the engine's Workday tenant (jobOf(url).tenant)
 * @param {string} email the student's email
 * @param {{ create: boolean }} options
 * `forMe`: the student allowed the extension to press the buttons.
 * @returns {Promise<{ email: string, password: string | null, made: boolean, signedIn: boolean, forMe: boolean }>}
 */
export async function workdayLogin(tenant, email, { create }) {
  const stored = await chrome.storage.local.get([LOGINS_KEY, FOR_ME_KEY]);
  const logins = stored[LOGINS_KEY] ?? {};
  const forMe = stored[FOR_ME_KEY] === true;
  if (logins[tenant]) return { signedIn: false, ...logins[tenant], made: false, forMe };
  if (!create) return { email, password: null, made: false, signedIn: false, forMe };
  logins[tenant] = { email, password: newPassword() };
  await chrome.storage.local.set({ [LOGINS_KEY]: logins });
  return { ...logins[tenant], made: true, signedIn: false, forMe };
}

/** The student allowed the extension to make and sign in to their Workday accounts, at every company. */
export async function allowForMe() {
  await chrome.storage.local.set({ [FOR_ME_KEY]: true });
}

/** A tenant's application showed: the saved login signs in there. Nothing to mark without one. */
export async function markSignedIn(tenant) {
  const logins = (await chrome.storage.local.get(LOGINS_KEY))[LOGINS_KEY] ?? {};
  if (!logins[tenant] || logins[tenant].signedIn) return;
  logins[tenant] = { ...logins[tenant], signedIn: true };
  await chrome.storage.local.set({ [LOGINS_KEY]: logins });
}

/**
 * Workday refused the Create Account the extension pressed with a new
 * password: no account was made with it, so it is dropped. A login that has
 * signed in is kept.
 */
export async function forgetLogin(tenant) {
  const logins = (await chrome.storage.local.get(LOGINS_KEY))[LOGINS_KEY] ?? {};
  if (!logins[tenant] || logins[tenant].signedIn) return;
  delete logins[tenant];
  await chrome.storage.local.set({ [LOGINS_KEY]: logins });
}

/** A random password of PASSWORD_LENGTH characters, with one of each of KINDS at least. */
export function newPassword() {
  const pick = (chars) => chars[crypto.getRandomValues(new Uint32Array(1))[0] % chars.length];
  const every = KINDS.join("");
  const chars = [...KINDS.map(pick), ...Array.from({ length: PASSWORD_LENGTH - KINDS.length }, () => pick(every))];
  // Shuffle (Fisher-Yates), so the guaranteed kinds aren't always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
