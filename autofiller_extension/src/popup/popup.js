// The popup is a module script (popup.html's <script type="module">), so
// unlike the content-script.js family it can use real imports — but it
// still goes through chrome.runtime.sendMessage to reach auth.js/api.js
// rather than importing them directly, because the service worker is
// where state actually has to live (popup.js's own state is thrown away
// every time the popup closes).

import { DEV_WEB_URL, PROD_SITES } from "../shared/config.js";
import { injectFill } from "../shared/content-scripts.js";

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
 * WorkIt's panel on the tab, if a fill left one there (overlay.js's state,
 * asked in every frame: an embedded form's panel is in its frame): its
 * frame, whether it shows, whether the tab is a batch tab, and the phase.
 * Null when nothing was filled, or WorkIt can't run on the page.
 */
async function panelOn(tabId) {
  const frames = await chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, func: () => window.WIA?.overlay?.state?.() ?? null })
    .catch(() => []);
  const found = frames.find((frame) => frame.result);
  return found ? { frameId: found.frameId, ...found.result } : null;
}

function renderSignedIn(profile) {
  const template = document.getElementById("signed-in-template");
  root.replaceChildren(template.content.cloneNode(true));

  root.querySelector(".name").textContent = profile.full_name;
  root.querySelector(".email").textContent = profile.email;
  root.querySelector(".bank-status").textContent = profile.bank
    ? "Experience bank has data"
    : "Your experience bank is empty — add entries in WorkIt first";

  // The one email and password for every company's Workday (src/options/), kept only in this browser.
  root.querySelector("#workday-signup-button").addEventListener("click", () => chrome.runtime.openOptionsPage());

  // A page WorkIt already filled (KAN-369): its panel comes back as it was, no fill; Fill Again starts over.
  let panel = null;
  const autofill = root.querySelector("#autofill-button");
  const showPanel = root.querySelector("#show-panel-button");
  chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
    panel = tab?.id ? await panelOn(tab.id) : null;
    if (!panel) return;
    showPanel.hidden = false;
    autofill.textContent = "Fill Again";
    autofill.classList.add("secondary");
    autofill.hidden = panel.phase === "filling";
    root.querySelector(".hint").textContent =
      panel.phase === "filling" ? "WorkIt is filling this page now." : "WorkIt already filled this page. Show its panel, or fill the page again from the start.";
    showPanel.addEventListener("click", async () => {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [panel.frameId] }, func: () => window.WIA?.overlay?.open?.() });
      window.close();
    });
  });

  autofill.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Filling…";
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab");
      // Filled again where it was filled: a batch tab stays one, an embedded form's frame is filled alone.
      await injectFill(tab.id, panel ? { batch: panel.batch, frameId: panel.frameId || undefined } : undefined);
      window.close(); // the on-page overlay takes over from here
    } catch (error) {
      button.textContent = label;
      button.disabled = false;
      const hint = root.querySelector(".hint");
      hint.textContent =
        error instanceof Error && error.message.includes("Cannot access")
          ? "Can't run on this page (browser settings or an extension gallery page)."
          : "Something went wrong starting autofill. Try reloading the page.";
    }
  });
}

async function init() {
  root.replaceChildren(Object.assign(document.createElement("p"), { className: "muted", textContent: "Checking…" }));

  const response = await sendMessage({ type: "auth/status" });
  if (!response.ok || !response.signedIn) {
    renderLoginView();
    return;
  }
  const profileResponse = await sendMessage({ type: "profile/get" });
  if (!profileResponse.ok) {
    renderLoginView(profileResponse.error);
    return;
  }
  renderSignedIn(profileResponse.profile);
}

init();
