// Apply's worker extension: the service worker of one plain Worker Chrome.
//
// It connects to Apply's host relay (com.workit.apply_worker, in this Worker
// profile's own NativeMessagingHosts folder) as it starts, says hello, and then
// runs the ops Apply calls, one message each, through the ordinary extension
// APIs. The open port keeps this service worker alive. Nothing here hides
// automation: this Chrome has none (no CDP, no automation flags).
//
// The protocol is apply-agent/docs/plain-workers/PROTOCOL.md. Ops live in
// ops/*.js, one file per slice, joined in ops/index.js.

import { useCtx } from "./ops/guard.js";
import { ops } from "./ops/index.js";
import { useVendor, userScriptsOn } from "./ops/shared.js";

const HOST = "com.workit.apply_worker";
const PROTOCOL = 1;
// What this code can do, in the hello (`features`): Apply compares it with what it expects
// (bridge.FEATURES). 2: tile.shown (KAN-635) and extension.reload. 3: the welcome's vendor set and
// vendor.use (KAN-645). Raise it with each new op or event.
const FEATURES = 3;
const RECONNECT_MS = 2000;

let port = null;
let welcomed = false;
const parts = new Map(); // a chunked message's pieces, by id

function send(message) {
  try {
    port?.postMessage(message);
  } catch (error) {
    console.warn("Apply worker: send failed", error);
  }
}

const ctx = {
  // Unasked news for Apply, once it has welcomed this Worker.
  send(event, fields = {}) {
    if (welcomed) send({ type: "event", event, ...fields });
  },
};
useCtx(ctx);

async function hello() {
  const engine = await fetch(chrome.runtime.getURL("vendor/engine.json"))
    .then((response) => response.json())
    .catch(() => null);
  send({
    type: "hello",
    protocol: PROTOCOL,
    extension: chrome.runtime.getManifest().version,
    features: FEATURES,
    engine,
    userScripts: userScriptsOn(),
    webdriver: navigator.webdriver === true,
    userAgent: navigator.userAgent,
    brands: (navigator.userAgentData?.brands ?? []).map((b) => b.brand),
  });
}

function errorOf(error) {
  const message = String(error?.message ?? error);
  let name = error?.name && error.name !== "Error" ? error.name : "Crash";
  if (/No tab with id/i.test(message)) name = "NoTab";
  else if (/No frame with id|Frame with ID \d+ (was removed|is showing error page)|frame was removed|document.*(unloaded|changed)/i.test(message)) name = "Navigated";
  if (name === "Navigated" && !/context was destroyed/.test(message))
    return { name, message: `Execution context was destroyed, most likely because of a navigation (${message})` };
  return { name, message };
}

async function run(message) {
  const op = ops[message.op];
  if (!op) {
    send({ type: "error", id: message.id, error: { name: "BadOp", message: `no op ${message.op}` } });
    return;
  }
  try {
    const value = await op(message.params ?? {}, ctx);
    send({ type: "result", id: message.id, value: value === undefined ? null : value });
  } catch (error) {
    send({ type: "error", id: message.id, error: errorOf(error) });
  }
}

function handle(message) {
  if (message.type === "chunk") {
    const got = parts.get(message.id) ?? [];
    got[message.seq] = message.data;
    parts.set(message.id, got);
    if (got.filter((p) => p !== undefined).length === message.of) {
      parts.delete(message.id);
      handle(JSON.parse(got.join("")));
    }
    return;
  }
  if (message.type === "welcome") {
    welcomed = true;
    try {
      if (message.vendor) useVendor(message.vendor);
    } catch (error) {
      console.warn("Apply worker: bad vendor set", error);
    }
    chrome.action?.setBadgeText?.({ text: "" });
    return;
  }
  if (message.type === "refuse") {
    console.warn("Apply refused this Worker:", message.reason);
    welcomed = false;
    return;
  }
  if (message.type === "call") run(message);
}

function connect() {
  welcomed = false;
  parts.clear();
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (error) {
    console.warn("Apply worker: no host", error);
    setTimeout(connect, RECONNECT_MS);
    return;
  }
  port.onMessage.addListener(handle);
  port.onDisconnect.addListener(() => {
    console.warn("Apply worker: port closed", chrome.runtime.lastError?.message);
    port = null;
    welcomed = false;
    setTimeout(connect, RECONNECT_MS);
  });
  hello();
}

// Events every slice shares: tabs and top-level navigations.
chrome.tabs.onCreated.addListener((tab) => ctx.send("tab.created", { tab: tab.id, opener: tab.openerTabId ?? null, url: tab.pendingUrl || tab.url || "" }));
chrome.tabs.onRemoved.addListener((tab) => ctx.send("tab.removed", { tab }));
chrome.webNavigation.onCommitted.addListener((d) => ctx.send("navigated", { tab: d.tabId, frame: d.frameId, url: d.url }));

connect();
