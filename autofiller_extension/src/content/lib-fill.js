// Writing a value into a field so it actually sticks. The architecture
// research is specific about why this is its own problem: React and Vue
// track an input's value through their own synthetic event system, so
// `field.value = x` alone is invisible to a controlled component — the
// framework's state never updates, and the value can even snap back. A
// native dropdown and a custom combobox also need entirely different
// fill strategies, which is the other half of what this file is for.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  ).set;

  /**
   * Sets .value through the element's native setter (bypassing whatever
   * React/Vue has wrapped it with via a property descriptor override), then
   * fires the real events those frameworks actually listen for. This is
   * the documented workaround for "I set .value but the UI doesn't change"
   * on any controlled-input framework.
   * @param {HTMLInputElement | HTMLTextAreaElement} field
   * @param {string} value
   */
  function setNativeValue(field, value) {
    const setter = field instanceof HTMLTextAreaElement ? nativeTextareaValueSetter : nativeInputValueSetter;
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /**
   * @param {Element} field
   * @param {string} value
   * @returns {{ ok: true } | { ok: false, reason: string }}
   */
  function fillText(field, value) {
    if (field.isContentEditable) {
      field.textContent = value;
      field.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
      return { ok: true };
    }
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      setNativeValue(field, value);
      return { ok: true };
    }
    return { ok: false, reason: "Not a fillable text field" };
  }

  /**
   * Native <select>. Tries an exact value match first (some ATSs use
   * machine-readable option values, e.g. ISO country codes), then a
   * case-insensitive match on the visible option text.
   * @param {HTMLSelectElement} field
   * @param {string} value
   * @returns {{ ok: true } | { ok: false, reason: string }}
   */
  function fillSelect(field, value) {
    const options = Array.from(field.options);
    const target = value.trim().toLowerCase();

    const match =
      options.find((o) => o.value === value) ??
      options.find((o) => o.textContent?.trim().toLowerCase() === target) ??
      options.find((o) => o.textContent?.trim().toLowerCase().includes(target));

    if (!match) {
      // THE FIX for JobRight's "SUNY Korea → No results found" bug: a
      // dropdown that can't match the value is reported as a specific
      // failure, immediately — never left silently blank inside an
      // aggregate percentage. See lib-status.js for how this surfaces.
      return { ok: false, reason: `No option matches "${value}"` };
    }
    field.value = match.value;
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }

  /**
   * A short wait for a debounced search to render its filtered options —
   * most ATS comboboxes search on a 150–400ms debounce. Polls rather than
   * using a single fixed delay, so it resolves as soon as options actually
   * exist instead of always waiting the worst case.
   * @param {() => Element[]} getOptions
   * @param {number} [timeoutMs]
   */
  function waitForOptions(getOptions, timeoutMs = 1200) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const options = getOptions();
        if (options.length > 0 || Date.now() - start > timeoutMs) {
          resolve(options);
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  /**
   * Types `value` into a combobox one character at a time, with a real
   * keydown/input/keyup around each one — not the single bulk value-set
   * setNativeValue does for a plain text field. Confirmed necessary live on
   * Greenhouse: its comboboxes are built with react-select, which only
   * opens its listbox (and sets the aria-controls pointing to it) in
   * response to real per-character input — a single native-setter-plus-one-
   * generic-"input"-event left aria-expanded stuck at "false" and
   * aria-controls never set, so fillCombobox's listbox lookup fell through
   * to whatever unrelated [role=listbox] happened to already exist on the
   * page (on one real posting: the phone field's country-code picker) and
   * never matched, no matter how correct the typed value was. react-select
   * is common enough across ATS vendors that this needs to be the default
   * typing strategy for every combobox, not a Greenhouse-specific path.
   * @param {HTMLInputElement} field
   * @param {string} value
   */
  async function typeIntoCombobox(field, value) {
    field.focus();
    nativeInputValueSetter.call(field, "");
    field.dispatchEvent(new Event("input", { bubbles: true }));

    for (const ch of value) {
      const next = field.value + ch;
      field.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
      nativeInputValueSetter.call(field, next);
      field.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
      field.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
      // Deliberately sequential and slightly paced, not Promise.all — mimics
      // real typing cadence for a debounced search handler that only fires
      // once input goes quiet, and gives a remote-search field (e.g. a
      // school-name lookup hitting a real API) a moment between keystrokes
      // rather than firing the whole string as one burst.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /**
   * Custom dropdown/combobox widgets (role="combobox", often paired with a
   * role="listbox" that only exists in the DOM while open) — the pattern
   * every vendor in the architecture research uses: type into the field to
   * trigger its own filtering, then click the option that matches, because
   * these widgets don't expose a settable .value the way a native <select>
   * does.
   *
   * BEST EFFORT, clearly labeled as such: the listbox-finding heuristic
   * (aria-controls, then a nearby [role=listbox]) won't cover every
   * component library. A combobox that doesn't match either shape fails
   * with a specific reason rather than silently doing nothing — same
   * principle as fillSelect above.
   * @param {Element} field
   * @param {string} value
   * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
   */
  async function fillCombobox(field, value) {
    if (field instanceof HTMLInputElement) {
      await typeIntoCombobox(field, value);
    } else {
      const textResult = fillText(field, value);
      if (!textResult.ok) return textResult;
    }

    const listboxId = field.getAttribute("aria-controls");
    const findOptions = () => {
      const listbox = listboxId
        ? document.getElementById(listboxId)
        : field.closest("[role='combobox'], div")?.querySelector("[role='listbox']") ??
          document.querySelector("[role='listbox']");
      if (!listbox) return [];
      return Array.from(listbox.querySelectorAll("[role='option'], li"));
    };

    const options = await waitForOptions(findOptions);
    if (options.length === 0) {
      return { ok: false, reason: `No options appeared for "${value}"` };
    }

    const target = value.trim().toLowerCase();
    const match =
      options.find((o) => o.textContent?.trim().toLowerCase() === target) ??
      options.find((o) => o.textContent?.trim().toLowerCase().includes(target));

    if (!match) {
      // The exact failure the research doc caught JobRight hitting — now a
      // named, visible state instead of a silently blank field.
      return { ok: false, reason: `No option matches "${value}"` };
    }
    match.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    match.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return { ok: true };
  }

  /**
   * Attaches a file to a native `<input type="file">` — the only way a
   * script can: `.value` is read-only on a file input, and assigning a
   * plain array to `.files` is rejected outright, so a real `FileList` has
   * to come from a `DataTransfer`, same as a user's own file picker
   * produces. Dispatching "change" afterward is what tells a framework
   * (Greenhouse's own resume-upload widget included) that a file was
   * chosen, same principle as setNativeValue above for text fields.
   * @param {Element} field
   * @param {{ filename: string, mimeType: string, base64: string }} resume
   * @returns {{ ok: true } | { ok: false, reason: string }}
   */
  function fillFile(field, resume) {
    if (!(field instanceof HTMLInputElement) || field.type !== "file") {
      return { ok: false, reason: "Not a file field" };
    }
    let bytes;
    try {
      const binary = atob(resume.base64);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } catch {
      return { ok: false, reason: "Could not read the resume file" };
    }
    const file = new File([bytes], resume.filename, { type: resume.mimeType });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    field.files = transfer.files;
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }

  /**
   * Dispatches to the right strategy by field shape, for one candidate
   * value.
   * @param {Element} field
   * @param {string} value
   * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
   */
  async function fillOne(field, value) {
    if (field instanceof HTMLSelectElement) return fillSelect(field, value);
    if (field.getAttribute("role") === "combobox") return fillCombobox(field, value);
    return fillText(field, value);
  }

  /**
   * Entry point field-map.js and content-script.js call. `value` is
   * usually one string, but a rule that cares what kind of field it landed
   * on without inspecting the DOM itself (field-map.js never sees the
   * element) can instead give an ordered list of candidates — the first
   * one `fillOne` accepts wins. A free-text field accepts its first
   * candidate immediately, since fillText only ever fails on a field that
   * cannot hold text at all; a select or combobox tries each in turn,
   * which is what lets "WorkIt" be offered first (an unlikely but honest
   * try, for a free-text field that really does take it) and "Job Board"
   * be a safe second choice no real dropdown's own option list is likely
   * to miss (the "How did you hear about us?" rule in field-map.js is the
   * one caller today).
   * @param {Element} field
   * @param {string | string[]} value
   * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
   */
  async function fillField(field, value) {
    const candidates = Array.isArray(value) ? value : [value];
    let last = { ok: false, reason: "No value to fill" };
    for (const candidate of candidates) {
      if (!candidate) continue;
      // eslint-disable-next-line no-await-in-loop -- each candidate must be
      // tried in order, not raced: a combobox candidate types into the
      // field itself, so two at once would corrupt each other's input.
      last = await fillOne(field, candidate);
      if (last.ok) return last;
    }
    return last;
  }

  window.WIA.fill = { fillField, setNativeValue, fillFile };
})();
