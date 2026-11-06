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
  const told = (event) => typeof event.detail === "string" && up("tell", event.detail);
  document.addEventListener("__apply_said", said, true);
  document.addEventListener("__apply_call", called, true);
  // The run's guard events (KAN-710): the touch page/dom.js sends before each press of Apply's, and the rehearsal
  // guard's tell (Lisul's press of a Submit, his Fill again or Dismiss), named with tokens no page knows.
  let tell = "";
  try {
    chrome.runtime.sendMessage({ applyGuard: "tokens" }).then((tokens) => {
      if (!tokens || off) return;
      globalThis.__applyTouchTypes = Array.isArray(tokens.touch) ? tokens.touch : [];
      tell = typeof tokens.tell === "string" ? tokens.tell : "";
      if (tell) document.addEventListener(tell, told, true);
    }).catch(() => {});
  } catch {}
  let off = false;
  globalThis.__applyRelayOff = () => {
    off = true;
    document.removeEventListener("__apply_said", said, true);
    document.removeEventListener("__apply_call", called, true);
    if (tell) document.removeEventListener(tell, told, true);
  };
})();
