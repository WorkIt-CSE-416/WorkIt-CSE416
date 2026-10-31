// The service worker: owns the profile cache, and is the only place that
// talks to the WorkIt API. The popup and the on-demand content script both
// go through messages here rather than importing api.js/auth.js directly —
// a service worker can be killed and restarted by Chrome at any time, so
// it's the one place state actually has to live (chrome.storage), not a
// convenience layer. There's no session to own anymore (auth.js's own
// comment explains why) — just the cache.

import { getSession } from "./auth.js";
import {
  answerBank, answerFlag, anyFormAnswerBank, dropOwnAnswer, getAutofillProfile, warmProfile, generateEssayAnswer, ApiError, askQuestions, connectorAdded, me, saveAutofillAnswers, saveOwnAnswer, savePastedAnswer,
  writingSamples, writtenAnswers,
} from "./api.js";
import {
  batchStatus, batchTabIds, forgetTab, inBatch, jobInTab, jobTypeInTab, markSubmitted, unmarkSubmitted, practiceStatus, resumeBatch, setTabState, setWriting,
  showBatchTab, closeBatchTab, skipTab, closeClosedTab, startBatch, startPractice, submitPractice,
} from "./batch.js";
import { popupPage, reportTab, requestTabSystem, saveTabJob, webappOrigin } from "./panel-states.js";
import { engineCaller, handleFill, jobOf, practiceJob, runEngine, submittedPage } from "./engine.js";
import { claimMoment } from "./moments.js";
import { nextNeedsYou, walkFrom } from "./next-needs-you.js";
import { batchLine, jobForTab, showNextTab } from "./panel-top.js";
import { attachedFile, chooseResume, openJob, resumeTab, uploadAndChoose, withTabResume } from "./resume-tab.js";
import { addClaude, autoOpen, disconnectClaude, readSettings, setAutoOpen } from "./panel-settings.js";
import { previewReport, sendPreviewed } from "./report.js";
import { SELF_ID, checkedSelfId, unansweredSelfId } from "./self-id.js";
import { forgetSubmits, submitHinted, watchSubmitRequests } from "./submit-proof.js";
import { watchEmbeddedForms } from "./embedded-forms.js";
import { injectFill } from "../shared/content-scripts.js";
import { forgetShownWorkableDraft } from "./tab-load.js";
import { allowForMe, forgetLogin, markCreated, markRefused, markSignedIn, sentSince, watchWorkdaySends, workdayLogin } from "./workday-logins.js";
import { writeEarly } from "./write-early.js";
import { popupHome, showNextJob } from "./popup-home.js";
import { followTrackedTab, forgetTracked, isTracked, markTracked, track, trackState } from "./track.js";
import { allowTabSite, allowedSites, pageJobUrl, removeSite, syncSites } from "./site-access.js";
import { fetchText, planReads } from "./plan-reads.js";
import { treeStore } from "./stored-data.js";

/**
 * Calls the Fill engine in the frame that sent `sender`'s message: the
 * engine runs in the page's MAIN world (content-scripts.js's ENGINE_FILES),
 * which the content script, in its isolated world, can't call itself.
 * @param {chrome.runtime.MessageSender} sender
 */
/**
 * A submit proven in tab `tabId` (submit-proof.js): a batch tab's marks its
 * application (batch.js markSubmitted), a tracked tab's its job (track.js
 * markTracked, KAN-424); any other tab's marks nothing.
 */
async function markAnySubmitted(tabId) {
  return (await inBatch(tabId)) ? markSubmitted(tabId) : markTracked(tabId);
}

// The submit watches a page's fill asked for while its tab wasn't tracked (batch/watch): started by Track on WorkIt.
const unwatched = new Map();

function engineIn(sender) {
  const target = { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] };
  return engineCaller(async (request) => {
    const [injection] = await chrome.scripting.executeScript({ target, world: "MAIN", func: runEngine, args: [request] });
    return injection?.result;
  });
}

