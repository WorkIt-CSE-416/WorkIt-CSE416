// Batch apply's "Next Thing That Needs You" (KAN-375), beside batch.js:
// a walk through the batch's tabs and each tab's flagged fields.

import { liveBatch } from "./batch-store.js";

// Where "Next Thing That Needs You" last went: { tabId, place, key, rank }: the tab's place in the
// order the batch opened, and the key's place among all its tab's rows then (`rank`, by `order`).
const CURSOR_KEY = "workit_batch_next";

/**
 * "Next Thing That Needs You" (the overlay's button in a batch tab, KAN-375):
 * goes to the first thing that needs the student after the last one it went
 * to, walking the batch's tabs in the order they opened and each tab's
 * flagged fields in page order (each tab's content script names them,
 * "batch/flags", with every row in page order). It switches to that tab and
 * has it show the field ("batch/focus"). A tab with no content script to
 * answer (nothing was filled there) is one thing, the page itself. Past the
 * last one it answers `done`, and the next press starts again from the
 * first. Fields the student fixed meanwhile are no longer flagged, so they
 * are passed over; the walk goes on after the row it was on by that row's
 * place on the page, which stays when it is answered (and after a closed
 * tab by the tab's place in the batch).
 * @returns {Promise<{ done: true } | { done: false, tabId: number, key: string | null }>}
 */
export async function nextNeedsYou() {
  const batch = await liveBatch();
  const order = Object.entries(batch?.tabs ?? {})
    .map(([id, tab]) => ({ tabId: Number(id), state: tab.state, place: batch.opened.indexOf(tab.jobId) }))
    .sort((a, b) => a.place - b.place);
  const cursor = (await chrome.storage.session.get(CURSOR_KEY))[CURSOR_KEY];
  let after = cursor?.rank ?? -1;
  const things = [];
  for (const { tabId, state, place } of order) {
    const answer = await chrome.tabs.sendMessage(tabId, { type: "batch/flags" }).catch(() => null);
    if (answer) {
      if (cursor?.tabId === tabId && answer.order.includes(cursor.key)) after = answer.order.indexOf(cursor.key);
      for (const key of answer.keys) things.push({ place, tabId, key, rank: answer.order.indexOf(key) });
    } else if (state === "needs_you" || state === "failed") things.push({ place, tabId, key: null, rank: 0 });
  }
  const next = cursor ? things.find((t) => t.place > cursor.place || (t.place === cursor.place && t.rank > after)) : things[0];
  if (!next) {
    await chrome.storage.session.remove(CURSOR_KEY);
    return { done: true };
  }
  await chrome.storage.session.set({ [CURSOR_KEY]: { tabId: next.tabId, place: next.place, key: next.key, rank: next.rank } });
  const tab = await chrome.tabs.update(next.tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  if (next.key !== null) await chrome.tabs.sendMessage(next.tabId, { type: "batch/focus", key: next.key }).catch(() => {});
  return { done: false, tabId: next.tabId, key: next.key };
}

/**
 * Starts "Next Thing That Needs You" at one of a tab's rows (the submit
 * warning's Show me, content/submit-warning.js): the tab shows it, and the
 * next press goes on after it. Answers false outside a batch.
 * @param {number} tabId
 * @param {string} key
 */
export async function walkFrom(tabId, key) {
  const batch = await liveBatch();
  const tab = batch?.tabs?.[tabId];
  if (!tab) return false;
  const answer = await chrome.tabs.sendMessage(tabId, { type: "batch/flags" }).catch(() => null);
  const rank = answer?.order.indexOf(key) ?? -1;
  await chrome.storage.session.set({ [CURSOR_KEY]: { tabId, place: batch.opened.indexOf(tab.jobId), key, rank } });
  await chrome.tabs.sendMessage(tabId, { type: "batch/focus", key }).catch(() => {});
  return true;
}
