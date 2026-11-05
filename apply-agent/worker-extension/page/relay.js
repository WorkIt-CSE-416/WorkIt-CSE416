// The guards' relay, in the worker extension's isolated world of every frame (ops/guard.js).
// It hands the service worker what the page's guard says it blocked (`__apply_said`) and each
// call of a binding Apply exposed (`__apply_call`). Both carry text only: an object from the
// page's world can't cross into this one.

(() => {
  if (globalThis.__applyRelay) return;
  globalThis.__applyRelay = true;
  const up = (kind, detail) => {
    try {
      chrome.runtime.sendMessage({ applyGuard: kind, detail }).catch(() => {});
    } catch {}
  };
  document.addEventListener("__apply_said", (event) => typeof event.detail === "string" && up("said", event.detail), true);
  document.addEventListener("__apply_call", (event) => typeof event.detail === "string" && up("call", event.detail), true);
})();
