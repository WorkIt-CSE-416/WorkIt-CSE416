// Playwright's locators and actions for one frame, in the worker extension's isolated world.
//
// Loaded after vendor/injected.js (Playwright's own injected script, `__applyPW`), so
// selectors parse and match exactly as Playwright's do: css, internal:role, internal:text,
// internal:label, nth, has-text and the rest. Actions are synthetic DOM events, as any autofill
// extension makes (isTrusted: false). Each method answers {ok: value}, {retry: reason} while its
// element is missing or not actionable (Apply polls until its timeout), or {err: {name, message}}.

(() => {
  if (globalThis.__applyDom) return;
  const pw = globalThis.__applyPW;

  class Retry {
    constructor(reason) {
      this.reason = reason;
    }
  }
  const fail = (name, message) => Object.assign(new Error(message), { name });

  // A window without focus (a plain Worker's, behind Lisul's apps) fires no focus events at all:
  // focus() and blur() move document.activeElement, but the page hears no blur or focusout. A page
  // that takes a typed answer only as its box is left then never takes it: Workday's text boxes
  // store their value in React's onBlur (a focusout), so NVIDIA's First Name showed but saved
  // empty (KAN-709). `move` changes the focus; if what had it went unheard, it is told by hand,
  // at that moment, as a person's leaving is, before the rest of the click or key.
  function leaving(move) {
    const from = document.activeElement;
    let heard = false;
    const hear = (event) => {
      if (event.target === from) heard = true;
    };
    addEventListener("focusout", hear, true);
    try {
      return move();
    } finally {
      removeEventListener("focusout", hear, true);
      const to = document.activeElement;
      if (!heard && from && from !== to && from !== document.body && from !== document.documentElement && from.isConnected) {
        const relatedTarget = to && to !== document.body ? to : null;
        from.dispatchEvent(new FocusEvent("blur", { composed: true, relatedTarget }));
        from.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true, relatedTarget }));
      }
    }
  }

  const parsed = new Map();
  function all(selector) {
    let p = parsed.get(selector);
    if (!p) parsed.set(selector, (p = pw.parseSelector(selector)));
    return pw.querySelectorAll(p, document);
  }
  function one(selector) {
    const found = all(selector);
    if (!found.length) throw new Retry(`waiting for locator('${selector}')`);
    if (found.length > 1) throw fail("Strict", `strict mode violation: locator('${selector}') resolved to ${found.length} elements`);
    return found[0];
  }
  const is = (element, state) => pw.elementState(element, state, true).matches;

  function actionable(element, { force = false, enabled = true, editable = false } = {}) {
    if (force) return;
    if (!is(element, "visible")) throw new Retry("element is not visible");
    if (enabled && !is(element, "enabled")) throw new Retry("element is not enabled");
    if (editable && !is(element, "editable")) throw new Retry("element is not editable");
  }

  // The element's centre in the viewport, scrolled into view.
  function point(element, position) {
    if (element.scrollIntoViewIfNeeded) element.scrollIntoViewIfNeeded(true);
    else element.scrollIntoView({ block: "center", inline: "center" });
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) throw new Retry("element has no size");
    return position ? { x: box.left + position.x, y: box.top + position.y } : { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }

  const within = (node, ancestor) => {
    for (let n = node; n; n = n.parentNode || n.host) if (n === ancestor) return true;
    return false;
  };

  // What a real click at the point would land on: the element or something inside it.
  function hitTarget(element, at, force) {
    const root = element.getRootNode();
    let hit = (root.elementFromPoint ? root : document).elementFromPoint(at.x, at.y);
    while (hit?.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(at.x, at.y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    if (force) return hit && within(hit, element) ? hit : element;
    if (!hit) throw new Retry("element is outside of the viewport");
    if (!within(hit, element)) {
      const label = hit.closest?.("label");
      if (!(label && label.control === pw.retarget(element, "follow-label"))) {
        throw new Retry(`<${hit.tagName.toLowerCase()}${hit.id ? " id=" + hit.id : ""}> intercepts pointer events`);
      }
    }
    return hit;
  }

  function mouse(target, type, at, extra = {}) {
    const init = { bubbles: true, cancelable: true, composed: true, clientX: at.x, clientY: at.y, screenX: at.x, screenY: at.y,
                   view: window, button: 0, ...extra };
    const event = type.startsWith("pointer")
      ? new PointerEvent(type, { pointerId: 1, pointerType: "mouse", isPrimary: true, ...init })
      : new MouseEvent(type, init);
    return target.dispatchEvent(event);
  }

  function click(selector, { force = false, clickCount = 1, position, modifiers } = {}) {
    const element = one(selector);
    actionable(element, { force });
    const at = point(element, position);
    const target = hitTarget(element, at, force);
    const keys = { ctrlKey: !!modifiers?.includes("Control"), shiftKey: !!modifiers?.includes("Shift"),
                   altKey: !!modifiers?.includes("Alt"), metaKey: !!modifiers?.includes("Meta") };
    mouse(target, "pointerover", at, keys);
    mouse(target, "mouseover", at, keys);
    mouse(target, "pointermove", at, keys);
    mouse(target, "mousemove", at, keys);
    for (let n = 1; n <= clickCount; n++) {
      mouse(target, "pointerdown", at, { ...keys, buttons: 1, detail: n });
      if (mouse(target, "mousedown", at, { ...keys, buttons: 1, detail: n })) {
        const focusable = target.closest?.("input, select, textarea, button, a[href], [tabindex], [contenteditable]");
        if (focusable && document.activeElement !== focusable) leaving(() => focusable.focus());
        // A press on nothing focusable takes the focus away, as a real one does.
        else if (!focusable && document.activeElement && document.activeElement !== document.body) leaving(() => document.activeElement.blur());
      }
      mouse(target, "pointerup", at, { ...keys, detail: n });
      mouse(target, "mouseup", at, { ...keys, detail: n });
      mouse(target, "click", at, { ...keys, detail: n });
    }
    if (clickCount === 2) mouse(target, "dblclick", at, { ...keys, detail: 2 });
    return null;
  }

  function hover(selector, { force = false } = {}) {
    const element = one(selector);
    actionable(element, { force, enabled: false });
    const at = point(element);
    const target = hitTarget(element, at, force);
    for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]) mouse(target, type, at);
    return null;
  }

  const valueOf = (element) => ("value" in element && !element.isContentEditable ? element.value : element.innerText);

  function setValue(element, value) {
    if (element.isContentEditable) {
      element.textContent = value;
    } else {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Types `text` where the caret is, as a paste would: through the editing command, which
  // fires beforeinput and input as typing does; the value setter if the page refused it.
  function insert(element, text) {
    const before = valueOf(element);
    if (text === "") document.execCommand("delete");
    else document.execCommand("insertText", false, text);
    return valueOf(element) !== before || text === "";
  }

  function fill(selector, value, { force = false } = {}) {
    const element = one(selector);
    actionable(element, { force, editable: true });
    const answer = leaving(() => pw.fill(element, value));
    if (answer === "error:notconnected") throw new Retry("element is not attached to the DOM");
    if (answer === "needsinput") {
      const target = pw.retarget(element, "follow-label");
      if (!insert(target, value) || valueOf(target) !== value) setValue(target, value);
    }
    return null;
  }

  // Key names as Playwright takes them, to the key, code and keyCode a keyboard sends.
  const KEYS = {
    Enter: ["Enter", "Enter", 13], Tab: ["Tab", "Tab", 9], Escape: ["Escape", "Escape", 27], Backspace: ["Backspace", "Backspace", 8],
    Delete: ["Delete", "Delete", 46], ArrowUp: ["ArrowUp", "ArrowUp", 38], ArrowDown: ["ArrowDown", "ArrowDown", 40],
    ArrowLeft: ["ArrowLeft", "ArrowLeft", 37], ArrowRight: ["ArrowRight", "ArrowRight", 39], Home: ["Home", "Home", 36],
    End: ["End", "End", 35], PageUp: ["PageUp", "PageUp", 33], PageDown: ["PageDown", "PageDown", 34], Space: [" ", "Space", 32],
    " ": [" ", "Space", 32],
  };
  function keyOf(name) {
    if (KEYS[name]) return KEYS[name];
    if (name.length === 1) {
      const upper = name.toUpperCase();
      const code = /[a-z]/i.test(name) ? `Key${upper}` : /\d/.test(name) ? `Digit${name}` : "";
      return [name, code, upper.charCodeAt(0)];
    }
    return [name, name, 0];
  }

  function tabbables() {
    return [...document.querySelectorAll("input, select, textarea, button, a[href], [tabindex], [contenteditable]")].filter(
      (e) => !e.disabled && e.tabIndex >= 0 && is(e, "visible"));
  }

  // The caret keys' default: move the caret (Shift: extend the selection) a character, or to
  // the line's start or end (Home, End, Cmd+Arrow), in a field or in editable content.
  function caret(target, k, { shiftKey, metaKey }) {
    const back = k === "ArrowLeft" || k === "Home";
    const whole = k === "Home" || k === "End" || metaKey;
    if (typeof target.selectionStart === "number" && target.setSelectionRange) {
      const length = target.value.length;
      const [start, end] = [target.selectionStart, target.selectionEnd];
      const backward = target.selectionDirection === "backward";
      const moving = shiftKey ? (backward ? start : end) : back ? start : end;
      const collapsed = start === end;
      let to = whole ? (back ? 0 : length) : collapsed || shiftKey ? moving + (back ? -1 : 1) : moving;
      to = Math.max(0, Math.min(length, to));
      if (!shiftKey) target.setSelectionRange(to, to);
      else {
        const anchor = backward ? end : start;
        target.setSelectionRange(Math.min(anchor, to), Math.max(anchor, to), to < anchor ? "backward" : "forward");
      }
      return;
    }
    getSelection()?.modify?.(shiftKey ? "extend" : "move", back ? "backward" : "forward", whole ? "lineboundary" : "character");
  }

  // One key press on the focused element, with the default action a page relies on.
  function press(key) {
    const parts = key.split("+");
    const name = parts.pop() || "+";
    const modifiers = new Set(parts);
    const [k, code, keyCode] = keyOf(name);
    const target = document.activeElement || document.body;
    const init = { key: k, code, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true,
                   ctrlKey: modifiers.has("Control"), shiftKey: modifiers.has("Shift"), altKey: modifiers.has("Alt"),
                   metaKey: modifiers.has("Meta") || modifiers.has("ControlOrMeta") };
    const go = target.dispatchEvent(new KeyboardEvent("keydown", init));
    const plain = !init.ctrlKey && !init.metaKey && !init.altKey;
    if (go) {
      if (k.length === 1 && plain) {
        target.dispatchEvent(new KeyboardEvent("keypress", { ...init, charCode: k.charCodeAt(0) }));
        if (target.matches?.("input[type=checkbox], input[type=radio], button") && k === " ") target.click();
        else insert(target, k);
      } else if ((init.ctrlKey || init.metaKey) && name.toLowerCase() === "a") {
        if (target.select) target.select();
        else document.execCommand("selectAll");
      } else if (k === "Enter") {
        if (target.matches?.("textarea") || target.isContentEditable) insert(target, "\n");
        else if (target.matches?.("button, a[href], input[type=submit], input[type=button], input[type=checkbox], input[type=radio]")) target.click();
        else if (target.form) {
          const button = target.form.querySelector("button:not([type]), button[type=submit], input[type=submit]");
          if (button) button.click();
          else target.form.requestSubmit();
        }
      } else if (k === "Tab") {
        const list = tabbables();
        const at = list.indexOf(target);
        const next = list[(at + (init.shiftKey ? -1 : 1) + list.length) % list.length];
        leaving(() => next?.focus());
      } else if (/^(ArrowLeft|ArrowRight|Home|End)$/.test(k)) {
        caret(target, k, init);
      } else if (k === "Backspace") {
        document.execCommand("delete");
      } else if (k === "Delete") {
        document.execCommand("forwardDelete");
      }
    }
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keyup", init));
    return null;
  }

  function focusOn(selector) {
    const element = one(selector);
    const answer = leaving(() => pw.focusNode(element, true));
    if (answer === "error:notconnected") throw new Retry("element is not attached to the DOM");
  }

  function check(selector, checked, { force = false } = {}) {
    const element = one(selector);
    if (is(element, "checked") === checked) return null;
    click(selector, { force });
    if (is(element, "checked") !== checked) throw fail("Error", "Clicking the checkbox did not change its state");
    return null;
  }

  function select(selector, options, { force = false } = {}) {
    const element = one(selector);
    actionable(element, { force });
    const answer = pw.selectOptions(element, options);
    if (answer === "error:optionsnotfound") throw new Retry("did not find some options");
    if (answer === "error:optionnotenabled") throw new Retry("option being selected is not enabled");
    if (answer === "error:notconnected") throw new Retry("element is not attached to the DOM");
    return answer;
  }

  function files(selector, payloads) {
    const element = pw.retarget(one(selector), "follow-label");
    const answer = pw.setInputFiles(element, payloads.map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: f.base64, lastModifiedMs: Date.now() })));
    if (typeof answer === "string") throw fail("Error", answer);
    return null;
  }

  function read(selector, what) {
    if (what === "allInnerTexts") return all(selector).map((e) => e.innerText);
    if (what === "allTextContents") return all(selector).map((e) => e.textContent ?? "");
    if (what === "box") {
      const found = all(selector);
      if (!found.length) return null;
      const box = found[0].getBoundingClientRect();
      return { x: box.left, y: box.top, width: box.width, height: box.height };
    }
    const element = one(selector);
    if (what === "innerText") return element.innerText;
    if (what === "textContent") return element.textContent;
    if (what === "inputValue") {
      const target = pw.retarget(element, "follow-label");
      if (!target.matches("input, textarea, select")) throw fail("Error", "Not an <input>, <textarea> or <select> element");
      return target.value;
    }
    if (what.startsWith("attribute:")) return element.getAttribute(what.slice("attribute:".length));
    throw fail("BadOp", `can't read ${what}`);
  }

  function state(selector, wanted) {
    const found = all(selector);
    if (!found.length) return { found: 0, value: wanted === "hidden" || wanted === "detached" };
    if (wanted === "attached" || wanted === "detached") return { found: found.length, value: wanted === "attached" };
    return { found: found.length, value: is(found[0], wanted) };
  }

  const METHODS = {
    count: (selector) => all(selector).length,
    state,
    read,
    click,
    fill,
    type(selector, text) {
      focusOn(selector);
      for (const character of text) press(character);
      return null;
    },
    press(selector, key) {
      focusOn(selector);
      return press(key);
    },
    keys: (key) => press(key), // on whatever has focus (page.keyboard)
    insert: (text) => (insert(document.activeElement || document.body, text), null),
    check,
    select,
    focus: (selector) => (focusOn(selector), null),
    blur(selector) {
      const element = one(selector);
      leaving(() => pw.blurNode(element));
      return null;
    },
    hover,
    scroll(selector) {
      point(one(selector));
      return null;
    },
    files,
    mark(selector, token) {
      const found = all(selector);
      for (const element of found) element.setAttribute("data-apply-mark", token);
      return found.length;
    },
    unmark(token) {
      for (const element of document.querySelectorAll(`[data-apply-mark="${CSS.escape(token)}"]`)) element.removeAttribute("data-apply-mark");
      return null;
    },
    aria: (selector, options = {}) => pw.ariaSnapshot(one(selector), { mode: "expect", ...options }),
  };

  const TOUCHES = new Set(["click", "type", "press", "keys", "check"]);

  globalThis.__applyDom = {
    leaving, // for page/tile.js's presses
    run(method, args) {
      const fn = METHODS[method];
      if (!fn) return { err: { name: "BadOp", message: `no dom method ${method}` } };
      // A press of Apply's counts as a touch for the page's guard (apply.plain.guards), as a
      // trusted click of Playwright's does: the guard then shows what it blocked.
      if (TOUCHES.has(method)) window.dispatchEvent(new CustomEvent("__apply_touch", { detail: "apply" }));
      try {
        const value = fn(...args);
        return { ok: value === undefined ? null : value };
      } catch (error) {
        if (error instanceof Retry) return { retry: error.reason };
        return { err: { name: error?.name && error.name !== "Error" ? error.name : "Error", message: String(error?.message ?? error) } };
      }
    },
  };
})();
