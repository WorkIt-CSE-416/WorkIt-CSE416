// S3 ops (KAN-609): the live tile and Fix from the window.
//
// tile.start streams the Worker's shown tab to Apply. With `native` (KAN-635), Apply films the
// window itself (ScreenCaptureKit, apply.plain.window_capture): the extension only says which
// window and tab the tile shows, as `tile.shown` events (the window's bounds and the tab's
// viewport), whenever that changes. Without it (no Screen Recording permission), `tile.frame`
// events: a captureVisibleTab JPEG about twice a second (Chrome's quota per browser, shared with
// screenshots through shared.capture), scaled to the tab's CSS size, sent only when it
// changed. tile.input replays one of Lisul's tile events on the page (page/tile.js), and
// the chooser ops stand in for the file picker an untrusted click can't open.

import { capture, inPage, named, sleep, vendor } from "./shared.js";
import { touch } from "./guard.js";

const SHOWN = { interval: 500, quality: 88, maxWidth: 1280, maxHeight: 900, native: false };
const AIM_EVERY = 200; // ms between looks at the shown window and tab, with `native`
let stream = null; // {settings, generation}
let generation = 0;
let shownWindow = null; // the window whose active tab the tile shows: the one last switched to
let lastSent = "";
const menus = new Map(); // tab -> the frame whose <select> the tile shows the options of

let poke = () => {}; // wakes aimLoop at once: a tab switch is told before the window shows the new tab for long
chrome.tabs.onActivated.addListener(({ windowId }) => { shownWindow = windowId; poke(); });
chrome.tabs.onCreated.addListener((tab) => { if (tab.active) shownWindow = tab.windowId; });
chrome.windows.onRemoved.addListener((id) => { if (id === shownWindow) shownWindow = null; });

async function shownTab() {
  if (shownWindow !== null) {
    const [tab] = await chrome.tabs.query({ active: true, windowId: shownWindow }).catch(() => []);
    if (tab) return tab;
  }
  const window = await chrome.windows.getLastFocused({ populate: true, windowTypes: ["normal", "popup"] }).catch(() => null);
  return window?.tabs?.find((t) => t.active) ?? (await chrome.tabs.query({ active: true }))[0] ?? null;
}

function base64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

// One frame of `tab`: the capture made the tab's CSS size (a Retina capture is twice it), within the most.
async function frameOf(tab, { quality, maxWidth, maxHeight }) {
  const url = await capture(tab.windowId, { format: "jpeg", quality });
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const css = { width: tab.width || bitmap.width, height: tab.height || bitmap.height };
  const fit = Math.min(1, maxWidth / css.width, maxHeight / css.height);
  const width = Math.round(css.width * fit);
  const height = Math.round(css.height * fit);
  if (bitmap.width === width && bitmap.height === height) {
    bitmap.close();
    return { data: url.slice(url.indexOf(",") + 1), width, height };
  }
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: quality / 100 });
  return { data: base64(new Uint8Array(await blob.arrayBuffer())), width, height };
}

// With `native`: the shown window's bounds and its tab's viewport, sent when they change.
async function aimLoop(ctx, mine) {
  while (stream && stream.generation === mine) {
    try {
      const tab = await shownTab();
      if (tab) {
        const { left, top, width, height, state } = await chrome.windows.get(tab.windowId);
        // The title lets Apply film this window only if macOS lists it with the tab's title (KAN-717).
        const shown = { tab: tab.id, url: tab.url || "", title: tab.title || "", window: { left, top, width, height, state },
                        viewport: { width: tab.width, height: tab.height } };
        const text = JSON.stringify(shown);
        if (text !== lastSent && stream?.generation === mine) {
          lastSent = text;
          ctx.send("tile.shown", shown);
        }
      }
    } catch (error) {
      // A window closing under it: the next turn looks again.
    }
    await Promise.race([sleep(AIM_EVERY), new Promise((woken) => { poke = woken; })]);
  }
}

