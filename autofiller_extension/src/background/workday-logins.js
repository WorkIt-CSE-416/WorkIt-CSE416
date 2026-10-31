// The student's Workday sign-ins (KAN-373, KAN-479). Workday asks for an
// account on each company's site (its tenant). The extension fills each
// tenant's Create Account and Sign In with ONE registration email and
// password the student sets for every company (`workday_signup`: the
// extension's Workday Sign-Up page, src/options/, or the consent card in the
// page's panel), as Jobright and Simplify do. Because the student chose the
// password, an uninstall or a new laptop never locks them out of the
// accounts WorkIt made. It never makes up a password: with no sign-up set,
// Create Account waits for the student to set one. A separate generated
// password per company is a later paid feature (KAN-481), not built here.
//
// When a tenant's Create Account is filled, the sign-up is copied into
// `workday_logins` (by tenant), so a later change to the sign-up applies only
// to tenants made after it: Workday keeps each company's account separate.
// A tenant saved before KAN-479 holds a password generated for it alone; it
// keeps that login, since its account was made with it.
//
// THE PASSWORDS NEVER LEAVE THIS BROWSER. They live only in
// chrome.storage.local, on the student's own computer: never sent to the
// WorkIt API, never in a message to the webapp, a log or a fix report.
// Chrome may offer to save them too. Removing the extension deletes them.
//
// Once the student allows it (`workday_accounts_for_me`, asked once in the
// page's panel), the content script also ticks each company's terms box and
// presses Create Account or Sign In itself, as Jobright and Simplify do
// (workday.js). A tenant whose application has shown since is marked
// `signedIn`: its account exists, so its Create Account is never pressed. So
// is one whose Create Account the extension pressed and Workday answered by
// asking to verify the email (`created`): its next page signs in. A
// tenant whose Sign In Workday refused is marked `refused`: its Sign In is
// never pressed again until the student signs in there.
//
// Workday may drop a press made right after typing, sending nothing (Axiom's
// Create Account, live). So this worker watches, observing only (never
// blocking or changing a request), for the form going out: a tab's non-GET
// request to a Workday host outside its /wday/ API (watchWorkdaySends). A
// press is made again only when none went (sentSince), never after one did:
// a second Create Account would find the account made.

const LOGINS_KEY = "workday_logins";
const FOR_ME_KEY = "workday_accounts_for_me";
const SIGNUP_KEY = "workday_signup";

// One change to the saved logins at a time: each reads and writes the whole
// map, so two tenants' Create Account at once would otherwise each write over
// the other's new login, after its account was made with it.
let queue = Promise.resolve();
function serially(change) {
  const run = queue.then(change, change);
  queue = run.catch(() => {});
  return run;
}

/** Reads the saved logins, lets `change` edit them, and saves them when it answers true. */
function changeLogins(change) {
  return serially(async () => {
    const stored = await chrome.storage.local.get([LOGINS_KEY, FOR_ME_KEY, SIGNUP_KEY]);
    const logins = stored[LOGINS_KEY] ?? {};
    const signup = stored[SIGNUP_KEY]?.password ? stored[SIGNUP_KEY] : null;
    const answer = await change(logins, stored[FOR_ME_KEY] === true, signup);
    if (answer?.save) await chrome.storage.local.set({ [LOGINS_KEY]: logins });
    return answer?.value;
  });
}

/**
 * The login to fill on a tenant's Workday: the saved one, else the student's
 * Workday sign-up, copied into the tenant's saved login for Create Account
 * (`create`) so the account made with it can always be signed in to again.
 * On Sign In with nothing saved, the sign-up (`fresh`: no account is known
 * here). With no sign-up set and nothing saved, `password` is null and
 * `needsSignup` is true: the student sets one first (the consent card).
 * @param {string} tenant the engine's Workday tenant (jobOf(url).tenant)
 * @param {string} email the student's email
 * @param {{ create: boolean }} options
 * `made`: the login is new here, copied from the sign-up by this call. `signup`: it is the sign-up's.
 * `fresh`: Sign In with nothing saved here, filled with the sign-up's login. `needsSignup`: no sign-up is set
 * and nothing is saved here. `signedIn`: it has signed in here. `created`: Workday made the account with it,
 * pending the student's verification. `refused`: Workday refused a Sign In the extension pressed with
 * it. `forMe`: the student allowed the extension to press the buttons.
 * @returns {Promise<{ email: string, password: string | null, made: boolean, signup: boolean, fresh: boolean, needsSignup: boolean, signedIn: boolean, created: boolean, refused: boolean, forMe: boolean }>}
 */
