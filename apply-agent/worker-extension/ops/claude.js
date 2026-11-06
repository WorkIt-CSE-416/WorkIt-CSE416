// S6 ops: what Claude's browser tools (Apply's MCP server, apply/plain/tools.py) need beyond S2's
// dom op: the page's modal state, dialogs and the file chooser (page/modal.js). Fixed functions
// through chrome.scripting, so they need no eval and no user scripts.

import { named } from "./shared.js";

const MODAL = "apply-modal";

// page/modal.js in every frame of every page from document_start, and in the tab's open frames now.
async function arm({ tab }) {
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [MODAL] });
  if (!registered.length) {
    await chrome.scripting.registerContentScripts([{
      id: MODAL, js: ["page/modal.js"], matches: ["<all_urls>"], allFrames: true, matchOriginAsFallback: true,
      runAt: "document_start", world: "MAIN", persistAcrossSessions: false,
    }]);
  }
  await inFrames(tab, () => true, [], "page/modal.js");
  return null;
}

// Runs `func` in the MAIN world of every frame of the tab that will take it: [{frame, value}].
async function inFrames(tab, func, args = [], file = null) {
  const target = { tabId: tab, allFrames: true };
  let results;
  try {
    results = file
      ? await chrome.scripting.executeScript({ target, world: "MAIN", files: [file], injectImmediately: true })
      : await chrome.scripting.executeScript({ target, world: "MAIN", func, args, injectImmediately: true });
  } catch (error) {
    if (/No tab with id/i.test(String(error?.message))) throw named("NoTab", String(error.message));
    const one = { tabId: tab, frameIds: [0] };
    results = file
      ? await chrome.scripting.executeScript({ target: one, world: "MAIN", files: [file], injectImmediately: true })
      : await chrome.scripting.executeScript({ target: one, world: "MAIN", func, args, injectImmediately: true });
  }
  return (results ?? []).map((r) => ({ frame: r.frameId, value: r.result ?? null }));
}

// The dialogs answered since the last call, and the open file chooser, of each frame.
// `clear`: "dialogs" (taken by this call) and/or "chooser" (a chooser that was used or cancelled).
async function modal({ tab, clear = ["dialogs"] }) {
  const found = await inFrames(tab, (clear) => {
    const state = window.__applyModal;
    if (!state) return null;
    if (!state.chooser) state.fromTile?.();
    const said = { dialogs: clear.includes("dialogs") ? state.dialogs.splice(0) : [...state.dialogs], chooser: state.chooser };
    if (clear.includes("chooser")) {
      state.chooser = null;
      state.closeTile?.();
    }
    return said;
  }, [clear]);
  return found.filter((f) => f.value).map((f) => ({ frame: f.frame, ...f.value }));
}

// How to answer the next dialog in the tab (any frame).
async function answer({ tab, accept, promptText = null }) {
  await inFrames(tab, (accept, promptText) => {
    if (window.__applyModal) window.__applyModal.answer = { accept, promptText };
    return true;
  }, [accept, promptText]);
  return null;
}

export const ops = { "mcp.arm": arm, "mcp.modal": modal, "mcp.answer": answer };