// The nested prompts the engine read on each Workday tenant (fill/plan, fill/page), kept for its next fill, capped (stored-data.js).
const workdayTrees = treeStore(chrome.storage.local);

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
    case "fill/required":
    case "fill/next": {
      const plan = message.type === "fill/plan";
      // A Plan's profile and batch reads are asked at once; the job's saved answers are fetched while
      // the engine reads the job's questions (planFill waits for them only to plan).
      const [profile, jobId, typed] = await Promise.all([
        // The résumé the student switched this tab to (resume-tab.js) in place of the default.
        getAutofillProfile().then((p) => withTabResume(p, sender.tab?.id)),
        plan ? jobInTab(sender.tab.id) : null,
        // Its job type picks the start date: a full-time role's is graduation, an internship's its start.
        plan ? jobTypeInTab(sender.tab.id) : null,
      ]);
      const jobType = jobId ? typed : null;
      if (message.type === "fill/plan" && jobOf(sender.url)?.site === "workday") {
        await rememberWorkdayTab(sender.tab.id);
        // An application step shows: the saved login (if any) signs in to this tenant.
        await markSignedIn(jobOf(sender.url).tenant);
      }
      // A Plan uses the answers the student saved (KAN-379), read fresh for each Plan: one saved a
      // moment ago in another tab counts. A batch tab's are its application's; any other page has no
      // application, so it gets the bank for the page's company, once the engine has read it.
      const bank = !plan ? {}
        : jobId ? answerBank(profile.id, jobId).catch(() => ({}))
        : (company) => anyFormAnswerBank(profile.id, company).catch(() => ({}));
      // On a site the student allowed (site-access.js), the link the engine reads for the page.
      const url = (await pageJobUrl(sender.tab?.id, sender.frameId ?? 0, sender.url ?? "")) ?? sender.url;
      const answer = await handleFill(message, {
        url, profile, bank, today: today(), call: engineIn(sender), fetchText: plan ? planReads(sender.tab.id) : fetchText, trees: workdayTrees, jobType,
      });
      // TikTok's sign-in, the student's to go through: the tab is remembered, and its form fills once it shows.
      if (message.type === "fill/plan" && answer.signIn) await rememberSignInTab(sender.tab.id);
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

    // The consent card's Set One Password (overlay.js): the Workday Sign-Up page (src/options/).
    case "workday/signup-open":
      return chrome.runtime.openOptionsPage();

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

    // A batch tab's job system says the job is closed (content-script.js): it leaves the batch marked closed.
    case "batch/closed":
      return closeClosedTab(sender.tab.id);

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

    // A written answer's Rewrite (KAN-424, overlay.js): another version from the student's Claude, with how to change it.
    case "batch/redo": {
      const jobId = await jobInTab(sender.tab.id);
      if (!jobId) throw new Error("This tab isn't one of the batch's");
      const { id } = await me();
      const steer = typeof message.steer === "string" ? message.steer.trim().slice(0, 300) : "";
      await answerFlag(id, jobId, "redo", message.name, steer || undefined);
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
    // A tab the student tracks on WorkIt (KAN-424, track.js) is watched the same way: every fill asks, and a tab
    // not tracked yet keeps its key here until Track on WorkIt starts its watch.
    case "batch/watch": {
      const job = jobOf(sender.url);
      // A practice form's submit is its thanks page's (submitPractice below), never an application's.
      const site = job && !job.practice ? job.site : null;
      if (!site) return { watching: false };
      if ((await inBatch(sender.tab.id)) || (await isTracked(sender.tab.id))) {
        await engineIn(sender)("watchSubmit", site, message.key);
        return { watching: true };
      }
      unwatched.set(sender.tab.id, { site, key: message.key, frameId: sender.frameId ?? 0 });
      return { watching: false };
    }

    case "batch/submitted": {
      const batch = await inBatch(sender.tab.id);
      // A tab nobody tracks: its submit is the student's own business, and nothing is marked.
      if (!batch && !(await isTracked(sender.tab.id))) return { applied: false, untracked: true };
      return { applied: await submitHinted(sender.tab.id, markAnySubmitted, jobOf(sender.url)?.site), batch };
    }

    // Track on WorkIt (KAN-424, track.js): what the panel offers on this tab, and the student's press.
    case "track/state":
      return trackState({ tabId: sender.tab.id, url: (await pageJobUrl(sender.tab.id, sender.frameId ?? 0, sender.url ?? "")) ?? sender.url ?? "" });
    case "track/start": {
      const tracked = await track({ tabId: sender.tab.id, url: (await pageJobUrl(sender.tab.id, sender.frameId ?? 0, sender.url ?? "")) ?? sender.url ?? "" });
      // A fill on this page asked to watch before the tab was tracked: its watch starts now.
      const waiting = unwatched.get(sender.tab.id);
      if (waiting && tracked.state === "tracked") {
        unwatched.delete(sender.tab.id);
        await engineIn({ tab: sender.tab, frameId: waiting.frameId })("watchSubmit", waiting.site, waiting.key).catch(() => {});
      }
      return tracked;
    }

    // The panel's "I submitted this" (the student's own click): a submit the job system's answer
    // didn't show (detection missed it), marked applied on the student's word.
    case "batch/i-submitted":
      return { applied: (await markSubmitted(sender.tab.id)).batch };
    // The panel's "I didn't submit this" (panel-states.js, KAN-401): the applied mark goes back.
    case "batch/unsubmitted":
      return unmarkSubmitted(sender.tab.id);

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

    // The panel's shell (panel.js, KAN-394): whether this page is a job page WorkIt
    // covers, whether the tab is a batch's, and the site's kept choices. On a job
    // page the toolbar icon opens and closes the panel, so the tab has no popup.
    case "panel/where": {
      const url = sender.url ?? "";
      const job = Boolean(await pageJobUrl(sender.tab?.id, sender.frameId ?? 0, url));
      if (job && sender.tab?.id !== undefined) await chrome.action.setPopup({ tabId: sender.tab.id, popup: "" });
      // A job page's panel will plan a fill: its profile is fetched while the page settles.
      if (job) warmProfile();
      return { job, batch: sender.tab ? await inBatch(sender.tab.id) : false, site: await panelSite(url), autoOpen: await autoOpen() };
    }
    case "panel/site":
      return { site: await panelSite(sender.url ?? "", message.set) };
    // The panel's Autofill This Page and Fill Again: the fill, in the frame that asked (a batch tab stays one).
    // Signed out (panel-states.js, KAN-401): the panel's Sign in to WorkIt opens the webapp's sign-in.
    case "panel/sign-in":
      await chrome.tabs.create({ url: `${await webappOrigin()}/login`, openerTabId: sender.tab?.id });
      return {};
    // The toolbar popup on a site WorkIt can't fill (popup.js, KAN-401).
    case "popup/page":
      return popupPage(message.tabId);
    case "popup/save":
      return saveTabJob(message.tabId);
    case "popup/report":
      return reportTab(message.tabId, message.note);
    case "popup/request":
      return requestTabSystem(message.tabId);
    // Allow WorkIt on <host> (popup.js, KAN-369): the popup's permission request was granted.
    case "popup/allow": {
      const allowed = await allowTabSite(message.tabId);
      if (allowed.onPage) await openShell(message.tabId, false);
      return allowed;
    }
    // The options page's allowed sites, and its Remove.
    case "sites/list":
      return { sites: await allowedSites() };
    case "sites/remove":
      return removeSite(message.origin);
    case "panel/fill":
      await injectFill(sender.tab.id, { batch: Boolean(message.batch) && (await inBatch(sender.tab.id)), frameId: sender.frameId || undefined });
      return {};
    // The panel's top (panel-top.js, KAN-395): the job card's job, and the batch line.
    case "panel/job":
      return { job: await jobForTab({ tabId: sender.tab.id, url: (await pageJobUrl(sender.tab.id, sender.frameId ?? 0, sender.url ?? "")) ?? sender.url ?? "" }) };
    case "panel/batch-line":
      return { line: await batchLine(sender.tab.id), site: jobOf(sender.url ?? "")?.site ?? null };
    case "panel/next-tab":
      return showNextTab(sender.tab.id);
    // The Resume/CV row's card (content resume-card.js; background resume-tab.js, KAN-399, KAN-424).
    case "resume/tab":
      return resumeTab({ tabId: sender.tab.id, url: sender.url ?? "" });
    case "resume/file":
      return { file: await attachedFile(sender.tab.id) };
    case "resume/choose":
      return chooseResume({ tabId: sender.tab.id, url: sender.url ?? "", key: message.key });
    case "resume/upload":
      return uploadAndChoose({ tabId: sender.tab.id, url: sender.url ?? "", file: message.file });
    case "panel/open-job":
      return openJob({ tabId: sender.tab.id, url: sender.url ?? "" });
    // Report a problem (report.js, KAN-403): what the card previews, and its Send.
    // The draft is the card's (its values already out); the background keeps the allowed parts and keeps them for Send.
    case "report/preview":
      return previewReport(sender, message.draft);
    case "report/send":
      return sendPreviewed(sender, { marked: message.marked, note: message.note });
    // The panel's settings view (panel-settings.js, KAN-402): the Claude connection and auto-open.
    case "settings/read":
      return readSettings();
    case "settings/claude-add":
      return addClaude(sender.tab?.id);
    case "settings/claude-disconnect":
      return disconnectClaude();
    case "settings/auto-open":
      return setAutoOpen(message.on);
    // The toolbar popup off job pages: the batch's status, and (KAN-424) what the student is doing, with its next step.
    case "popup/batch":
      return batchStatus();
    // Only the popup's own page may switch tabs or open a batch (a content script's sender is the job page,
    // never the extension's popup.html), so a page's script can't press these.
    case "popup/home":
      return fromPopup(sender) ? popupHome() : { error: "not_popup" };
    case "popup/next":
      return fromPopup(sender) ? showNextJob() : { error: "not_popup" };
    // Start Auto Apply from the popup: the webapp's own run/open, in the popup's window.
    case "popup/start":
      return fromPopup(sender) ? RUNNER_MESSAGES["run/open"](message, {}) : { error: "not_popup" };

    // The panel's font (panel.js's loadFont), as base64: the page can't
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
// is what marks its application applied; a tracked tab's too (KAN-424).
watchSubmitRequests(markAnySubmitted);
watchEmbeddedForms();
// The employer sites the student allowed keep their scripts; one whose permission went is dropped (site-access.js).
syncSites().catch((error) => console.warn("[sites] the allowed sites weren't synced:", error.message));
chrome.permissions.onRemoved.addListener(() => void syncSites().catch(() => {}));
watchWorkdaySends();

// A batch tab that moves to a job system's page for a sent application
// (Greenhouse's confirmation, Lever's thanks): a hint, paired with Lever's
// form post (a plain HTML post, whose answer only redirects). Host
// permissions show the tab's link, with no `tabs` permission.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url) return;
  // A tracked tab that moves to another job's page stops being tracked (track.js).
  followTrackedTab(tabId, change.url).catch(() => {});
  if (!submittedPage(change.url)) return;
  submitHinted(tabId, markAnySubmitted).catch((error) => console.warn("[batch] the application wasn't marked applied:", error.message));
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

// Tabs a fill found on a careers site's own sign-in (TikTok's, ByteDance's:
// planFill's `signIn`), which the student goes through themselves. Once the
// tab reaches the form (a new page, or the site's own move to it in the
// page), the fill runs there, once; a tab that leaves the site is forgotten.
const SIGN_IN_TABS_KEY = "sign_in_fill_tabs";

async function signInTabs() {
  return (await chrome.storage.session.get(SIGN_IN_TABS_KEY))[SIGN_IN_TABS_KEY] ?? [];
}

async function rememberSignInTab(tabId) {
  const tabs = await signInTabs();
  if (!tabs.includes(tabId)) await chrome.storage.session.set({ [SIGN_IN_TABS_KEY]: [...tabs, tabId] });
}

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (tab.status !== "complete" || (!change.url && change.status !== "complete")) return;
  const tabs = await signInTabs();
  if (!tabs.includes(tabId)) return;
  const job = jobOf(tab.url ?? "");
  if (job?.site === "tiktok" && !job.onForm) return; // still signing in
  await chrome.storage.session.set({ [SIGN_IN_TABS_KEY]: tabs.filter((id) => id !== tabId) });
  if (job?.onForm) injectFill(tabId, { batch: await inBatch(tabId) }).catch((error) => console.warn("[fill] the form after sign-in wasn't filled:", error));
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
  unwatched.delete(tabId);
  await forgetTracked(tabId);
  await forgetTab(tabId, removeInfo);
  const tabs = await workdayTabs();
  if (tabs.includes(tabId)) await chrome.storage.session.set({ [WORKDAY_TABS_KEY]: tabs.filter((id) => id !== tabId) });
  const signingIn = await signInTabs();
  if (signingIn.includes(tabId)) await chrome.storage.session.set({ [SIGN_IN_TABS_KEY]: signingIn.filter((id) => id !== tabId) });
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

// The panel's choices per site (panel.js): { top, collapsed, hidden }, by host name.
const PANEL_SITES_KEY = "panel_sites";
async function panelSite(url, change) {
  let site;
  try {
    site = new URL(url).hostname;
  } catch {
    return {};
  }
  const sites = (await chrome.storage.local.get(PANEL_SITES_KEY))[PANEL_SITES_KEY] ?? {};
  if (!change) return sites[site] ?? {};
  sites[site] = { ...sites[site], ...change };
  await chrome.storage.local.set({ [PANEL_SITES_KEY]: sites });
  return sites[site];
}

// What the panel's shell injects when the toolbar icon or Alt+W finds no panel on a job page yet.
const SHELL_FILES = ["src/shared/tokens.js", "src/content/ui.js", "src/shared/report-parts.js", "src/content/panel.js", "src/content/panel-top.js", "src/content/resume-card.js", "src/content/panel-settings.js", "src/content/report.js", "src/content/panel-states.js"];

/** Opens the panel's shell in the tab's top frame, as the toolbar icon does on a job page with no edge tab yet
 * (`inject`: its files first; an allowed site's were just injected with the launcher). */
async function openShell(tabId, inject = true) {
  if (inject) await chrome.scripting.executeScript({ target: { tabId }, files: SHELL_FILES });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      const panel = window.WIA.panel;
      await panel.ensure();
      if (!window.WIA.overlay?.state?.()) await window.WIA.panelStates.start();
      panel.open();
    },
  });
}

