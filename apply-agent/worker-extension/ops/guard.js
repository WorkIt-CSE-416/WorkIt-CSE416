// S4 ops: the submit and drive guards on a plain Worker (apply.plain.guards, apply.submit_guard).
//
// - Init scripts: a guard's script is a fixed file Apply writes into vendor/guards/ (`apply plain
//   prepare`), registered as a MAIN-world content script at document_start in every frame, so it
//   runs before the page's own code with no eval and no user scripts. A script Apply has no file
//   for goes through chrome.userScripts (only where Allow User Scripts is on).
// - Routes: declarativeNetRequest session rules that block a non-GET request whose URL matches,
//   from the tab (and the tabs it opens) or from no tab (a service worker), before any page code:
//   what a page's script, its workers or a form's native POST would send.
// - Bindings: window[name] in MAIN dispatches `__apply_call` on the document; page/relay.js (the
//   isolated world) hands it here, and Apply gets a `binding` event.
// - What a guard blocked comes up as `guard.said` (its `__apply_said`), since no console reaches
//   Apply; a press the extension makes (Apply's own, Lisul's from the tile) is a `__apply_touch`
//   the guard counts, as it counts a trusted click.
// - `extension.reload` (KAN-657): a reload drops the registered scripts, the session rules and this
//   file's memory on a form's open tab. keepAcrossReload writes them down first and the code that
//   starts next puts them back, so a guarded page stays guarded and a held Submit stays held.

import { named, useVendor, userScriptsOn, vendor, vendorSet } from "./shared.js";

const RESOURCE_TYPES = ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest",
  "ping", "csp_report", "media", "websocket", "webtransport", "webbundle", "other"];
const RELAY = "apply-relay";
const NO_TAB = -1; // chrome.tabs.TAB_ID_NONE: a service or shared worker's request

let ctxRef = null; // the background's ctx, for events
export const useCtx = (ctx) => { ctxRef = ctx; }; // from its start: what a page blocks after a reload comes before any op
const routes = new Map(); // key -> {tab, regexes, caseSensitive, ids, tabs: Set}
const lifted = new Map(); // tab -> the control events that lift it, with its note (apply.submit_guard.lift)
const applied = new Map(); // tab -> the control events of the "You already applied" note (KAN-621) it shows
// This run's guard events (KAN-710, apply.plain.guards.tokens): the touch sent before each press, the rehearsal
// guard's tell, and the bindings only that tell may call. Named with Apply's tokens; no page knows them.
let tokens = { touch: [], tell: "", tells: [] };
const bindings = new Map(); // tab (or "*", every tab) -> Set of names
const syncs = new Map(); // token -> resolve
let nextRule = 1000;

// No guard at all: every init script, rule, lift and binding gone. A fresh service worker starts
// so (Apply guards each page anew; it treats a Worker whose port closed as gone), and `guard.reset`
// does it for a Worker reused for another Application.
async function reset() {
  try { await chrome.scripting.unregisterContentScripts(); } catch {}
  try {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    if (rules.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map((r) => r.id) });
  } catch {}
  try { if (userScriptsOn()) await chrome.userScripts.unregister(); } catch {}
  routes.clear();
  lifted.clear();
  applied.clear();
  bindings.clear();
  tokens = { touch: [], tell: "", tells: [] };
  return null;
}
const ready = reset().then(restore);

// What a reload would drop, written down just before it, and put back by the code that starts next.
const KEPT = "guardsAcrossReload";
const KEPT_FOR_MS = 60000; // a note older than this is from another run of Chrome, not this reload

export async function keepAcrossReload() {
  await ready;
  const kept = {
    at: Date.now(), vendor: vendorSet(),
    scripts: await chrome.scripting.getRegisteredContentScripts(),
    userScripts: userScriptsOn() ? await chrome.userScripts.getScripts() : [],
    routes: [...routes].map(([key, r]) => [key, { tab: r.tab, regexes: r.regexes, caseSensitive: r.caseSensitive, tabs: r.tabs && [...r.tabs] }]),
    lifted: [...lifted], applied: [...applied], bindings: [...bindings].map(([where, names]) => [where, [...names]]),
    tokens,
  };
  await chrome.storage.local.set({ [KEPT]: kept });
}

