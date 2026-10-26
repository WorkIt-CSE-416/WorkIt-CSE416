// The panel's small shared helpers, loaded before every other panel and fill
// file (manifest.json, background.js SHELL_FILES, shared/content-scripts.js):
//
// - ask(message): chrome.runtime.sendMessage, rejecting as it does.
// - send(message): the same, but a failed send answers null.
// - el(tag, className, text) and button(label, onPress): the panel's nodes.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  if (window.WIA.ui) return;

  const ask = (message) => chrome.runtime.sendMessage(message);
  const send = (message) => Promise.resolve(chrome.runtime.sendMessage(message)).catch(() => null);

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const button = (label, onPress) => {
    const node = el("button", null, label);
    node.type = "button";
    node.addEventListener("click", onPress);
    return node;
  };

  window.WIA.ui = { ask, send, el, button };
})();