/**
 * The toolbar icon (a tab with no popup: a job page, panel/where) and
 * Alt+W: open or close the panel in whichever frame has it. A job page whose
 * edge tab isn't drawn yet gets the shell, open; any other page gets the
 * popup (the batch's status), as a tab with a popup would.
 * @param {chrome.tabs.Tab} tab
 */
async function toolbarPressed(tab) {
  if (!tab?.id) return;
  const answer = await chrome.tabs.sendMessage(tab.id, { type: "panel/toggle" }).catch(() => null);
  if (answer?.toggled) return;
  if (await pageJobUrl(tab.id, 0, tab.url ?? "")) return openShell(tab.id);
  await chrome.action.setPopup({ tabId: tab.id, popup: chrome.runtime.getManifest().action.default_popup });
  await chrome.action.openPopup().catch(() => {});
}
chrome.action.onClicked.addListener((tab) => void toolbarPressed(tab).catch((error) => console.warn("[panel] the toolbar press did nothing:", error.message)));
/**
 * The extension's commands (manifest.json): Alt+W opens or closes the panel;
 * Alt+N presses its Next Thing (KAN-396) in whichever frame has the button
 * (primary.js answers "panel/next"; a page without one does nothing).
 * @param {string} command
 * @param {chrome.tabs.Tab} [tab]
 */