async function restore() {
  const kept = (await chrome.storage.local.get(KEPT))[KEPT];
  if (!kept) return;
  await chrome.storage.local.remove(KEPT);
  if (Date.now() - kept.at > KEPT_FOR_MS) return;
  useVendor(kept.vendor);
  if (kept.tokens) tokens = kept.tokens;
  for (const [where, names] of kept.bindings) bindings.set(where, new Set(names));
  for (const [tab, note] of kept.lifted) lifted.set(tab, note);
  for (const [tab, day] of kept.applied) applied.set(tab, day);
  for (const [key, r] of kept.routes) {
    const entry = { ...r, ids: r.regexes.map(() => nextRule++), tabs: r.tabs && new Set(r.tabs) };
    routes.set(key, entry);
    await putRules(entry, []);
  }
  if (kept.scripts.length) await chrome.scripting.registerContentScripts(kept.scripts);
  if (kept.userScripts.length && userScriptsOn()) await chrome.userScripts.register(kept.userScripts);
  // The open documents kept their page guards, but their relay died with the old code.
  if (kept.scripts.some((s) => s.id === RELAY)) {
    for (const t of await chrome.tabs.query({})) await inFrames(t.id, "ISOLATED", { files: ["page/relay.js"] }).catch(() => {});
  }
}

async function sha256(file) {
  const bytes = await (await fetch(chrome.runtime.getURL(file))).arrayBuffer();
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A vendor/guards file, refused unless it is the very script Apply has (a stale `prepare` would
// guard with old code). Returns the file in the vendor set Apply named (shared.js: vendor).
async function checked(name, sha) {
  if (!/^vendor\/guards\/[\w.-]+\.js$/.test(name || "")) throw named("BadOp", `not a guard file: ${name}`);
  const file = vendor(name);
  let got;
  try {
    got = await sha256(file);
  } catch {
    throw named("Crash", `${file} is missing: run \`uv run apply plain prepare\``);
  }
  if (sha && got !== sha) throw named("Crash", `${file} differs from Apply's guard (sha256 ${got.slice(0, 12)}, Apply's ${sha.slice(0, 12)}): run \`uv run apply plain prepare\``);
  return file;
}

async function registered(id) {
  return (await chrome.scripting.getRegisteredContentScripts({ ids: [id] })).length > 0;
}

async function register(id, file, world) {
  if (await registered(id)) await chrome.scripting.unregisterContentScripts({ ids: [id] });
  await chrome.scripting.registerContentScripts([{
    id, js: [file], matches: ["<all_urls>"], allFrames: true, matchOriginAsFallback: true, runAt: "document_start",
    world, persistAcrossSessions: false,
  }]);
}

// Runs `files` (then `func(...args)`) in every frame of a tab now; a frame that can't take it
// (an error page, a frame going away) is skipped: the registered script covers its next document.
async function inFrames(tab, world, { files, func, args = [], frame } = {}) {
  const target = frame === undefined ? { tabId: tab, allFrames: true } : { tabId: tab, frameIds: [frame] };
  try {
    if (files) await chrome.scripting.executeScript({ target, world, files, injectImmediately: true });
    if (func) return await chrome.scripting.executeScript({ target, world, func, args, injectImmediately: true });
  } catch (error) {
    if (/No tab with id/i.test(String(error?.message))) throw error;
  }
  return [];
}

// The isolated-world relay that hands the page's `__apply_said` and `__apply_call` here.
async function relay(tab) {
  if (!(await registered(RELAY))) await register(RELAY, "page/relay.js", "ISOLATED");
  const tabs = tab === undefined || tab === null ? (await chrome.tabs.query({})).map((t) => t.id) : [tab];
  for (const id of tabs) await inFrames(id, "ISOLATED", { files: ["page/relay.js"] });
}

// --- init scripts

async function script({ id, file, sha256: sha, code, tab }) {
  if (!id) throw named("BadOp", "guard.script needs an id");
  await relay(tab);
  if (file) {
    await register(`apply-init-${id}`, await checked(file, sha), "MAIN");
    return { file };
  }
  if (!userScriptsOn()) throw named("UserScriptsOff", "add_init_script with code needs Allow User Scripts on (the seed profile); Chrome for Testing has it off");
  const existing = await chrome.userScripts.getScripts({ ids: [`apply-init-${id}`] });
  if (existing.length) await chrome.userScripts.unregister({ ids: [`apply-init-${id}`] });
  await chrome.userScripts.register([{ id: `apply-init-${id}`, matches: ["<all_urls>"], js: [{ code }], runAt: "document_start", world: "MAIN", allFrames: true }]);
  return { code: true };
}

// A guard file in the tab's frames now (the drive guard on a page already open).
async function inject({ tab, file, sha256: sha }) {
  await relay(tab);
  await inFrames(tab, "MAIN", { files: [await checked(file, sha)] });
  return null;
}

// --- routes

function rulesOf(route) {
  return route.regexes.map((regexFilter, i) => ({
    id: route.ids[i], priority: 1, action: { type: "block" },
    condition: {
      regexFilter, isUrlFilterCaseSensitive: route.caseSensitive, excludedRequestMethods: ["get", "head", "options"],
      resourceTypes: RESOURCE_TYPES, ...(route.tabs ? { tabIds: [...route.tabs] } : {}),
    },
  }));
}

async function putRules(route, old = route.ids) {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: old, addRules: rulesOf(route) });
}

