// Fix from the window (S3, KAN-609): one of Lisul's tile events replayed on this frame, in the
// worker extension's isolated world, as synthetic DOM events (isTrusted: false).
//
// Loaded after vendor/injected.js and page/dom.js, whose key presses and inserts it reuses.
// A point is in CSS pixels of this frame's viewport; a tile's point comes scaled from the
// frame it saw (width x height). A point or a key that lands on an <iframe> answers
// {descend: {child: {url, index}, x?, y?}}, and the service worker replays it in that frame.
//
// Answers: null; {menu: {options, selected}} for a press on a <select> (the tile draws its
// options, and {type: "choose", index} picks one); {chooser: "selectSingle"|"selectMultiple"}
// when a click asked for a file (no picker opens without user activation: the tile asks
// Lisul for the file, and the chooser.set op gives it); {text} for a copy.

(() => {
  if (globalThis.__applyTile) return;
  const BUTTONS = { left: 0, middle: 1, right: 2 };
  const HELD = { left: 1, middle: 4, right: 2 };
  const FOCUSABLE = "input, select, textarea, button, a[href], [tabindex], [contenteditable], summary";
  const TEXTY = /^(text|search|email|tel|url|password|number)$/;
  let pressed = null; // {target, button} of the press not yet let go
  let hovered = null;
  let select = null; // the <select> whose options the tile shows

  function deepest(x, y) {
    let hit = document.elementFromPoint(x, y);
    while (hit?.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    return hit;
  }

  // Which child frame an <iframe> is, for the service worker to find among webNavigation's:
  // its address, and its place among this document's iframes at that address.
  function child(frameElement) {
    const url = (element) => {
      try {
        return element.contentWindow.location.href; // same origin
      } catch {
        return element.src || "about:blank";
      }
    };
    const address = url(frameElement);
    const same = [...document.querySelectorAll("iframe, frame")].filter((f) => url(f) === address);
    return { url: address, index: Math.max(0, same.indexOf(frameElement)) };
  }

  // The point in the iframe's own viewport, which starts at its content box.
  function into(frameElement, x, y) {
    const box = frameElement.getBoundingClientRect();
    const style = getComputedStyle(frameElement);
    const left = box.left + frameElement.clientLeft + parseFloat(style.paddingLeft || 0);
    const top = box.top + frameElement.clientTop + parseFloat(style.paddingTop || 0);
    return { child: child(frameElement), x: x - left, y: y - top };
  }
  const isFrame = (element) => element && /^I?FRAME$/.test(element.tagName);

  function mouse(target, type, at, extra = {}) {
    const init = { bubbles: true, cancelable: true, composed: true, clientX: at.x, clientY: at.y,
                   screenX: at.x + (window.screenX || 0), screenY: at.y + (window.screenY || 0), view: window, ...extra };
    const event = type.startsWith("pointer")
      ? new PointerEvent(type, { pointerId: 1, pointerType: "mouse", isPrimary: true, ...init })
      : type === "wheel" ? new WheelEvent(type, init) : new MouseEvent(type, init);
    return target.dispatchEvent(event);
  }

  function hover(target, at) {
    if (target === hovered) return;
    if (hovered?.isConnected) {
      mouse(hovered, "pointerout", at, { relatedTarget: target });
      mouse(hovered, "mouseout", at, { relatedTarget: target });
    }
    mouse(target, "pointerover", at, { relatedTarget: hovered });
    mouse(target, "mouseover", at, { relatedTarget: hovered });
    hovered = target;
  }

  // Where a click by these two points lands: the nearest element holding both (as Chrome does).
  function common(a, b) {
    for (let n = a; n; n = n.parentNode || n.host) {
      if (n.nodeType === 1 && n.contains(b)) return n;
    }
    return b;
  }

  // The file input a click asked for, as the chooser hooks (ops/tile.js) mark it on <html>: a
  // click on the input or its label, or the page's own input.click() or showPicker().
  const askedFor = () => document.documentElement.getAttribute("data-apply-chooser");

  function down(target, at, event) {
    const button = BUTTONS[event.button] ?? 0;
    const detail = event.clicks || 1;
    hover(target, at);
    pressed = { target, button };
    mouse(target, "pointerdown", at, { button, buttons: HELD[event.button] ?? 1, detail });
    if (mouse(target, "mousedown", at, { button, buttons: HELD[event.button] ?? 1, detail }) && button === 0) {
      const focusable = target.closest?.(FOCUSABLE);
      // Each focus move through page/dom.js's leaving: an unfocused window tells the box left nothing (KAN-709).
      const { leaving } = globalThis.__applyDom;
      if (focusable && document.activeElement !== focusable) {
        leaving(() => focusable.focus());
        // A real click puts the caret where it lands; the end of the text is the nearest a script can say.
        if (focusable.matches("textarea") || (focusable.matches("input") && TEXTY.test(focusable.type))) {
          try {
            focusable.setSelectionRange(focusable.value.length, focusable.value.length);
          } catch {}
        }
      } else if (!focusable && document.activeElement && document.activeElement !== document.body) {
        leaving(() => document.activeElement.blur()); // a press on nothing focusable takes the focus away, as a real one does
      }
    }
    const pick = button === 0 ? target.closest?.("select") : null;
    if (pick && !pick.disabled && !pick.multiple && !(pick.size > 1)) {
      select = pick;
      return { menu: { options: [...pick.options].map((o) => ({ label: o.label, disabled: o.disabled })), selected: pick.selectedIndex } };
    }
    return null;
  }

  function up(target, at, event) {
    const button = BUTTONS[event.button] ?? 0;
    const detail = event.clicks || 1;
    mouse(target, "pointerup", at, { button, buttons: 0, detail });
    mouse(target, "mouseup", at, { button, buttons: 0, detail });
    const from = pressed;
    pressed = null;
    if (!from || from.button !== button) return null;
    const clicked = common(from.target, target);
    if (button === 2) {
      mouse(clicked, "contextmenu", at, { button, detail });
      return null;
    }
    if (button !== 0) {
      mouse(clicked, "auxclick", at, { button, detail });
      return null;
    }
    document.documentElement.removeAttribute("data-apply-chooser");
    mouse(clicked, "click", at, { button, detail });
    if (detail === 2) mouse(clicked, "dblclick", at, { button, detail });
    // A click that asked for a file opens no picker without user activation: the tile asks Lisul instead.
    return askedFor() ? { chooser: askedFor() } : null;
  }

  function scrollable(element, dx, dy) {
    for (let n = element; n && n.nodeType === 1; n = n.parentElement || n.getRootNode()?.host) {
      const style = getComputedStyle(n);
      const canY = dy && /(auto|scroll|overlay)/.test(style.overflowY) && n.scrollHeight > n.clientHeight &&
        (dy > 0 ? n.scrollTop + n.clientHeight < n.scrollHeight : n.scrollTop > 0);
      const canX = dx && /(auto|scroll|overlay)/.test(style.overflowX) && n.scrollWidth > n.clientWidth &&
        (dx > 0 ? n.scrollLeft + n.clientWidth < n.scrollWidth : n.scrollLeft > 0);
      if (canY || canX) return n;
    }
    return null;
  }

  function wheel(target, at, event) {
    const dx = Number(event.dx) || 0;
    const dy = Number(event.dy) || 0;
    hover(target, at);
    if (!mouse(target, "wheel", at, { deltaX: dx, deltaY: dy, deltaMode: 0 })) return null; // the page scrolls it itself
    const box = scrollable(target, dx, dy);
    if (box) box.scrollBy({ left: dx, top: dy, behavior: "instant" });
    else window.scrollBy({ left: dx, top: dy, behavior: "instant" });
    return null;
  }

  function selected() {
    const field = document.activeElement;
    try {
      if (field && typeof field.selectionStart === "number") return field.value.slice(field.selectionStart, field.selectionEnd);
    } catch {}
    return String(document.getSelection());
  }

  function choose(index) {
    if (!select || !select.isConnected) return null;
    select.focus();
    select.selectedIndex = index;
    select.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return null;
  }

  const keys = (method, value) => {
    const answer = globalThis.__applyDom.run(method, [value]);
    if (answer.err) throw Object.assign(new Error(answer.err.message), { name: answer.err.name });
    return null;
  };

  function run(event) {
    const kind = event.type;
    if (kind === "down" || kind === "up" || kind === "move" || kind === "wheel") {
      const at = event.width ? { x: (event.x * innerWidth) / event.width, y: (event.y * innerHeight) / event.height } : { x: event.x, y: event.y };
      // A press let go: on whatever is under the pointer, or what was pressed when it left the page.
      const target = deepest(at.x, at.y) || (kind === "up" && pressed?.target) || document.documentElement;
      if (isFrame(target) && !(kind === "up" && pressed)) return { descend: into(target, at.x, at.y) };
      if (kind === "move") {
        hover(target, at);
        mouse(target, "pointermove", at, { buttons: pressed ? 1 : 0 });
        mouse(target, "mousemove", at, { buttons: pressed ? 1 : 0 });
        return null;
      }
      if (kind === "down") return down(target, at, event);
      if (kind === "up") return up(target, at, event);
      return wheel(target, at, event);
    }
    // Keys, text and copy go where the focus is: into a focused iframe, its own frame.
    if (kind !== "choose" && isFrame(document.activeElement)) return { descend: { child: child(document.activeElement) } };
    if (kind === "text") return String(event.text).length === 1 ? keys("keys", event.text) : keys("insert", event.text);
    if (kind === "key") return keys("keys", [...(event.modifiers || []), event.key].join("+"));
    if (kind === "copy") return { text: selected() };
    if (kind === "choose") return choose(event.index);
    throw Object.assign(new Error(`no tile event ${kind}`), { name: "BadOp" });
  }

  globalThis.__applyTile = {
    run(event) {
      try {
        return { ok: run(event) };
      } catch (error) {
        return { err: { name: error?.name && error.name !== "Error" ? error.name : "Error", message: String(error?.message ?? error) } };
      }
    },
  };
})();
