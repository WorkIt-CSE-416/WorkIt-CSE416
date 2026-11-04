// S7 ops: what Workday's and other account pages need beyond S2's locators.
//
// - net.watch: a tab's requests and responses, as Playwright's page.on("request"/"response").
//   Requests and their statuses come from webRequest (observe only, no page code). A fetch or
//   XHR answer's body, which Workday's Create Account is read from, comes from page/net-main.js:
//   a fixed file put into the watched tab's frames only while Apply watches it, never on others.
// - The same file catches a pop-up the page's window.open asked for and Chrome's pop-up blocker
//   refused (synthetic clicks grant no user activation), and the tab is opened here by its URL,
//   with the page as its opener, so page.on("popup") sees it as Playwright would.
// - frames.of: the frame id of an <iframe> found by a Playwright selector (frame locators).

import { ops as domOps } from "./dom.js";
import { inPage, named } from "./shared.js";

const watched = new Set(); // tab ids whose requests go up the port
let send = null; // ctx.send, from the first net.watch

const NET_EVENT = "apply-worker-net"; // page/net-main.js -> page/net-relay.js

function inject(tab, frames) {
  const target = frames === "all" ? { tabId: tab, allFrames: true } : { tabId: tab, frameIds: frames };
  return Promise.all([
    chrome.scripting.executeScript({ target, world: "MAIN", files: ["page/net-main.js"], injectImmediately: true }),
    chrome.scripting.executeScript({ target, world: "ISOLATED", files: ["page/net-relay.js"], injectImmediately: true }),
  ]).catch(() => {}); // a frame Chrome won't script (chrome://, an error page): nothing to watch there
}

const ofTab = (d) => watched.has(d.tabId);
const XHR = "xmlhttprequest"; // fetch and XHR both: their answers come from the page, with bodies

chrome.webRequest.onBeforeRequest.addListener((d) => {
  if (ofTab(d)) send?.("request", { tab: d.tabId, frame: d.frameId, url: d.url, method: d.method, resource: d.type });
}, { urls: ["<all_urls>"] });
chrome.webRequest.onBeforeRedirect.addListener((d) => {
  if (ofTab(d)) send?.("response", { tab: d.tabId, frame: d.frameId, url: d.url, method: d.method, resource: d.type, status: d.statusCode, redirect: d.redirectUrl });
}, { urls: ["<all_urls>"] });
chrome.webRequest.onCompleted.addListener((d) => {
  if (ofTab(d) && d.type !== XHR) send?.("response", { tab: d.tabId, frame: d.frameId, url: d.url, method: d.method, resource: d.type, status: d.statusCode });
}, { urls: ["<all_urls>"] });
chrome.webRequest.onErrorOccurred.addListener((d) => {
  if (ofTab(d)) send?.("requestfailed", { tab: d.tabId, frame: d.frameId, url: d.url, method: d.method, resource: d.type, error: d.error });
}, { urls: ["<all_urls>"] });

// Each new document of a watched tab gets the page script as it commits.
chrome.webNavigation.onCommitted.addListener((d) => {
  if (watched.has(d.tabId)) inject(d.tabId, [d.frameId]);
});
chrome.tabs.onRemoved.addListener((tab) => watched.delete(tab));

chrome.runtime.onMessage.addListener((message, sender) => {
  const said = message?.applyNet;
  const tab = sender.tab?.id;
  if (!said || tab === undefined || !watched.has(tab)) return;
  if (said.popup) {
    // Opened as the click would have, had it been the user's: a new tab, the page its opener.
    // Its tab.created comes with no opener, so popup.blocked names the new tab for page.on("popup").
    chrome.tabs.create({ url: said.popup, openerTabId: tab, windowId: sender.tab.windowId, active: true })
      .then((opened) => send?.("popup.blocked", { tab, frame: sender.frameId, url: said.popup, popup: opened.id }))
      .catch(() => {});
    return;
  }
  send?.("response", { tab, frame: sender.frameId, resource: XHR, url: said.url, requested: said.requested, method: said.method,
                       status: said.status, body: said.body ?? null, truncated: !!said.truncated });
});

async function watch({ tab, on = true }, ctx) {
  send = ctx.send;
  if (!on) {
    watched.delete(tab);
    return null;
  }
  if (!watched.has(tab)) {
    watched.add(tab);
    await inject(tab, "all");
  }
  return null;
}

// The frame id of the <iframe> `selector` finds in frame `frame`. Content scripts have no
// getFrameId here, so the frame is matched by position: the element's index in its parent's
// window.frames, against each child frame's own index in parent.frames (readable cross-origin).
async function frameOf(params) {
  const loaded = await domOps.dom({ ...params, method: "count", args: [params.selector] }); // loads the locator engine
  if (loaded?.err) throw named(loaded.err.name, loaded.err.message);
  const answer = await inPage(params, "ISOLATED", (selector) => {
    const pw = globalThis.__applyPW;
    const found = pw.querySelectorAll(pw.parseSelector(selector), document);
    if (!found.length) return { retry: `waiting for frame locator('${selector}')` };
    if (found.length > 1) return { err: { name: "Strict", message: `strict mode violation: locator('${selector}') resolved to ${found.length} elements` } };
    if (!/^i?frame$/i.test(found[0].tagName)) return { err: { name: "Error", message: `locator('${selector}') is not an <iframe>` } };
    const index = Array.prototype.indexOf.call(Array.from({ length: window.frames.length }, (_, i) => window.frames[i]), found[0].contentWindow);
    return index < 0 ? { retry: "the frame has no document yet" } : { index };
  }, [params.selector]);
  if (answer?.err) throw named(answer.err.name, answer.err.message);
  if (!answer || answer.retry) return answer;
  const parent = params.frame ?? 0;
  const children = ((await chrome.webNavigation.getAllFrames({ tabId: params.tab })) || []).filter((f) => f.parentFrameId === parent);
  for (const child of children) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: params.tab, frameIds: [child.frameId] }, world: "ISOLATED", injectImmediately: true,
      func: () => Array.from({ length: parent.frames.length }, (_, i) => parent.frames[i]).indexOf(window),
    }).catch(() => [null]);
    if (result?.result === answer.index) return { ok: child.frameId };
  }
  return { retry: "the frame has no document yet" };
}

export const ops = { "net.watch": watch, "frames.of": frameOf };
export { NET_EVENT };
