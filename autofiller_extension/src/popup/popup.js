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

  root.querySelector("#recheck-button").addEventListener("click", () => init());
}

/**
 * The batch's status in a line (background.js popup/batch): how many jobs
 * are in it and how many are ready or need the student.
 * @param {{ jobs: { state: string }[] }} status
 */
function batchLine({ jobs }) {
  if (!jobs.length) return "No batch running.";
  const count = (state) => jobs.filter((job) => job.state === state).length;
  const parts = [`${jobs.length} job${jobs.length === 1 ? "" : "s"} in your batch`];
  const filling = count("filling");
  const ready = count("ready");
  const needs = count("needs_you") + count("failed");
  if (filling) parts.push(`${filling} filling`);
  if (ready) parts.push(`${ready} ready`);
  if (needs) parts.push(`${needs} need${needs === 1 ? "s" : ""} you`);
  return parts.join(" · ");
}

/**
 * The popup shows only off job pages (on one, the toolbar icon opens the
 * panel, KAN-394): who is signed in, the batch's status and Open WorkIt.
 */
function renderSignedIn(profile) {
  const template = document.getElementById("signed-in-template");
  root.replaceChildren(template.content.cloneNode(true));

  root.querySelector(".name").textContent = profile.full_name;
  root.querySelector(".email").textContent = profile.email;
  sendMessage({ type: "popup/batch" }).then((status) => {
    root.querySelector(".batch-status").textContent = status?.ok ? batchLine(status) : "";
  });

  void showUnsupported();

  root.querySelector("#open-workit-button").addEventListener("click", async () => {
    const base = await webappUrl();
    chrome.tabs.create({ url: `${base}/auto-apply` });
    window.close();
  });
  // The one email and password for every company's Workday (src/options/), kept only in this browser.
  root.querySelector("#workday-signup-button").addEventListener("click", () => chrome.runtime.openOptionsPage());
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
 * the student's Applications) and Report a problem (what it sends, then
 * Send report). Nothing leaves on opening the popup.
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
  // Any other failed read (KAN-401): a plain sentence and Try again, never the request's status or words.
  if (!profileResponse.ok) return renderFailed("WorkIt couldn't load your profile.");
  renderSignedIn(profileResponse.profile);
}

init();
