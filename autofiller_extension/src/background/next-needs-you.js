// Batch apply's "Next Thing That Needs You" (KAN-375), beside batch.js:
// a walk through the batch's tabs and each tab's flagged fields.

import { liveBatch } from "./batch-store.js";

// Where "Next Thing That Needs You" last went: { tabId, key, index }, index
// being the key's place among its tab's flagged rows then.
const CURSOR_KEY = "workit_batch_next";

/**
 * "Next Thing That Needs You" (the overlay's button in a batch tab, KAN-375):
 * goes to the first thing that needs the student after the last one it went
 * to, walking the batch's tabs in the order they opened and each tab's
 * flagged fields in page order (each tab's content script names them,
 * "batch/flags"). It switches to that tab and has it show the field
 * ("batch/focus"). A tab with no content script to answer (nothing was
 * filled there) is one thing, the page itself. Past the last one it answers
 * `done`, and the next press starts again from the first. Fields the student
 * fixed meanwhile are no longer flagged, so they are passed over.
 * @returns {Promise<{ done: true } | { done: false, tabId: number, key: string | null }>}
 */
export async function nextNeedsYou() {
  const batch = await liveBatch();
  const order = Object.entries(batch?.tabs ?? {})
    .sort(([, a], [, b]) => batch.opened.indexOf(a.jobId) - batch.opened.indexOf(b.jobId))
    .map(([id, tab]) => ({ tabId: Number(id), state: tab.state }));
  const things = [];
  for (const [place, { tabId, state }] of order.entries()) {
    const answer = await chrome.tabs.sendMessage(tabId, { type: "batch/flags" }).catch(() => null);
    if (answer) answer.keys.forEach((key, index) => things.push({ place, tabId, key, index }));
    else if (state === "needs_you" || state === "failed") things.push({ place, tabId, key: null, index: 0 });
  }
  const cursor = (await chrome.storage.session.get(CURSOR_KEY))[CURSOR_KEY];
  const from = cursor ? order.findIndex((t) => t.tabId === cursor.tabId) : -1;
  const stillThere = cursor && things.some((t) => t.tabId === cursor.tabId && t.key === cursor.key);
  const next = !cursor || from < 0 ? things[0] : things.find((t) =>
    t.place > from || (t.place === from && (stillThere ? t.index > things.find((c) => c.tabId === cursor.tabId && c.key === cursor.key).index : t.index >= cursor.index)));
  if (!next) {
    await chrome.storage.session.remove(CURSOR_KEY);
    return { done: true };
  }
  await chrome.storage.session.set({ [CURSOR_KEY]: { tabId: next.tabId, key: next.key, index: next.index } });
  const tab = await chrome.tabs.update(next.tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  if (next.key !== null) await chrome.tabs.sendMessage(next.tabId, { type: "batch/focus", key: next.key }).catch(() => {});
  return { done: false, tabId: next.tabId, key: next.key };
}
