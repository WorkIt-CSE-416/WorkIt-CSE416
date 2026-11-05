// S2 ops: navigation, load states, frames and screenshots of a Worker's tabs.

import { capture, inPage, named, sleep } from "./shared.js";

// Resolves once the tab's top frame reaches `waitUntil` ("commit", "domcontentloaded" or "load")
// after a navigation that starts from now; rejects on a failed navigation, a closed tab or the timeout.
// Set it up before starting the navigation.
function navigation(tab, waitUntil = "load", timeout = 30000, what = "page.goto") {
  let finish, fail;
  const done = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  let committed = false;
  const top = (d) => d.tabId === tab && d.frameId === 0;
  const onCommitted = (d) => { if (top(d)) { committed = true; if (waitUntil === "commit") end(); } };
  const onDom = (d) => { if (top(d) && committed && waitUntil === "domcontentloaded") end(); };
  const onCompleted = (d) => { if (top(d) && committed) end(); };
  const onFragment = (d) => { if (top(d)) { committed = true; end(); } };
  const onError = (d) => { if (top(d)) end(named("NavigationError", `${what}: ${d.error} at ${d.url}`)); };
  const onRemoved = (id) => { if (id === tab) end(named("NoTab", `${what}: Target page, context or browser has been closed`)); };
  const timer = setTimeout(() => end(named("TimeoutError", `${what}: Timeout ${timeout}ms exceeded.`)), timeout);
  const listeners = [
    [chrome.webNavigation.onCommitted, onCommitted], [chrome.webNavigation.onDOMContentLoaded, onDom],
    [chrome.webNavigation.onCompleted, onCompleted], [chrome.webNavigation.onReferenceFragmentUpdated, onFragment],
    [chrome.webNavigation.onErrorOccurred, onError], [chrome.tabs.onRemoved, onRemoved],
  ];
  for (const [event, listener] of listeners) event.addListener(listener);
  function end(error) {
    clearTimeout(timer);
    for (const [event, listener] of listeners) event.removeListener(listener);
    if (error) fail(error);
    else finish();
  }
  return { done, cancel: () => end(named("Crash", "cancelled")) };
}

async function info(tab) {
  const t = await chrome.tabs.get(tab);
  return { url: t.url || t.pendingUrl || "", title: t.title || "" };
}

async function goto({ tab, url, waitUntil = "load", timeout = 30000 }) {
  const waiting = navigation(tab, waitUntil, timeout);
  try {
    await chrome.tabs.update(tab, { url });
  } catch (error) {
    waiting.cancel();
    waiting.done.catch(() => {});
    throw error;
  }
  await waiting.done;
  return info(tab);
}

async function reload({ tab, waitUntil = "load", timeout = 30000 }) {
  const waiting = navigation(tab, waitUntil, timeout, "page.reload");
  await chrome.tabs.reload(tab);
  await waiting.done;
  return info(tab);
}

// Resolves once the tab's top document has reached `state`, now or later.
async function waitForLoad({ tab, state = "load", timeout = 30000 }) {
  const deadline = Date.now() + timeout;
  for (;;) {
    let ready = "loading";
    try {
      ready = await inPage({ tab }, "ISOLATED", () => document.readyState);
    } catch {
      // a navigation is between documents: try again
    }
    const t = await chrome.tabs.get(tab);
    if (state === "domcontentloaded" ? ready !== "loading" : ready === "complete" && t.status === "complete") {
      if (state === "networkidle") await sleep(500);
      return null;
    }
    if (Date.now() > deadline) throw named("TimeoutError", `page.wait_for_load_state: Timeout ${timeout}ms exceeded.`);
    await sleep(100);
  }
}

// captureVisibleTab allows about 2 calls a second per browser: the shared gate spaces them, and this waits out the quota.
async function screenshot({ tab, format = "png", quality }) {
  const t = await chrome.tabs.get(tab);
  if (!t.active) {
    await chrome.tabs.update(tab, { active: true });
    await sleep(150);
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const url = await capture(t.windowId, format === "jpeg" ? { format, quality: quality ?? 80 } : { format: "png" });
      return { data: url.slice(url.indexOf(",") + 1) };
    } catch (error) {
      if (attempt < 10 && /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(String(error?.message))) {
        await sleep(550);
        continue;
      }
      throw error;
    }
  }
}

export const ops = {
  "tabs.goto": goto,
  "tabs.reload": reload,
  "tabs.waitForLoad": waitForLoad,
  "tabs.activate": async ({ tab }) => {
    await chrome.tabs.update(tab, { active: true });
    return null;
  },
  "tabs.screenshot": screenshot,
  frames: async ({ tab }) =>
    ((await chrome.webNavigation.getAllFrames({ tabId: tab })) ?? []).map((f) => ({ frame: f.frameId, parent: f.parentFrameId, url: f.url })),
};
