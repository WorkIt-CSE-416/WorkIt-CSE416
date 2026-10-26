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
import { engineCaller, handleFill, jobOf, runEngine } from "./engine.js";
import { injectFill } from "../shared/content-scripts.js";

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

async function fetchText(url, init) {
  const response = await fetch(url, init && { ...init, headers: { "Content-Type": "application/json" } });
  if (!response.ok) throw new Error(`${new URL(url).hostname} answered ${response.status}`);
  return response.text();
}

// The nested prompts the engine read on each Workday tenant (fill/plan, fill/page), kept for its next fill.
const WORKDAY_TREES_KEY = "workday_trees";
const workdayTrees = {
  async load() {
    return (await chrome.storage.local.get(WORKDAY_TREES_KEY))[WORKDAY_TREES_KEY] ?? {};
  },
  async save(saved) {
    await chrome.storage.local.set({ [WORKDAY_TREES_KEY]: { ...(await this.load()), ...saved } });
  },
};

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
    // it runs in (fill/plan), then the planned answers filled through the
    // engine (fill/page). A Workday tab is remembered, so its
    // fill starts again when a step loads as a new page.
    case "fill/plan":
    case "fill/page": {
      const profile = await getAutofillProfile();
      if (message.type === "fill/plan" && jobOf(sender.url)?.site === "workday") await rememberWorkdayTab(sender.tab.id);
      return handleFill(message, {
        url: sender.url, profile, today: today(), call: engineIn(sender), fetchText, trees: workdayTrees,
      });
    }

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// Workday tabs a fill ran in. Workday moves between an application's steps
// in the page, where the content script fills each step as it shows; a step
// that loads as a new page drops the content script, so the fill is injected
// again there. A tab that leaves Workday is forgotten.
const WORKDAY_TABS_KEY = "workday_fill_tabs";

async function workdayTabs() {
  return (await chrome.storage.session.get(WORKDAY_TABS_KEY))[WORKDAY_TABS_KEY] ?? [];
}

async function rememberWorkdayTab(tabId) {
  const tabs = await workdayTabs();
  if (!tabs.includes(tabId)) await chrome.storage.session.set({ [WORKDAY_TABS_KEY]: [...tabs, tabId] });
}

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.status !== "complete") return;
  const tabs = await workdayTabs();
  if (!tabs.includes(tabId)) return;
  if (jobOf(tab.url ?? "")?.site !== "workday") {
    await chrome.storage.session.set({ [WORKDAY_TABS_KEY]: tabs.filter((id) => id !== tabId) });
    return;
  }
  injectFill(tabId).catch((error) => console.warn("[fill] Workday's next page wasn't filled:", error));
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const tabs = await workdayTabs();
  if (tabs.includes(tabId)) await chrome.storage.session.set({ [WORKDAY_TABS_KEY]: tabs.filter((id) => id !== tabId) });
});

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
