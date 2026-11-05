// The isolated half of page/net-main.js: passes its news to the worker extension's service worker.
(() => {
  if (globalThis.__applyNetRelay) return;
  globalThis.__applyNetRelay = true;
  document.addEventListener("apply-worker-net", (event) => {
    try {
      chrome.runtime.sendMessage({ applyNet: JSON.parse(event.detail) }).catch(() => {});
    } catch {}
  });
})();