export function workdayLogin(tenant, email, { create }) {
  return changeLogins((logins, forMe, signup) => {
    const answer = (login, made, fresh = false) => ({
      email: login.email, password: login.password, made, signup: Boolean(login.signup), fresh, needsSignup: !login.password,
      signedIn: Boolean(login.signedIn), created: Boolean(login.created), refused: Boolean(login.refused), forMe,
    });
    if (logins[tenant]) return { value: answer(logins[tenant], false) };
    if (!signup) return { value: answer({ email, password: null }, false) };
    if (!create) return { value: answer(fromSignup(signup), false, true) };
    logins[tenant] = fromSignup(signup);
    return { value: answer(logins[tenant], true), save: true };
  });
}

/** A tenant's login copied from the student's Workday sign-up. */
function fromSignup(signup) {
  return { email: signup.email, password: signup.password, signup: true };
}

/** The student allowed the extension to make and sign in to their Workday accounts, at every company. */
export async function allowForMe() {
  await chrome.storage.local.set({ [FOR_ME_KEY]: true });
}

/**
 * A tenant's application showed: the saved login signs in there, and a
 * refused Sign In no longer holds (the student signed in). Nothing to mark
 * without one.
 */
export function markSignedIn(tenant) {
  return changeLogins((logins) => {
    const login = logins[tenant];
    if (!login || (login.signedIn && !login.refused)) return;
    const { refused: _, ...rest } = login;
    logins[tenant] = { ...rest, signedIn: true };
    return { save: true };
  });
}

/**
 * Workday answered the Create Account the extension pressed by asking the
 * student to verify their email: the account was made with the saved
 * password, so the tenant's next Create Account page switches to Sign In.
 */
export function markCreated(tenant) {
  return changeLogins((logins) => {
    if (!logins[tenant] || logins[tenant].created) return;
    logins[tenant] = { ...logins[tenant], created: true };
    return { save: true };
  });
}

/**
 * Workday refused a Sign In the extension pressed with the saved login: it
 * is kept, but never pressed with again (each try counts toward Workday's
 * lockout), on any page, until the student signs in (markSignedIn). A
 * sign-up's login refused where nothing was saved is saved there, refused.
 */
export function markRefused(tenant) {
  return changeLogins((logins, _forMe, signup) => {
    if (!logins[tenant] && signup) logins[tenant] = fromSignup(signup);
    if (!logins[tenant] || logins[tenant].refused) return;
    logins[tenant] = { ...logins[tenant], refused: true };
    return { save: true };
  });
}

/**
 * Workday refused the Create Account the extension pressed with a login new
 * here: no account was made with it, so the tenant's copy is dropped (the
 * sign-up itself stays). A login that has signed in, or made an account
 * (`created`), is kept.
 */
export function forgetLogin(tenant) {
  return changeLogins((logins) => {
    if (!logins[tenant] || logins[tenant].signedIn || logins[tenant].created) return;
    delete logins[tenant];
    return { save: true };
  });
}

// Where a tab's last sign-in send to a host is kept: in session storage, so a restarted worker still knows it.
const SENT_KEY = (tabId, host) => `workday_sent_${tabId}_${host}`;

/**
 * Starts noting, per tab and Workday host, when the tab last sent that host
 * a non-GET request outside /wday/ (a Create Account or Sign In going out).
 * Observing only: it never blocks or changes a request.
 */
export function watchWorkdaySends() {
  chrome.webRequest.onBeforeRequest.addListener((d) => {
    if (d.method === "GET" || d.tabId < 0) return;
    const { hostname, pathname } = new URL(d.url);
    if (pathname.startsWith("/wday/")) return;
    chrome.storage.session.set({ [SENT_KEY(d.tabId, hostname)]: d.timeStamp });
  }, { urls: ["https://*.myworkdayjobs.com/*", "https://*.myworkdaysite.com/*"] });
}

/** Whether tab `tabId` sent Workday host `host` a sign-in form (watchWorkdaySends) at or after `since` (ms). */
export async function sentSince(tabId, host, since) {
  const key = SENT_KEY(tabId, host);
  return ((await chrome.storage.session.get(key))[key] ?? 0) >= since;
}