async function route({ key, tab = null, regexes, caseSensitive = false }) {
  for (const regex of regexes) {
    const answer = await chrome.declarativeNetRequest.isRegexSupported({ regex, isCaseSensitive: caseSensitive });
    if (!answer.isSupported) throw named("BadOp", `declarativeNetRequest can't take ${regex}: ${answer.reason}`);
  }
  const old = routes.get(key);
  const entry = {
    tab, regexes, caseSensitive, ids: regexes.map(() => nextRule++),
    tabs: tab === null ? null : new Set([tab, NO_TAB, ...(old?.tabs ?? [])]),
  };
  routes.set(key, entry);
  await putRules(entry, old?.ids ?? []);
  return { rules: entry.ids.length };
}

async function unroute({ key }) {
  const old = routes.get(key);
  routes.delete(key);
  if (old) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: old.ids });
  return null;
}

// --- bindings

function bindIn(tab, frame, names) {
  return inFrames(tab, "MAIN", {
    frame,
    args: [names],
    func: (names) => {
      for (const name of names) {
        if (typeof window[name] === "function" && window[name].__applyBinding) continue;
        const binding = (...args) => {
          document.dispatchEvent(new CustomEvent("__apply_call", { detail: JSON.stringify({ name, args }) }));
          return Promise.resolve();
        };
        binding.__applyBinding = true;
        window[name] = binding;
      }
    },
  });
}

async function bind({ tab = null, name }) {
  await relay(tab);
  const where = tab === null ? "*" : tab;
  if (!bindings.has(where)) bindings.set(where, new Set());
  bindings.get(where).add(name);
  const tabs = tab === null ? (await chrome.tabs.query({})).map((t) => t.id) : [tab];
  for (const id of tabs) await bindIn(id, undefined, [name]);
  return null;
}

function namesFor(tab) {
  return [...(bindings.get(tab) ?? []), ...(bindings.get("*") ?? [])];
}

// --- the guards' state (KAN-710): set only by their control events, sent here from the isolated world

