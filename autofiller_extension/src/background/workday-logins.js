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

const LOGINS_KEY = "workday_logins";
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
 * @returns {Promise<{ email: string, password: string | null, made: boolean }>}
 */
export async function workdayLogin(tenant, email, { create }) {
  const logins = (await chrome.storage.local.get(LOGINS_KEY))[LOGINS_KEY] ?? {};
  if (logins[tenant]) return { ...logins[tenant], made: false };
  if (!create) return { email, password: null, made: false };
  logins[tenant] = { email, password: newPassword() };
  await chrome.storage.local.set({ [LOGINS_KEY]: logins });
  return { ...logins[tenant], made: true };
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
