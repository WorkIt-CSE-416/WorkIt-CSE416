// What a fill injects into the application's tab, in this order, by both the
// popup ("Autofill This Page") and the auto-apply runner, so the two can never
// fill with different files (`injectFill`).
//
// ENGINE_FILES run in the page's own JavaScript world ("MAIN"): the Fill
// engine (the fill-engine submodule, pinned to a tag) must see the page's
// React state and wrap its fetch (Ashby), which an extension's isolated world
// can't. CONTENT_SCRIPT_FILES run in the isolated world, where chrome.runtime
// is: lib-status/tokens/overlay/workday/written-answers populate window.WIA and content-script.js (last)
// runs the fill, reaching the engine through the background
// (background/engine.js). Content scripts can't be ES modules, so the order
// here is what makes the globals exist.
export const ENGINE_FILES = ["fill-engine/dist/engine.js"];

export const CONTENT_SCRIPT_FILES = ["src/content/lib-status.js", "src/shared/tokens.js", "src/content/overlay.js", "src/content/workday.js", "src/content/written-answers.js", "src/content/content-script.js"];

/**
 * Loads the engine into the tab, then starts the fill there. With `batch`,
 * the fill is one of batch apply's tabs (background/batch.js): it writes no
 * essays and reports whether the tab is ready or needs the student
 * (content-script.js). Resolves once the fill has started, not when it ends
 * (the content script's own promise would hold this until then).
 * @param {number} tabId
 * @param {{ batch?: boolean }} [options]
 */
export async function injectFill(tabId, { batch = false } = {}) {
  await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ENGINE_FILES });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (batch) => {
      window.WIA = { ...window.WIA, batch };
    },
    args: [batch],
  });
  void chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPT_FILES }).catch((error) => console.warn("[fill] the fill stopped:", error));
}
