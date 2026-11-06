// The guards' relay, in the worker extension's isolated world of every frame (ops/guard.js).
// It hands the service worker what the page's guard says it blocked (`__apply_said`) and each
// call of a binding Apply exposed (`__apply_call`). Both carry text only: an object from the
// page's world can't cross into this one.

(() => {
  // Each run takes over from the last: one from before a reload of the extension sends to a runtime that is gone.
  if (globalThis.__applyRelayOff) globalThis.__applyRelayOff();
  globalThis.__applyRelay = true;
  const up = (kind, detail) => {
    try {
      chrome.runtime.sendMessage({ applyGuard: kind, detail }).catch(() => {});
    } catch {}
  };
  const said = (event) => typeof event.detail === "string" && up("said", event.detail);
  const called = (event) => typeof event.detail === "string" && up("call", event.detail);
  document.addEventListener("__apply_said", said, true);
  document.addEventListener("__apply_call", called, true);
  globalThis.__applyRelayOff = () => {
    document.removeEventListener("__apply_said", said, true);
    document.removeEventListener("__apply_call", called, true);
  };
})();