// apply.submit_guard.DISPATCH: each [type, detail] event on the window, or on the one element marked `mark`.
function dispatchIn(events, mark) {
  let at = window;
  if (mark) {
    at = document.querySelector('[data-apply-press="' + mark + '"]');
    if (!at) return "none";
    at.removeAttribute("data-apply-press");
    if (at.querySelector("iframe, frame, object, embed, fencedframe, portal")) return "frame";
  }
  let heard = false;
  for (const [type, detail] of events) {
    const event = new CustomEvent(type, { detail, cancelable: true });
    at.dispatchEvent(event);
    heard = heard || event.defaultPrevented;
  }
  return heard ? "heard" : "unheard";
}

async function sendEvents(tab, frame, events, mark = null) {
  const done = await inFrames(tab, "ISOLATED", { frame, func: dispatchIn, args: [events, mark] });
  return (done || []).map((r) => r?.result);
}

async function control({ tab, events, mark = null }) {
  return sendEvents(tab, undefined, events, mark);
}

async function setTokens({ touch = [], tell = "", tells = [] }) {
  tokens = { touch, tell, tells };
  await relay(); // every frame's relay asks for them again
  return null;
}

// --- lift and rearm (apply.submit_guard.lift / rearm / renote)

const liftIn = (tab, frame, events) => sendEvents(tab, frame, events);

async function lift({ tab, events, onlyLifted = false }) {
  if (onlyLifted && !lifted.has(tab)) return false; // renote: a page still guarded stays guarded
  lifted.set(tab, events);
  await liftIn(tab, undefined, events);
  return null;
}

// The "You already applied on <day>" note (KAN-621) on a page still guarded, in its top frame now and in
// each document the tab loads, until `events` is null (Lisul dismissed it: no page shows it again).
async function appliedNote({ tab, events = null, dismissed = null }) {
  if (events === null) {
    applied.delete(tab);
    if (dismissed) await sendEvents(tab, undefined, dismissed);
    return null;
  }
  applied.set(tab, events);
  await sendEvents(tab, 0, events);
  return null;
}

async function rearm({ tab, events }) {
  lifted.delete(tab);
  await sendEvents(tab, undefined, events);
  return null;
}

// Each document a lifted tab loads is Lisul's too, and each gets the tab's bindings.
function onDocument(d) {
  const events = lifted.get(d.tabId);
  if (events) liftIn(d.tabId, d.frameId, events).catch(() => {});
  if (applied.has(d.tabId) && d.frameId === 0) sendEvents(d.tabId, 0, applied.get(d.tabId)).catch(() => {});
  const names = namesFor(d.tabId);
  if (names.length) bindIn(d.tabId, d.frameId, names).catch(() => {});
}
chrome.webNavigation.onCommitted.addListener(onDocument);
chrome.webNavigation.onDOMContentLoaded.addListener(onDocument);

// A tab a guarded tab opens is guarded as its opener is (Playwright's routes are the context's),
// and one a lifted tab opens is Lisul's.
chrome.tabs.onCreated.addListener((tab) => {
  const opener = tab.openerTabId;
  if (opener === undefined) return;
  if (lifted.has(opener)) lifted.set(tab.id, lifted.get(opener));
  for (const entry of routes.values()) {
    if (entry.tabs?.has(opener) && !entry.tabs.has(tab.id)) {
      entry.tabs.add(tab.id);
      putRules(entry).catch(() => {});
    }
  }
});
chrome.tabs.onRemoved.addListener((tab) => {
  lifted.delete(tab);
  applied.delete(tab);
  bindings.delete(tab);
});

// --- touches and what the page said

