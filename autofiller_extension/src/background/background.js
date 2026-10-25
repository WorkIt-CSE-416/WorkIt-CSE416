// The service worker: owns the profile cache, and is the only place that
// talks to the WorkIt API. The popup and the on-demand content script both
// go through messages here rather than importing api.js/auth.js directly —
// a service worker can be killed and restarted by Chrome at any time, so
// it's the one place state actually has to live (chrome.storage), not a
// convenience layer. There's no session to own anymore (auth.js's own
// comment explains why) — just the cache.

import { getSession } from "./auth.js";
import { answerBank, getAutofillProfile, generateEssayAnswer, ApiError, askQuestions, me, saveOwnAnswer, writtenAnswers } from "./api.js";
import {
  batchStatus, forgetTab, inBatch, jobInTab, markSubmitted, nextNeedsYou, practiceStatus, setTabState, showBatchTab, startBatch, startPractice, submitPractice,
  writeEarly,
} from "./batch.js";
import { engineCaller, handleFill, jobOf, practiceJob, runEngine, submittedPage } from "./engine.js";
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
    // engine (fill/page), what fields show (fill/read) and which required
    // ones show nothing (fill/required). A Workday tab is remembered, so its
    // fill starts again when a step loads as a new page.
    case "fill/plan":
    case "fill/page":
    case "fill/read":
    case "fill/required": {
      const profile = await getAutofillProfile();
      if (message.type === "fill/plan" && jobOf(sender.url)?.site === "workday") await rememberWorkdayTab(sender.tab.id);
      // A batch tab plans with the answers its application may reuse (KAN-379), read fresh for each Plan:
      // one saved a moment ago in another tab counts. Any other page has no application, so no bank.
      const jobId = message.type === "fill/plan" ? await jobInTab(sender.tab.id) : null;
      const bank = jobId ? await answerBank(profile.id, jobId).catch(() => ({})) : {};
      return handleFill(message, {
        url: sender.url, profile, bank, today: today(), call: engineIn(sender), fetchText, trees: workdayTrees,
      });
    }

    // A batch apply tab's fill says whether the tab is ready or needs the
    // student (content-script.js); batch.js moves it to that group.
    case "batch/state": {
      if (message.state !== "ready" && message.state !== "needs_you") throw new Error(`Unknown tab state: ${message.state}`);
      return setTabState(sender.tab.id, message.state);
    }

    // A batch tab's questions that need writing (KAN-377): sent to the API for
    // the student's own Claude to answer through the connector
    // (batch/questions), then the answers saved so far (batch/answers), which
    // the tab fills. The job is the batch's own for that tab, never the message's.
    case "batch/questions":
    case "batch/answers": {
      const jobId = await jobInTab(sender.tab.id);
      if (!jobId) throw new Error("This tab isn't one of the batch's");
      const { id } = await me();
      const questions = message.type === "batch/questions"
        ? await askQuestions(id, jobId, message.questions)
        : await writtenAnswers(id, jobId);
      return { questions };
    }

    // The student's own words for one of a batch tab's questions that need
    // writing (KAN-379): an edit to the answer filled there, or their answer
    // before their Claude's. Kept as the application's answer and saved for
    // later forms. The job is the batch's own for that tab, never the message's.
    case "batch/own-answer": {
      const jobId = await jobInTab(sender.tab.id);
      if (!jobId) throw new Error("This tab isn't one of the batch's");
      const { id } = await me();
      await saveOwnAnswer(id, jobId, { name: message.name, label: message.label, answer: message.answer });
      return {};
    }

    // A batch tab's "Next Thing That Needs You" (content-script.js): batch.js goes to it, across the tabs.
    case "batch/next":
      return nextNeedsYou();

    // A batch tab's page watches for the student's own submit (KAN-374):
    // the engine, in the page, reads the job system's answer to it and its
    // notices, and tells the content script, which says "batch/submitted"
    // when the application was sent. The extension never submits.
    case "batch/watch": {
      const job = jobOf(sender.url);
      // A practice form's submit is its thanks page's (submitPractice below), never an application's.
      const site = job && !job.practice ? job.site : null;
      if (site && (await inBatch(sender.tab.id))) await engineIn(sender)("watchSubmit", site);
      return { watching: Boolean(site) };
    }

    case "batch/submitted":
      return markSubmitted(sender.tab.id);

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

// A batch tab that moves to a job system's page for a sent application
// (Greenhouse's confirmation, Lever's thanks) was submitted by the student.
// Lever's form is a plain HTML post, so this is its only signal. Host
// permissions show the tab's link, with no `tabs` permission.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url || !submittedPage(change.url)) return;
  markSubmitted(tabId).catch((error) => console.warn("[batch] the application wasn't marked applied:", error.message));
});

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.status !== "complete") return;
  const tabs = await workdayTabs();
  if (!tabs.includes(tabId)) return;
  if (jobOf(tab.url ?? "")?.site !== "workday") {
    await chrome.storage.session.set({ [WORKDAY_TABS_KEY]: tabs.filter((id) => id !== tabId) });
    return;
  }
  injectFill(tabId, { batch: await inBatch(tabId) }).catch((error) => console.warn("[fill] Workday's next page wasn't filled:", error));
});

// A practice form's Submit opens its /thanks page and sends nothing
// (frontend/src/lib/practice-form.ts): reaching it is the practice job's
// submit. `url` is given for WorkIt's own pages, which are in host_permissions.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url && practiceJob(change.url)?.page === "thanks") {
    submitPractice(tabId).catch((error) => console.warn("[batch] the practice submit wasn't kept:", error));
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await forgetTab(tabId);
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
// signed-in user's resume data just by asking. `run/open` (start or top up
// the batch, batch.js) takes no URL for the same reason: the links come
// from the API; it gets the sender only to open the tabs in the window that
// asked. The other two only say which job postings the batch's tabs show,
// and switch to one of them (`jobId` picks among the batch's own tabs only).
// Onboarding's practice batch (KAN-378) takes links, but only to WorkIt's own
// practice forms on the asking page's site (batch.js, `startPractice`).
const RUNNER_MESSAGES = {
  "run/open": async (message, sender) => {
    const opened = await startBatch(sender);
    // Not awaited: the webapp hears once the tabs open; the queue's other questions are read meanwhile (KAN-379).
    if (opened.opened) writeEarly({ fetchText, today: today() }).catch((error) => console.warn("[batch] questions not read early:", error.message));
    return opened;
  },
  "run/status": () => batchStatus(),
  "run/show": (message) => showBatchTab(message),
  "practice/open": (message, sender) => startPractice(sender, message),
  "practice/status": () => practiceStatus(),
};

/** Whether the student pinned the extension to the toolbar; null where Chrome can't say. */
async function pinned() {
  try {
    return (await chrome.action.getUserSettings()).isOnToolbar;
  } catch {
    return null;
  }
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message?.type === "ping") {
    // `pinned` for onboarding's install step (KAN-378), which asks the student to pin it.
    Promise.all([getSession().catch(() => null), pinned()])
      .then(([session, isPinned]) => sendResponse({ ok: true, installed: true, signedIn: Boolean(session), pinned: isPinned }));
    return true;
  }

  // Own keys only, so a type such as "toString" never reaches a built-in.
  if (Object.hasOwn(RUNNER_MESSAGES, message?.type)) {
    RUNNER_MESSAGES[message.type](message, sender)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  sendResponse({ ok: false, error: "Unsupported message" });
});