async function commandPressed(command, tab) {
  tab ??= (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (command === "toggle-panel") await toolbarPressed(tab).catch((error) => console.warn("[panel] Alt+W did nothing:", error.message));
  if (command === "next-thing" && tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "panel/next" }).catch(() => null);
}
chrome.commands.onCommand.addListener((command, tab) => void commandPressed(command, tab));
// The tests' way to press the toolbar icon and the commands' keys, which Chrome gives no page a way to press.
globalThis.workitToolbar = toolbarPressed;
globalThis.workitCommand = commandPressed;

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
// asked. The other three only say which job postings the batch's tabs show,
// switch to one of them, or close one (Up Next's Remove); `jobId`
// picks among the batch's own tabs only.
// Onboarding's practice batch (KAN-378) takes links, but only to WorkIt's own
// practice forms on the asking page's site (batch.js, `startPractice`).
/** Up Next's picked jobs from `run/open`: job ids only (UUIDs), at most 100; anything else counts as none. */
function pickedJobs(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)).slice(0, 100);
}

const RUNNER_MESSAGES = {
  "run/open": async (message, sender) => {
    const opened = await startBatch(sender, pickedJobs(message.jobIds));
    // Not awaited: the webapp hears once the tabs open; the queue's other questions are read meanwhile (KAN-379).
    if (opened.opened) writeEarly({ fetchText, today: today() }).catch((error) => console.warn("[batch] questions not read early:", error.message));
    return opened;
  },
  "run/status": () => batchStatus(),
  "run/show": (message) => showBatchTab(message),
  "run/close": (message) => closeBatchTab(message),
  "practice/open": (message, sender) => startPractice(sender, message),
  "practice/status": () => practiceStatus(),
  // The webapp's Settings > Connected Apps: opens the Workday Sign-Up page, which keeps its password in this browser.
  "workday/signup-open": async () => {
    await chrome.runtime.openOptionsPage();
    return {};
  },
};

/** Whether a message comes from the extension's own popup page (its URL), not a content script on a page. */
const fromPopup = (sender) => sender.id === chrome.runtime.id && (sender.url ?? "").startsWith(chrome.runtime.getURL("src/popup/"));

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
      .then(([session, isPinned]) => {
        // The webapp asks as its pages open (Auto Apply's among them): the profile is fetched now, before a batch waits for it.
        if (session) warmProfile();
        sendResponse({ ok: true, installed: true, signedIn: Boolean(session), pinned: isPinned });
      });
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
