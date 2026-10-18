// The service worker: owns the profile cache, and is the only place that
// talks to the WorkIt API. The popup and the on-demand content script both
// go through messages here rather than importing api.js/auth.js directly —
// a service worker can be killed and restarted by Chrome at any time, so
// it's the one place state actually has to live (chrome.storage), not a
// convenience layer. There's no session to own anymore (auth.js's own
// comment explains why) — just the cache.

import { getSession } from "./auth.js";
import { getAutofillProfile, ApiError } from "./api.js";
import { openNextApplication, runStatus, showRunTab } from "./runner.js";

/** @param {{ type: string, [key: string]: any }} message */
async function handleMessage(message) {
  switch (message.type) {
    case "auth/status": {
      const session = await getSession();
      return { signedIn: Boolean(session) };
    }

    case "profile/get": {
      const profile = await getAutofillProfile({ force: Boolean(message.force) });
      return { profile };
    }

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// Messages from the popup and the content script (same extension, so this
// channel, not the External one below).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      const status = error instanceof ApiError ? error.status : undefined;
      sendResponse({ ok: false, error: error.message, status });
    });
  return true; // keep the message channel open for the async response
});

// Messages from the WorkIt webapp itself (manifest.json's
// externally_connectable). Deliberately a much smaller surface than the
// internal channel above — the webapp can ask "is the extension here and
// signed in", and ask the runner to open the next queued application,
// nothing more. It never receives the profile or the session; there's no
// reason the page needs either, and handing them over would make a
// compromised or malicious page on an allowed origin able to read a
// signed-in user's resume data just by asking. `run/open` takes no URL for
// the same reason: the runner reads it from the API (runner.js); it gets
// the sender only to open the run's tab beside the page that asked. The
// other two only say which job posting the run's tab shows, and switch to
// it.
const RUNNER_MESSAGES = {
  "run/open": openNextApplication,
  "run/status": runStatus,
  "run/show": showRunTab,
};

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message?.type === "ping") {
    getSession()
      .then((session) => sendResponse({ ok: true, installed: true, signedIn: Boolean(session) }))
      .catch(() => sendResponse({ ok: true, installed: true, signedIn: false }));
    return true;
  }

  // Own keys only, so a type such as "toString" never reaches a built-in.
  if (Object.hasOwn(RUNNER_MESSAGES, message?.type)) {
    RUNNER_MESSAGES[message.type](sender)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  sendResponse({ ok: false, error: "Unsupported message" });
});