// A press the extension is about to make in a frame counts as a touch: the guard then shows what
// it blocks, as it does for a trusted click. tile.input calls this before
// each press it replays (by = "lisul" for the tile's), and Apply hears `guard.touched` from the extension itself (his press is
// untrusted, so the page can't tell it from a script's). The touch is the token's: a page can't send one.
export async function touch({ tab, frame = 0, by = "lisul" }, ctx = ctxRef) {
  await inFrames(tab, "ISOLATED", { frame, args: [tokens.touch], func: (types) => { for (const type of types) window.dispatchEvent(new CustomEvent(type)); } });
  if (by === "lisul") ctx?.send("guard.touched", { tab, frame, by });
  return null;
}

// Resolves once every frame of the tab has handed over what it said before now (per-sender order).
async function sync({ tab, timeout = 1000 }) {
  const frames = (await chrome.webNavigation.getAllFrames({ tabId: tab })) ?? [];
  const waits = frames.map((f) => {
    const token = `${tab}:${f.frameId}:${Math.random()}`;
    const heard = new Promise((resolve) => syncs.set(token, resolve));
    const sent = inFrames(tab, "ISOLATED", { frame: f.frameId, args: [token], func: (token) => {
      if (!globalThis.__applyRelay) return false;
      chrome.runtime.sendMessage({ applyGuard: "sync", detail: token });
      return true;
    } }).then((r) => (r?.[0]?.result ? heard : null));
    return Promise.race([sent, new Promise((resolve) => setTimeout(resolve, timeout))]).finally(() => syncs.delete(token));
  });
  await Promise.all(waits);
  return null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.applyGuard || sender.id !== chrome.runtime.id) return;
  if (message.applyGuard === "sync") {
    syncs.get(message.detail)?.();
    return;
  }
  if (message.applyGuard === "tokens") { // a frame's relay, as it starts: what to send before a press, and hear
    sendResponse({ touch: tokens.touch, tell: tokens.tell });
    return;
  }
  if (!sender.tab) return;
  const where = { tab: sender.tab.id, frame: sender.frameId ?? 0 };
  if (message.applyGuard === "said") ctxRef?.send("guard.said", { ...where, text: String(message.detail) });
  else if (message.applyGuard === "call") {
    let call;
    try {
      call = JSON.parse(message.detail);
    } catch {
      return;
    }
    // A guard's own binding (Lisul's press, Fill again, Dismiss) is called only by the guard's tell, never the page.
    if (namesFor(where.tab).includes(call?.name) && !tokens.tells.includes(call.name)) ctxRef?.send("binding", { ...where, name: call.name, args: Array.isArray(call.args) ? call.args : [] });
  } else if (message.applyGuard === "tell") {
    let told;
    try {
      told = JSON.parse(message.detail);
    } catch {
      return;
    }
    const [name, args] = Array.isArray(told) ? told : [];
    if (tokens.tells.includes(name) && namesFor(where.tab).includes(name)) ctxRef?.send("binding", { ...where, name, args: Array.isArray(args) ? args : [] });
  }
});

async function status({ tab } = {}) {
  const scripts = (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id);
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  return {
    scripts,
    rules: rules.filter((r) => tab === undefined || !r.condition.tabIds || r.condition.tabIds.includes(tab)).length,
    lifted: tab === undefined ? [...lifted.keys()] : lifted.has(tab),
  };
}

// Every op waits for the start-up reset and keeps the background's ctx for events.
const withCtx = (fn) => async (params, ctx) => {
  ctxRef = ctx || ctxRef;
  await ready;
  return fn(params, ctx);
};

export const ops = {
  "guard.script": withCtx(script),
  "guard.inject": withCtx(inject),
  "guard.route": withCtx(route),
  "guard.unroute": withCtx(unroute),
  "guard.bind": withCtx(bind),
  "guard.lift": withCtx(lift),
  "guard.rearm": withCtx(rearm),
  "guard.applied": withCtx(appliedNote),
  "guard.control": withCtx(control),
  "guard.tokens": withCtx(setTokens),
  "guard.touch": withCtx(touch),
  "guard.sync": withCtx(sync),
  "guard.status": withCtx(status),
  "guard.reset": withCtx(reset),
};