async function streamLoop(ctx, mine) {
  while (stream && stream.generation === mine) {
    const started = Date.now();
    try {
      const tab = await shownTab();
      if (tab && /^(https?|file|data|about):/.test(tab.url || tab.pendingUrl || "about:")) {
        const frame = await frameOf(tab, stream.settings);
        // captureVisibleTab takes the window's active tab: a switch during it means the frame shows another tab.
        const [still] = await chrome.tabs.query({ active: true, windowId: tab.windowId }).catch(() => []);
        if (still?.id === tab.id && frame.data !== lastSent && stream?.generation === mine) {
          lastSent = frame.data;
          ctx.send("tile.frame", { tab: tab.id, url: tab.url || "", ...frame });
        }
      }
    } catch (error) {
      // A tab between pages, a chrome:// page or a closed window: the next turn tries again.
    }
    await sleep(Math.max(50, stream?.settings.interval - (Date.now() - started)));
  }
}

// --- file choosers

// Installed in the page's MAIN world (a fixed function: no eval, no user scripts). A page's
// input.click() or showPicker() on a file input opens a picker only with user activation, which
// synthetic events never give. Without it, the hook marks the input (data-apply-chooser on
// <html>, the input kept for chooser.set) instead of letting Chrome drop the call. With it
// (Lisul's own mouse in the Worker's window), the real picker opens as ever.
function hookChoosers() {
  const hooked = Symbol.for("apply.chooser.hooked");
  if (window[hooked]) return true;
  window[hooked] = true;
  const kept = Symbol.for("apply.chooser");
  const proto = HTMLInputElement.prototype;
  const click = proto.click;
  const showPicker = proto.showPicker;
  const asked = (input) => {
    if (input.type !== "file" || navigator.userActivation?.isActive) return false;
    window[kept] = input;
    for (const marked of document.querySelectorAll("[data-apply-chooser-input]")) marked.removeAttribute("data-apply-chooser-input");
    document.documentElement.setAttribute("data-apply-chooser", input.multiple ? "selectMultiple" : "selectSingle");
    return true;
  };
  proto.click = function () {
    if (asked(this)) return undefined;
    return click.call(this);
  };
  if (showPicker) {
    proto.showPicker = function () {
      if (asked(this)) return undefined;
      return showPicker.call(this);
    };
  }
  return true;
}

