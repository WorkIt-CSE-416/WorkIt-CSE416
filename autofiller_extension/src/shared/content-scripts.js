// What a fill injects into the application's tab, in this order, by both the
// panel ("Autofill This Page", background.js panel/fill) and the auto-apply runner, so the two can never
// fill with different files (`injectFill`).
//
// ENGINE_FILES run in the page's own JavaScript world ("MAIN"): the Fill
// engine (the fill-engine submodule, pinned to a tag) must see the page's
// React state and wrap its fetch (Ashby), which an extension's isolated world
// can't. CONTENT_SCRIPT_FILES run in the isolated world, where chrome.runtime
// is: lib-status/tokens/panel/row-card/overlay/card-flag/card-waiting/card-guess/letter-preview/captured-notice/workday/workday-walk/written-answers/batch-tab/marks/card-failed/submit-warning populate window.WIA and content-script.js (last)
// runs the fill, reaching the engine through the background
// (background/engine.js). Content scripts can't be ES modules, so the order
// here is what makes the globals exist.
export const ENGINE_FILES = ["fill-engine/dist/engine.js"];

export const CONTENT_SCRIPT_FILES = ["src/content/lib-status.js", "src/shared/tokens.js", "src/content/panel.js", "src/content/panel-top.js", "src/content/row-card.js", "src/content/groups.js", "src/content/overlay.js", "src/content/card-flag.js", "src/content/card-waiting.js", "src/content/card-guess.js", "src/content/letter-preview.js", "src/content/answers-tab.js", "src/content/captured-notice.js", "src/content/workday.js", "src/content/workday-walk.js", "src/content/written-answers.js", "src/content/batch-tab.js", "src/content/marks.js", "src/content/card-failed.js", "src/content/submit-warning.js", "src/content/content-script.js"];

/**
 * Loads the engine into the tab, then starts the fill there. With `batch`,
 * the fill is one of batch apply's tabs (background/batch.js): it writes no
 * essays and reports whether the tab is ready or needs the student
 * (content-script.js). Resolves once the fill has started, not when it ends
 * (the content script's own promise would hold this until then).
 * With `frameId`, the fill runs in that frame only (a careers page's embedded
 * Greenhouse form, background/embedded-forms.js), else in the top frame.
 * @param {number} tabId
 * @param {{ batch?: boolean, frameId?: number }} [options]
 */
export async function injectFill(tabId, { batch = false, frameId = undefined } = {}) {
  const target = frameId === undefined ? { tabId } : { tabId, frameIds: [frameId] };
  // One fill per page, claimed in one step before anything is injected. A batch tab opened on a Workday step
  // is injected twice as its page loads (batch.js's startFill and background.js's per-page-load fill): run
  // side by side, the second's panel scripts replaced the first fill's panel, and no panel showed.
  const [{ result: claimed }] = await chrome.scripting.executeScript({
    target,
    func: (batch) => {
      if (window.WIA?.running) return false;
      window.WIA = { ...window.WIA, batch, running: true };
      return true;
    },
    args: [batch],
  });
  if (!claimed) return;
  const release = () => chrome.scripting.executeScript({ target, func: () => void (window.WIA.running = false) }).catch(() => {});
  try {
    await chrome.scripting.executeScript({ target, world: "MAIN", files: ENGINE_FILES });
  } catch (error) {
    await release();
    throw error;
  }
  // The script's promise is the whole fill: on Workday it lasts as long as the page, so a page that goes ends it.
  void chrome.scripting.executeScript({ target, files: CONTENT_SCRIPT_FILES }).catch((error) => {
    if (/Frame with ID \d+ was removed|No tab with id/.test(error.message)) return;
    console.warn("[fill] the fill stopped:", error);
    void release();
  });
}

// A batch tab at a human check before the form (KAN-369): the panel's parts (never shown there), then human-check.js.
export const HUMAN_CHECK_FILES = ["src/content/lib-status.js", "src/shared/tokens.js", "src/content/panel.js", "src/content/row-card.js", "src/content/groups.js", "src/content/overlay.js", "src/content/batch-tab.js", "src/content/marks.js", "src/content/human-check.js"];

/**
 * Readies a batch tab that shows a human check where its form should be:
 * Next Thing That Needs You stops there, and no panel covers the check.
 * Nothing is filled. Never throws: the wait for the form
 * goes on without it.
 * @param {number} tabId
 */
export async function injectHumanCheck(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: HUMAN_CHECK_FILES }).catch((error) => console.warn("[batch] the human check's panel didn't show:", error.message));
}
