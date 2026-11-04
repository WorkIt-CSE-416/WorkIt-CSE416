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
    input.setAttribute("data-apply-chooser", token);
    state.chooser = { token, multiple: input.multiple, accept: input.accept || "", at: Date.now() };
  }
  window.addEventListener("click", (event) => {
    const hit = event.composedPath()[0];
    if (hit instanceof HTMLInputElement) chosen(hit);
    else if (hit?.closest?.("label")?.control) chosen(hit.closest("label").control);
  }, true);
  const showPicker = HTMLInputElement.prototype.showPicker;
  if (showPicker) {
    HTMLInputElement.prototype.showPicker = function () {
      if (this.type === "file") return chosen(this);
      return showPicker.call(this);
    };
  }
})();
