// The page's modal state for Claude's browser tools (S6), in the page's MAIN world from
// document_start (a registered content script) and in pages already open (injected once).
//
// A plain Worker has no CDP, so nothing outside the page can hold a native dialog open: this
// answers alert/confirm/prompt at once and records them (by default confirm and prompt are
// dismissed, as Playwright dismisses a dialog no one handles), and Claude's browser_handle_dialog
// sets the answer to the next one. A file input that would open its picker (a click on it, on
// its label, or showPicker) is recorded as the open file chooser; synthetic clicks open no picker,
// so browser_file_upload then sets the files on that input through DataTransfer.

(() => {
  if (window.__applyModal) return;
  const state = { dialogs: [], chooser: null, answer: null };
  Object.defineProperty(window, "__applyModal", { value: state });

  function answer(type, message, fallback) {
    const told = state.answer;
    state.answer = null;
    const accept = told ? !!told.accept : type === "alert";
    state.dialogs.push({ type, message: String(message ?? ""), accepted: accept, at: Date.now() });
    return { accept, text: told?.promptText ?? fallback ?? "" };
  }
  window.alert = function alert(message) {
    answer("alert", message);
  };
  window.confirm = function confirm(message) {
    return answer("confirm", message).accept;
  };
  window.prompt = function prompt(message, fallback) {
    const said = answer("prompt", message, fallback);
    return said.accept ? String(said.text) : null;
  };

  let seq = 0;
  function chosen(input) {
    if (!(input instanceof HTMLInputElement) || input.type !== "file" || input.disabled || !input.isConnected) return;
    const token = `c${Date.now().toString(36)}${(seq++).toString(36)}`;
    input.setAttribute("data-apply-mcp-chooser", token);
    state.chooser = { token, multiple: input.multiple, accept: input.accept || "", at: Date.now() };
  }
  window.addEventListener("click", (event) => {
    const hit = event.composedPath()[0];
    if (hit instanceof HTMLInputElement) chosen(hit);
    else if (hit?.closest?.("label")?.control) chosen(hit.closest("label").control);
  }, true);
  // A page's input.click() / showPicker(): recorded, then passed on (to the tile's chooser hook,
  // S3's ops/tile.js, when it was installed first; it keeps the input and opens no picker).
  const proto = HTMLInputElement.prototype;
  const click = proto.click;
  proto.click = function () {
    if (this.type === "file") chosen(this);
    return click.call(this);
  };
  const showPicker = proto.showPicker;
  if (showPicker) {
    proto.showPicker = function () {
      if (this.type === "file") chosen(this);
      return showPicker.call(this);
    };
  }
  // The input the tile's hook kept, when its wrapper ran before ours could see the call.
  Object.defineProperty(state, "fromTile", {
    value() {
      const input = document.querySelector("[data-apply-chooser-input]") || window[Symbol.for("apply.chooser")];
      if (input && !input.hasAttribute("data-apply-mcp-chooser")) chosen(input);
    },
  });
  // Once Claude used or cancelled the chooser, the tile's mark of it goes too.
  Object.defineProperty(state, "closeTile", {
    value() {
      document.documentElement.removeAttribute("data-apply-chooser");
      document.querySelector("[data-apply-chooser-input]")?.removeAttribute("data-apply-chooser-input");
      window[Symbol.for("apply.chooser")] = null;
    },
  });
})();
