// The popup is a module script (popup.html's <script type="module">), so
// unlike the content-script.js family it can use real imports — but it
// still goes through chrome.runtime.sendMessage to reach auth.js/api.js
// rather than importing them directly, because the service worker is
// where state actually has to live (popup.js's own state is thrown away
// every time the popup closes).

import { DEV_WEB_URL, PROD_SITES } from "../shared/config.js";

const root = document.getElementById("root");

/** @param {{ type: string, [key: string]: any }} message */
function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

/** Same dev-first, prod-fallback pattern as api.js's apiUrl(), independently
 *  resolved here since this is just "which tab to open", not an API call —
 *  popup.js still never talks to the backend or Supabase directly. */
async function webappUrl() {
  if (DEV_WEB_URL === null) return PROD_SITES[0].web;
  try {
    const response = await fetch(DEV_WEB_URL, { signal: AbortSignal.timeout(1000) });
    if (response.ok || response.type === "opaque") return DEV_WEB_URL;
  } catch {
    // dev server isn't running — fall through to prod
  }
  return PROD_SITES[0].web;
}

function renderLoginView(errorText) {
  const template = document.getElementById("login-template");
  root.replaceChildren(template.content.cloneNode(true));

  const errorEl = root.querySelector(".error");
  if (errorText) {
    errorEl.textContent = errorText;
    errorEl.hidden = false;
  }

  root.querySelector("#open-webapp-button").addEventListener("click", async () => {
    const base = await webappUrl();
    chrome.tabs.create({ url: `${base}/login` });
  });
}

/**
 * The batch's status in a line: how many jobs are in it and how many are
 * filling, ready or need the student.
 * @param {{ total: number, filling: number, ready: number, needs: number }} batch
 */
function batchLine({ total, filling, ready, needs }) {
  const parts = [`${total} job${total === 1 ? "" : "s"} in your batch`];
  if (filling) parts.push(`${filling} filling`);
  if (ready) parts.push(`${ready} ready`);
  if (needs) parts.push(`${needs} need${needs === 1 ? "s" : ""} you`);
  return parts.join(" · ");
}

/**
 * The popup shows only off job pages (on one, the toolbar icon opens the
 * panel, KAN-394). It is tailored to what the student is doing (KAN-424,
 * background/popup-home.js), with the one next step as its button: during
 * a batch, the batch's status and Go to Next Job (the tab that needs them,
 * else a ready one); with no batch, the queue and Start Auto Apply; with an
 * empty queue, Find Jobs. Then Open WorkIt, as a quiet link. Workday
 * Sign-Up is not here (KAN-424): it read as "sign in to Workday" on every
 * page; it lives in the panel's Settings and the website's Settings.
 */
function renderSignedIn(profile) {
  const template = document.getElementById("signed-in-template");
  root.replaceChildren(template.content.cloneNode(true));

  root.querySelector(".name").textContent = profile.full_name;
  root.querySelector(".email").textContent = profile.email;
  void showHome();
  void showUnsupported();

  root.querySelector("#open-workit-button").addEventListener("click", async () => {
    const base = await webappUrl();
    chrome.tabs.create({ url: `${base}/auto-apply` });
    window.close();
  });
}

/** The popup's home: what the student is doing, and its next step (popup/home). */
async function showHome() {
  const home = await sendMessage({ type: "popup/home" });
  const box = root.querySelector(".home");
  if (!home?.ok || !box) return;
  const title = box.querySelector(".home-title");
  const line = box.querySelector(".batch-status");
  const action = box.querySelector("#home-action");
  const offer = (label, onPress) => {
    action.textContent = label;
    action.hidden = false;
    action.addEventListener("click", onPress, { once: true });
  };
  if (home.batch.total) {
    title.textContent = "Your Batch";
    line.textContent = batchLine(home.batch);
    if (home.batch.needs || home.batch.ready) {
      offer("Go to Next Job", async () => {
        await sendMessage({ type: "popup/next" });
        window.close();
      });
    }
  } else if (home.queued) {
    title.textContent = "Auto Apply";
    line.textContent = `${home.queued} job${home.queued === 1 ? "" : "s"} queued.`;
    offer("Start Auto Apply", async () => {
      action.disabled = true;
      action.textContent = "Opening…";
      const opened = await sendMessage({ type: "popup/start" });
      if (opened?.ok && opened.opened) return window.close();
      action.disabled = false;
      action.hidden = true;
      line.textContent = opened?.reason === "queue_empty" ? "Your queue is empty." : "WorkIt couldn't start your batch. Try again.";
    });
  } else if (home.queued === 0) {
    title.textContent = "Auto Apply";
    line.textContent = "Your queue is empty. Queue jobs on WorkIt to apply to them here.";
    offer("Find Jobs", async () => {
      chrome.tabs.create({ url: `${await webappUrl()}/jobs` });
      window.close();
    });
  } else return;
  box.hidden = false;
}

/** The tab the popup is for: the one its icon was pressed in (`?tab=`, which only the extension's own pages can open, for tests). */
async function pageTabId() {
  const asked = Number(new URLSearchParams(location.search).get("tab"));
  if (asked) return asked;
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
}

