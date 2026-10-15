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
    const textResult = fillText(field, value);
    if (!textResult.ok) return textResult;

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
   * Entry point field-map.js and content-script.js call — dispatches to
   * the right strategy by field shape.
   * @param {Element} field
   * @param {string} value
   * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
   */
  async function fillField(field, value) {
    if (field instanceof HTMLSelectElement) return fillSelect(field, value);
    if (field.getAttribute("role") === "combobox") return fillCombobox(field, value);
    return fillText(field, value);
  }

  window.WIA.fill = { fillField, setNativeValue };
})();
