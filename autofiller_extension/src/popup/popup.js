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

  root.querySelector("#open-workit-button").addEventListener("click", async () => {
    const base = await webappUrl();
    chrome.tabs.create({ url: `${base}/auto-apply` });
    window.close();
  });
  // The one email and password for every company's Workday (src/options/), kept only in this browser.
  root.querySelector("#workday-signup-button").addEventListener("click", () => chrome.runtime.openOptionsPage());
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
