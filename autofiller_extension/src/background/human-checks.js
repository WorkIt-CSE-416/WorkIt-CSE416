// Batch apply's human checks (Cloudflare's Turnstile, a CAPTCHA) where a
// tab's form should be, beside batch.js's startFill: the short turn in front
// that lets a managed check pass on its own.

import { formAfterHumanCheck } from "./tab-load.js";

// How long a check gets in front to pass on its own: Cloudflare's managed checks take a few seconds.
const IN_FRONT_MS = 5_000;

/**
 * Gives a batch tab's human check a short turn in front: Chrome holds back a
 * page in a tab no one sees, and a managed check often passes on its own once
 * seen. Only when the student isn't in the tab's window (it isn't the
 * focused window): WorkIt never takes the tab they look at from under them.
 * The window's own tab comes back after, unless they switched meanwhile.
 * Resolves whether the form showed.
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
export async function tryInFront(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const window = await chrome.windows.get(tab.windowId);
  // The student's window is the focused one that was focused last (headless Chrome calls every window focused).
  const theirs = window.focused && (await chrome.windows.getLastFocused()).id === tab.windowId;
  const [back] = !theirs && !tab.active ? await chrome.tabs.query({ windowId: tab.windowId, active: true }) : [];
  if (back) await chrome.tabs.update(tabId, { active: true });
  try {
    return await formAfterHumanCheck(tabId, IN_FRONT_MS);
  } finally {
    if (back && (await chrome.tabs.get(tabId).catch(() => null))?.active) await chrome.tabs.update(back.id, { active: true }).catch(() => {});
  }
}