/**
 * A web page WorkIt can't fill (KAN-401; background/panel-states.js): says
 * so, with Save to WorkIt (the feed's job whose apply link the page is, to
 * the student's Applications), Request this job system (KAN-369: the page's
 * host only, once per host) and Report a problem (what it sends, then Send
 * report). Nothing leaves on opening the popup.
 */
async function showUnsupported() {
  const tabId = await pageTabId();
  const page = tabId ? await sendMessage({ type: "popup/page", tabId }) : null;
  if (!page?.ok || !page.unsupported) return;
  const box = root.querySelector(".unsupported");
  if (!box) return;
  box.hidden = false;
  const said = box.querySelector(".said");
  const say = (text, error = false) => {
    said.textContent = text;
    said.hidden = false;
    said.classList.toggle("error", error);
  };
  // Allow WorkIt on <host> (KAN-369, background/site-access.js): Chrome asks the student for this one site,
  // from this click (a permission request needs it); then the panel's scripts run there.
  const allow = box.querySelector("#allow-button");
  if (page.allowable) {
    allow.textContent = `Allow WorkIt on ${page.host}`;
    allow.hidden = false;
    box.querySelector(".allow-hint").hidden = false;
  }
  allow.addEventListener("click", async () => {
    allow.disabled = true;
    const granted = await chrome.permissions.request({ origins: [`https://${page.host}/*`] }).catch(() => false);
    allow.disabled = false;
    if (!granted) return say("WorkIt wasn't allowed on this site.", true);
    const answer = await sendMessage({ type: "popup/allow", tabId });
    if (!answer?.ok) return say("WorkIt couldn't start on this site. Try again.", true);
    allow.hidden = true;
    box.querySelector(".allow-hint").hidden = true;
    if (!answer.found) return say("WorkIt found no application it fills on this page. Request this job system to ask for it.");
    box.querySelector(".unsupported-line").textContent = "WorkIt can fill this page";
    for (const button of box.querySelectorAll("#save-button, #request-button, #report-button")) button.hidden = true;
    say(answer.onPage ? "Its panel is open at the right edge of the page." : "Open WorkIt's tab at the right edge of the application form.");
  });
  const save = box.querySelector("#save-button");
  save.addEventListener("click", async () => {
    save.disabled = true;
    const answer = await sendMessage({ type: "popup/save", tabId });
    save.disabled = false;
    if (answer?.ok) {
      save.hidden = true;
      return say("Saved to your Applications.");
    }
    // The route's own sentence when it has one ("WorkIt doesn't list this job yet."), never a status code.
    say(answer?.status === 404 ? answer.error : "WorkIt couldn't save this job. Try again.", true);
  });
  const request = box.querySelector("#request-button");
  if (page.requested) {
    request.hidden = true;
    say("You requested this job system.");
  }
  request.addEventListener("click", async () => {
    request.disabled = true;
    const answer = await sendMessage({ type: "popup/request", tabId });
    request.disabled = false;
    if (!answer?.ok) return say("WorkIt couldn't send the request. Try again.", true);
    request.hidden = true;
    say("Requested. WorkIt adds the job systems students ask for most.");
  });
  box.querySelector("#report-button").addEventListener("click", () => {
    const list = box.querySelector(".report-parts");
    const { job_system, posting_url, engine_version } = page.report;
    list.replaceChildren(
      ...[`Job system: ${job_system}`, `Link: ${posting_url}`, `Fill engine: ${engine_version}`].map((text) => Object.assign(document.createElement("li"), { textContent: text })),
    );
    box.querySelector("#report-note").maxLength = globalThis.WIA.reportParts.NOTE_MAX;
    box.querySelector(".report").hidden = false;
  });
  const send = box.querySelector("#send-report-button");
  send.addEventListener("click", async () => {
    send.disabled = true;
    const note = box.querySelector("#report-note").value.trim();
    const answer = await sendMessage({ type: "popup/report", tabId, note: note || null });
    send.disabled = false;
    if (!answer?.ok) return say("WorkIt couldn't send the report. Try again.", true);
    box.querySelector(".report").hidden = true;
    say("Sent. Thanks for telling WorkIt.");
  });
}

/** A request that failed: what didn't work, in a sentence, and Try again, which starts the popup over. */
function renderFailed(sentence) {
  const template = document.getElementById("failed-template");
  root.replaceChildren(template.content.cloneNode(true));
  root.querySelector(".failed").textContent = sentence;
  root.querySelector("#try-again-button").addEventListener("click", () => init());
}

async function init() {
  root.replaceChildren(Object.assign(document.createElement("p"), { className: "muted", textContent: "Checking…" }));

  const response = await sendMessage({ type: "auth/status" });
  if (!response.ok || !response.signedIn) {
    renderLoginView();
    return;
  }
  const profileResponse = await sendMessage({ type: "profile/get" });
  if (!profileResponse.ok && profileResponse.status === 401) return renderLoginView();
  // An extension older than the API serves (its 426, KAN-466): how to update.
  if (!profileResponse.ok && profileResponse.status === 426) return renderFailed(profileResponse.error);
  // Any other failed read (KAN-401): a plain sentence and Try again, never the request's status or words.
  if (!profileResponse.ok) return renderFailed("WorkIt couldn't load your profile.");
  renderSignedIn(profileResponse.profile);
}

init();
