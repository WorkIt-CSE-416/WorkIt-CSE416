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
  if (ofTab(d)) send?.("request", { tab: d.tabId, frame: d.frameId, url: d.url, method: d.method, type: d.type });
}, { urls: ["<all_urls>"] });
chrome.webRequest.onBeforeRedirect.addListener((d) => {
  if (ofTab(d)) send?.("response", { tab: d.tabId, frame: d.frameId, url: d.url, method: d.method, type: d.type, status: d.statusCode, redirect: d.redirectUrl });
}, { urls: ["<all_urls>"] });
chrome.webRequest.onCompleted.addListener((d) => {
  if (ofTab(d) && d.type !== XHR) send?.("response", { tab: d.tabId, frame: d.frameId, url: d.url, method: d.method, type: d.type, status: d.statusCode });
}, { urls: ["<all_urls>"] });
chrome.webRequest.onErrorOccurred.addListener((d) => {
  if (ofTab(d)) send?.("requestfailed", { tab: d.tabId, frame: d.frameId, url: d.url, method: d.method, type: d.type, error: d.error });
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
    chrome.tabs.create({ url: said.popup, openerTabId: tab, windowId: sender.tab.windowId, active: true }).catch(() => {});
    send?.("popup.blocked", { tab, frame: sender.frameId, url: said.popup });
    return;
  }
  send?.("response", { tab, frame: sender.frameId, type: XHR, url: said.url, requested: said.requested, method: said.method,
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

async function frameOf(params) {
  const loaded = await domOps.dom({ ...params, method: "count", args: [params.selector] }); // loads the locator engine
  if (loaded?.err) throw named(loaded.err.name, loaded.err.message);
  const answer = await inPage(params, "ISOLATED", (selector) => {
    const pw = globalThis.__applyPW;
    const found = pw.querySelectorAll(pw.parseSelector(selector), document);
    if (!found.length) return { retry: `waiting for frame locator('${selector}')` };
    if (found.length > 1) return { err: { name: "Strict", message: `strict mode violation: locator('${selector}') resolved to ${found.length} elements` } };
    if (!/^i?frame$/i.test(found[0].tagName)) return { err: { name: "Error", message: `locator('${selector}') is not an <iframe>` } };
    const id = chrome.runtime.getFrameId(found[0]);
    return id < 0 ? { retry: "the frame has no document yet" } : { ok: id };
  }, [params.selector]);
  if (answer?.err) throw named(answer.err.name, answer.err.message);
  return answer;
}

export const ops = { "net.watch": watch, "frames.of": frameOf };
export { NET_EVENT };
