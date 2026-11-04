// Apply's Employer accounts (KAN-592). Apply (apply-agent/), on the student's own Mac, makes a Workday
// account per company with a generated password that it keeps only in macOS Keychain. Its Apply
// accounts host (apply-agent's native_host.py, installed by `apply chrome-passwords`) gives this
// extension one tenant's login at a time, over native messaging, and only to this extension's ID.
//
// The student turns it on, once, on the options page (Use My Apply Accounts), which asks Chrome for
// the optional nativeMessaging permission. Without it, or without the host, nothing changes.
//
// On a tenant Apply made an account at, `known` (company and login, never the password) shows the
// panel's Sign In with Your Apply Account. Only its press asks for `login` (with the password), whose
// answer goes to that tab's content script alone, which types it and hands it to Chrome's own password
// manager (navigator.credentials.store, so Chrome asks to save it). THE PASSWORD IS NEVER KEPT HERE:
// not in chrome.storage, a log, a report or an API call.

export const APPLY_HOST = "com.workit.apply_accounts";
const PERMISSION = { permissions: ["nativeMessaging"] };

/**
 * The Apply accounts host's answer for one tenant: `want: "known"` gives `{ company, login }`,
 * `want: "login"` adds `password`. `{ none }` says why there is none (Apply made no account there,
 * the switch is off, no host).
 * @param {string} tenant the engine's Workday tenant (jobOf(url).tenant)
 * @param {"known" | "login"} want
 * @returns {Promise<{ company?: string, login?: string, password?: string, none?: string }>}
 */
export async function applyAccount(tenant, want) {
  if (!(await chrome.permissions.contains(PERMISSION))) return { none: "Use My Apply Accounts is off" };
  try {
    return (await chrome.runtime.sendNativeMessage(APPLY_HOST, { tenant, want })) ?? { none: "Apply's host gave no answer" };
  } catch {
    return { none: "Apply's host isn't installed: run `uv run apply chrome-passwords`" };
  }
}