// MAIN world: give the asked-for input `files` ([{name, mimeType, base64}]), or none (cancel).
function giveFiles(files) {
  const kept = Symbol.for("apply.chooser");
  const input = document.querySelector("[data-apply-chooser-input]") || window[kept];
  document.documentElement.removeAttribute("data-apply-chooser");
  input?.removeAttribute?.("data-apply-chooser-input");
  window[kept] = null;
  if (!input) return false;
  if (!files.length) {
    input.dispatchEvent(new Event("cancel", { bubbles: true }));
    return true;
  }
  const transfer = new DataTransfer();
  for (const file of input.multiple ? files : files.slice(0, 1)) {
    const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
    transfer.items.add(new File([bytes], file.name, { type: file.mimeType, lastModified: Date.now() }));
  }
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

// Isolated world: a synthetic click that reaches a file input itself (a click on it or on its
// label) opens no picker either. Mark that input the same way.
function watchClicks() {
  if (globalThis.__applyChooserClicks) return true;
  globalThis.__applyChooserClicks = true;
  document.addEventListener("click", (event) => {
    const input = event.composedPath()[0];
    if (event.isTrusted || !input?.matches?.("input[type=file]") || input.disabled) return;
    for (const marked of document.querySelectorAll("[data-apply-chooser-input]")) marked.removeAttribute("data-apply-chooser-input");
    input.setAttribute("data-apply-chooser-input", "");
    document.documentElement.setAttribute("data-apply-chooser", input.multiple ? "selectMultiple" : "selectSingle");
  }, true);
  return true;
}

async function hook(tab, frame, allFrames = false) {
  const target = allFrames ? { tabId: tab, allFrames: true } : { tabId: tab, frameIds: [frame] };
  await chrome.scripting.executeScript({ target, world: "MAIN", func: hookChoosers, injectImmediately: true }).catch(() => {});
  await chrome.scripting.executeScript({ target, world: "ISOLATED", func: watchClicks, injectImmediately: true }).catch(() => {});
}

// --- input

async function replay(tab, frame, event) {
  const go = () => inPage({ tab, frame }, "ISOLATED", (e) => (globalThis.__applyTile ? globalThis.__applyTile.run(e) : { missing: true }), [event]);
  let answer = await go();
  if (answer?.missing) {
    await chrome.scripting.executeScript({ target: { tabId: tab, frameIds: [frame] }, world: "ISOLATED",
                                           files: [vendor("vendor/injected.js"), "page/dom.js", "page/tile.js"], injectImmediately: true });
    answer = await go();
  }
  if (answer?.err) throw named(answer.err.name, answer.err.message);
  return answer?.ok ?? null;
}

const bare = (url) => String(url || "").split("#")[0];

// The webNavigation frame id of `parent`'s child frame at `url` (the index-th there), or null.
async function childFrame(tab, parent, { url, index }) {
  const children = ((await chrome.webNavigation.getAllFrames({ tabId: tab })) ?? []).filter((f) => f.parentFrameId === parent);
  const blank = (u) => !u || /^about:(blank|srcdoc)/.test(u);
  const same = children.filter((f) => bare(f.url) === bare(url) || (blank(f.url) && blank(url)));
  return (same[index] ?? same[0] ?? (children.length === 1 ? children[0] : null))?.frameId ?? null;
}

// One tile event on `tab` (default: the tab the tile shows). Points are in the pixels of a
// frame `width` x `height` (the one Lisul saw), or CSS pixels of the page without them.
// A press (`by`: "lisul" from the tile, "apply" from PortPage.mouse) first touches the frame it
// lands in, so a held page's guard counts it as a real press (ops/guard.js); `guard.touched`
// goes up once per press.
const PRESSES = new Set(["down", "key", "text", "choose"]);

async function input({ tab, event, width, height, by = "lisul" }) {
  tab = tab ?? (await shownTab())?.id;
  if (tab === undefined) throw named("NoTab", "no tab to replay a tile event on");
  let frame = event.type === "choose" ? menus.get(tab) ?? 0 : 0;
  let shown = { ...event, width, height };
  for (let depth = 0; depth < 8; depth++) {
    if (shown.type === "down" || shown.type === "up") await hook(tab, frame);
    if (PRESSES.has(shown.type)) await touch({ tab, frame, by }, depth === 0 ? undefined : null);
    const answer = await replay(tab, frame, shown);
    if (answer?.descend) {
      const inner = await childFrame(tab, frame, answer.descend.child);
      if (inner === null) return null; // an iframe not loaded yet
      frame = inner;
      shown = answer.descend.x === undefined ? shown : { ...shown, x: answer.descend.x, y: answer.descend.y, width: null, height: null };
      continue;
    }
    if (answer?.menu) menus.set(tab, frame);
    if (answer?.chooser) return { ...answer, tab, frame };
    return answer;
  }
  return null;
}

// The file input a page asked for since chooser.watch, in any frame: {mode, frame} or null.
async function asked({ tab }) {
  const results = await chrome.scripting.executeScript({ target: { tabId: tab, allFrames: true }, world: "ISOLATED", injectImmediately: true,
                                                         func: () => document.documentElement.getAttribute("data-apply-chooser") });
  const found = (results ?? []).find((r) => r.result);
  return found ? { mode: found.result, frame: found.frameId } : null;
}

export const ops = {
  "tile.start": async (params, ctx) => {
    stream = { settings: { ...SHOWN, ...params }, generation: ++generation };
    lastSent = "";
    (stream.settings.native ? aimLoop : streamLoop)(ctx, stream.generation);
    return null;
  },
  "tile.stop": async () => {
    stream = null;
    return null;
  },
  "tile.input": input,
  "chooser.watch": async ({ tab }) => {
    await chrome.scripting.executeScript({ target: { tabId: tab, allFrames: true }, world: "ISOLATED", injectImmediately: true,
                                           func: () => document.documentElement.removeAttribute("data-apply-chooser") }).catch(() => {});
    await hook(tab, 0, true);
    return null;
  },
  "chooser.get": asked,
  "chooser.set": async ({ tab, frame = 0, files = [] }) => {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab, frameIds: [frame] }, world: "MAIN",
                                                            func: giveFiles, args: [files], injectImmediately: true });
    return Boolean(result?.result);
  },
};
