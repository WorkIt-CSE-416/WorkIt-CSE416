// The service worker: owns the profile cache, and is the only place that
// talks to the WorkIt API. The popup and the on-demand content script both
// go through messages here rather than importing api.js/auth.js directly —
// a service worker can be killed and restarted by Chrome at any time, so
// it's the one place state actually has to live (chrome.storage), not a
// convenience layer. There's no session to own anymore (auth.js's own
// comment explains why) — just the cache.

import { getSession } from "./auth.js";
import { getAutofillProfile, generateEssayAnswer, ApiError } from "./api.js";
import { openNextApplication, runStatus, showRunTab } from "./runner.js";
import { engineCaller, fieldResult, fillOrder, planFill, planRows, runEngine } from "./engine.js";

/**
 * Calls the Fill engine in the frame that sent `sender`'s message: the
 * engine runs in the page's MAIN world (content-scripts.js's ENGINE_FILES),
 * which the content script, in its isolated world, can't call itself.
 * @param {chrome.runtime.MessageSender} sender
 */
function engineIn(sender) {
  const target = { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] };
  return engineCaller(async (request) => {
    const [injection] = await chrome.scripting.executeScript({ target, world: "MAIN", func: runEngine, args: [request] });
    return injection?.result;
  });
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${new URL(url).hostname} answered ${response.status}`);
  return response.text();
}

/** Today in the student's own time zone, as the engine's rules read it ("YYYY-MM-DD"). */
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * @param {{ type: string, [key: string]: any }} message
 * @param {chrome.runtime.MessageSender} sender
 */
async function handleMessage(message, sender) {
  switch (message.type) {
    case "auth/status": {
      const session = await getSession();
      return { signedIn: Boolean(session) };
    }

    case "profile/get": {
      const profile = await getAutofillProfile({ force: Boolean(message.force) });
      return { profile };
    }

    case "essay/generate": {
      const { answer, uses_left } = await generateEssayAnswer(message.applicantId, {
        question: message.question,
        companyName: message.companyName,
        jobTitle: message.jobTitle,
        maxLength: message.maxLength,
      });
      return { answer, usesLeft: uses_left };
    }

    // The content script's fill (content-script.js): the Plan for the page
    // it runs in, then each planned answer filled through the engine.
    case "fill/plan": {
      const profile = await getAutofillProfile();
      const prepared = await planFill({
        url: sender.url, profile, today: today(), call: engineIn(sender), fetchText,
      });
      if (!prepared.covered) return prepared;
      return { ...prepared, applicantId: profile.id, order: fillOrder(prepared), rows: planRows(prepared) };
    }

    case "fill/field":
      return { result: await fieldResult(engineIn(sender), message, message.name, message.value) };

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// Messages from the popup and the content script (same extension, so this
// channel, not the External one below).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
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
