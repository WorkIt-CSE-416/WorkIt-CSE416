// The service worker: owns the profile cache, and is the only place that
// talks to the WorkIt API. The popup and the on-demand content script both
// go through messages here rather than importing api.js/auth.js directly —
// a service worker can be killed and restarted by Chrome at any time, so
// it's the one place state actually has to live (chrome.storage), not a
// convenience layer. There's no session to own anymore (auth.js's own
// comment explains why) — just the cache.

import { getSession } from "./auth.js";
import {
  answerBank, answerFlag, anyFormAnswerBank, dropOwnAnswer, getAutofillProfile, generateEssayAnswer, ApiError, askQuestions, connectorAdded, me, saveAutofillAnswers, saveOwnAnswer, savePastedAnswer,
  writingSamples, writtenAnswers,
} from "./api.js";
import {
  batchStatus, batchTabIds, forgetTab, inBatch, jobInTab, jobTypeInTab, markSubmitted, practiceStatus, resumeBatch, setTabState, setWriting,
  showBatchTab, skipTab, startBatch, startPractice, submitPractice,
} from "./batch.js";
import { engineCaller, handleFill, jobOf, practiceJob, runEngine, submittedPage } from "./engine.js";
import { claimMoment } from "./moments.js";
import { nextNeedsYou, walkFrom } from "./next-needs-you.js";
import { SELF_ID, checkedSelfId, unansweredSelfId } from "./self-id.js";
import { forgetSubmits, submitHinted, watchSubmitRequests } from "./submit-proof.js";
import { injectFill } from "../shared/content-scripts.js";
import { forgetShownWorkableDraft } from "./tab-load.js";
import { allowForMe, forgetLogin, markCreated, markRefused, markSignedIn, sentSince, watchWorkdaySends, workdayLogin } from "./workday-logins.js";
import { writeEarly } from "./write-early.js";

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
    // engine (fill/page), what fields show (fill/read), which follow-ups
    // the answers don't call for (fill/moot) and which required ones show
    // nothing (fill/required). A Workday tab is remembered, so its
    // fill starts again when a step loads as a new page.
    case "fill/plan":
    case "fill/page":
    case "fill/read":
    case "fill/moot":
    case "fill/required": {
      const profile = await getAutofillProfile();
      if (message.type === "fill/plan" && jobOf(sender.url)?.site === "workday") {
        await rememberWorkdayTab(sender.tab.id);
        // An application step shows: the saved login (if any) signs in to this tenant.
        await markSignedIn(jobOf(sender.url).tenant);
      }
      // A Plan uses the answers the student saved (KAN-379), read fresh for each Plan: one saved a
      // moment ago in another tab counts. A batch tab's are its application's; any other page has no
      // application, so it gets the bank for the page's company, once the engine has read it.
      const jobId = message.type === "fill/plan" ? await jobInTab(sender.tab.id) : null;
      // Its job type picks the start date: a full-time role's is graduation, an internship's its start.
      const jobType = jobId ? await jobTypeInTab(sender.tab.id) : null;
      const bank = message.type !== "fill/plan" ? {}
        : jobId ? await answerBank(profile.id, jobId).catch(() => ({}))
        : (company) => anyFormAnswerBank(profile.id, company).catch(() => ({}));
      const answer = await handleFill(message, {
        url: sender.url, profile, bank, today: today(), call: engineIn(sender), fetchText, trees: workdayTrees, jobType,
      });
      // Outside a batch, a Workable draft with entries is forgotten and the form filled again from empty (tab-load.js).
      if (message.type === "fill/plan" && !(await inBatch(sender.tab.id)) && (await forgetShownWorkableDraft(sender.tab.id, answer))) {
        injectFill(sender.tab.id).catch((error) => console.warn("[fill] the reloaded Workable form wasn't filled:", error));
      }
      return answer;
    }

    // A batch apply tab's fill says whether the tab is ready or needs the
    // student (content-script.js); batch.js moves it to that group.
    case "batch/state": {
      if (!["ready", "needs_you", "failed"].includes(message.state)) throw new Error(`Unknown tab state: ${message.state}`);
      return setTabState(sender.tab.id, message.state);
    }

    // Workday's Create Account or Sign In shows (content-script.js): the
    // login to fill for this company's Workday (workday-logins.js). The tab
    // is remembered, so the fill starts again on the page signing in loads.
    case "workday/login": {
      const job = jobOf(sender.url);
      if (job?.site !== "workday") throw new Error("Not a Workday page");
      await rememberWorkdayTab(sender.tab.id);
      const profile = await getAutofillProfile();
      return workdayLogin(job.tenant, profile.email, { create: Boolean(message.create) });
    }

    // The student allowed, once, the extension to make and sign in to their
    // Workday accounts (the panel's card, workday.js): at every company from now on.
    case "workday/allow":
      return allowForMe();

    // Workday refused a Create Account the extension pressed: its new password made no account.
    case "workday/forget": {
      const job = jobOf(sender.url);
      if (job?.site !== "workday") throw new Error("Not a Workday page");
      return forgetLogin(job.tenant);
    }

    // Workday asked to verify the email after a Create Account the extension pressed: the account was made.
    case "workday/created": {
      const job = jobOf(sender.url);
      if (job?.site !== "workday") throw new Error("Not a Workday page");
      return markCreated(job.tenant);
    }

    // Workday refused a Sign In the extension pressed: it is never pressed with that login again.
    case "workday/refused": {
      const job = jobOf(sender.url);
      if (job?.site !== "workday") throw new Error("Not a Workday page");
      return markRefused(job.tenant);
    }

    // A Create Account or Sign In the extension pressed (workday.js): whether this tab sent the form to
    // the page's host since `since`. If not, Workday dropped the press, and it may be made again.
    case "workday/sent": {
      if (jobOf(sender.url)?.site !== "workday") throw new Error("Not a Workday page");
      return { sent: await sentSince(sender.tab.id, new URL(sender.url).hostname, message.since) };
    }

    // The student pressed Skip on a batch tab's panel (content-script.js).
    case "batch/skip":
      return skipTab(sender.tab.id);

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
      if (message.type === "batch/questions") await setWriting(sender.tab.id, { writing: true });
      return { questions };
    }

    // A batch tab's written questions are all answered (KAN-387): once the
    // batch's last one is, in a batch the student's Claude wrote for, the
    // student is asked for writing samples, once, unless they have some.
    case "batch/written": {
      const last = await setWriting(sender.tab.id, { writing: false, byClaude: Boolean(message.byClaude) });
      if (!last) return { show: false };
      const [session, { id }] = await Promise.all([getSession(), me()]);
      if ((await writingSamples(id)).length) return { show: false };
      if (!(await claimMoment(id, "samples"))) return { show: false };
      return { show: true, url: `${session.web_origin}/profile#writing-samples` };
    }

    // The student's own words for one of a batch tab's questions that need
    // writing (KAN-379): an edit to the answer filled there, or their answer
    // before their Claude's. Kept as the application's answer and saved for
    // later forms. The job is the batch's own for that tab, never the message's.
    case "batch/own-answer": {
      const jobId = await jobInTab(sender.tab.id);
      if (!jobId) throw new Error("This tab isn't one of the batch's");
      const { id } = await me();
      await saveOwnAnswer(id, jobId, { name: message.name, label: message.label, answer: message.answer, own: message.own === true });
      return {};
    }

    // Undo on a batch tab's guess card (card-guess.js): takes back an answer saved with "batch/own-answer".
    case "batch/own-answer-undo": {
      const jobId = await jobInTab(sender.tab.id);
      if (!jobId) throw new Error("This tab isn't one of the batch's");
      const { id } = await me();
      await dropOwnAnswer(id, jobId, message.name);
      return {};
    }

    // A batch tab's flag card (card-flag.js): Keep or Rewrite with Claude on an answer the pre-submit review flagged.
    case "batch/flag": {
      const jobId = await jobInTab(sender.tab.id);
      if (!jobId) throw new Error("This tab isn't one of the batch's");
      if (message.action !== "keep" && message.action !== "rewrite") throw new Error("Unknown flag answer");
      const { id } = await me();
      await answerFlag(id, jobId, message.action, message.name);
      return {};
    }

    // An answer the student pasted in a waiting row's card (KAN-369, card-waiting.js): saved through the
    // Written Answers page's route, so it passes the same checks. A refusal is an answer, not an error:
    // its reasons show in the card. The job is the batch's own for that tab, never the message's.
    case "batch/paste": {
      const jobId = await jobInTab(sender.tab.id);
      if (!jobId) throw new Error("This tab isn't one of the batch's");
      const { id } = await me();
      try {
        const { left } = await savePastedAnswer(id, jobId, message.name, message.answer);
        return { saved: true, left };
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 422) throw error;
        return { saved: false, reasons: error.reasons?.[message.name] ?? [], error: error.message };
      }
    }

    // A batch tab's "Next Thing That Needs You" (content-script.js): batch.js goes to it, across the tabs.
    case "batch/next":
      return nextNeedsYou();

    // The submit warning's Show me (content/submit-warning.js): the walk starts at the tab's first open row.
    case "batch/walk-from":
      return { shown: await walkFrom(sender.tab.id, message.key) };

    // A batch tab's page watches for the student's own submit (KAN-374):
    // the engine, in the page, reads the job system's answer to it and its
    // notices, and tells the content script, which says "batch/submitted"
    // when the application was sent. That is only a hint: the application is
    // marked applied once this worker saw the job system take the submit
    // request too (submit-proof.js), or, on a job system whose submit
    // request isn't known (Workday, Eightfold, Rippling), from the hint
    // alone. The extension never submits.
    case "batch/watch": {
      const job = jobOf(sender.url);
      // A practice form's submit is its thanks page's (submitPractice below), never an application's.
      const site = job && !job.practice ? job.site : null;
      if (site && (await inBatch(sender.tab.id))) await engineIn(sender)("watchSubmit", site, message.key);
      return { watching: Boolean(site) };
    }

    case "batch/submitted":
      return { applied: await submitHinted(sender.tab.id, markSubmitted, jobOf(sender.url)?.site) };

    // The first form that asks the self-identification (KAN-387): the tab
    // whose Plan found it asks whether to ask the student (once, in one
    // tab: moments.js), then saves their answers to the profile, and every
    // other batch tab fills them too ("selfid/saved").
    case "selfid/ask": {
      const profile = await getAutofillProfile();
      const keys = unansweredSelfId(profile.answers);
      if (!keys.length || !(await claimMoment(profile.id, "self_id"))) return { ask: false };
      return { ask: true, questions: SELF_ID.filter((q) => keys.includes(q.key)) };
    }

    case "selfid/save": {
      const answers = checkedSelfId(message.answers);
      const { id } = await me();
      if (Object.keys(answers).length) await saveAutofillAnswers(id, answers);
      // The cached profile must have them before any tab plans again.
      await getAutofillProfile({ force: true });
      for (const tabId of await batchTabIds()) {
        if (tabId !== sender.tab?.id) chrome.tabs.sendMessage(tabId, { type: "selfid/saved" }).catch(() => {});
      }
      return {};
    }

    // A batch tab sent its first questions for the student's Claude
    // (KAN-387): the add-Claude step, once, unless the connector is added.
    // The link is the webapp's, which redirects to Claude's dialog (the
    // install link is built there, from the API's address).
    case "moment/claude": {
      if (!(await jobInTab(sender.tab.id))) return { show: false };
      const [session, { id }] = await Promise.all([getSession(), me()]);
      if (await connectorAdded(id)) return { show: false };
      if (!(await claimMoment(id, "claude"))) return { show: false };
      return { show: true, url: `${session.web_origin}/connect/claude/add` };
    }

    // Whether the student's Claude holds a sign-in to the connector (KAN-369):
    // without one, no Claude reviews a batch tab's answers, so it stops asking.
    case "connector/added": {
      const { id } = await me();
      return { added: await connectorAdded(id) };
    }

    // The panel's font (overlay.js's loadFont), as base64: the page can't
    // load the extension's own files, which aren't web-accessible.
    case "overlay/font": {
      const bytes = new Uint8Array(await (await fetch(chrome.runtime.getURL("fonts/PlusJakartaSans-latin.woff2"))).arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { data: btoa(binary) };
    }

    // A batch tab's questions waiting for the student's Claude point at the
    // webapp's Written Answers page (KAN-385), on the origin they signed in on,
    // where a student without Claude pastes or writes the answers.
    case "batch/answers-page": {
      const session = await getSession();
      if (!session) throw new Error("Not signed in");
      return { url: `${session.web_origin}/auto-apply/answers` };
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

// The job system's answer to a batch tab's submit request (submit-proof.js)
// is what marks its application applied.
watchSubmitRequests(markSubmitted);
watchWorkdaySends();

// A batch tab that moves to a job system's page for a sent application
// (Greenhouse's confirmation, Lever's thanks): a hint, paired with Lever's
// form post (a plain HTML post, whose answer only redirects). Host
// permissions show the tab's link, with no `tabs` permission.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url || !submittedPage(change.url)) return;
  submitHinted(tabId, markSubmitted).catch((error) => console.warn("[batch] the application wasn't marked applied:", error.message));
});

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.status !== "complete") return;
  const tabs = await workdayTabs();
  // A batch tab on Workday too: its posting's Apply loads the sign-in as a new page (KAN-373).
  const batchWorkday = !tabs.includes(tabId) && jobOf(tab.url ?? "")?.site === "workday" && (await inBatch(tabId));
  if (!tabs.includes(tabId) && !batchWorkday) return;
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

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  forgetSubmits(tabId);
  await forgetTab(tabId, removeInfo);
  const tabs = await workdayTabs();
  if (tabs.includes(tabId)) await chrome.storage.session.set({ [WORKDAY_TABS_KEY]: tabs.filter((id) => id !== tabId) });
});

// A batch Chrome closed mid-way picks up where it stopped (batch.js), once
// each time Chrome starts. onStartup wakes this worker for it, but Chrome
// doesn't send it to an extension loaded with --load-extension (the tests'),
// so the worker's first start in a browser session does it too: session
// storage is empty only then.
const STARTED_KEY = "workit_started";
let resuming = null;
function resumeOnce() {
  resuming ??= (async () => {
    if ((await chrome.storage.session.get(STARTED_KEY))[STARTED_KEY]) return;
    await chrome.storage.session.set({ [STARTED_KEY]: true });
    await resumeBatch();
  })().catch((error) => console.warn("[batch] the batch didn't resume:", error));
  return resuming;
}
chrome.runtime.onStartup.addListener(resumeOnce);
resumeOnce();

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
