// Field discovery: walking Shadow DOM, and pairing a field with its label
// when the two don't share a simple <label for> relationship. Both are
// named in the research doc as the two concrete reasons generic autofill
// breaks on real ATS pages — this file exists specifically to fix them,
// not as general-purpose DOM utilities.
//
// No module exports/imports: Chrome's static content_scripts declaration
// (manifest.json) doesn't support ES modules, so this and its sibling
// content/ files are loaded as plain scripts, in order, sharing one global
// namespace instead. See content-script.js's own comment for the load order.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  const FIELD_SELECTOR = [
    "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset])",
    "select",
    "textarea",
    '[role="combobox"]',
    '[contenteditable="true"]',
  ].join(", ");

  /**
   * True for an element a user could actually see and interact with.
   * display:none and visibility:hidden both leave offsetParent null (for
   * anything but position:fixed, which form fields essentially never are),
   * so that one check covers both without a getComputedStyle call per field.
   * @param {Element} el
   */
  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return true; // non-HTML elements (rare) — don't filter them out
    return el.offsetParent !== null || el.getClientRects().length > 0;
  }

  /**
   * Every element under root, including inside open shadow roots, however
   * deeply nested, in document order (each element before its own
   * children, each child before its next sibling — a plain top-to-bottom
   * recursive walk, not a stack-based one: a stack popped LIFO visits a
   * node's most-recently-pushed child first, which reverses sibling order
   * at every level past the first and silently breaks anything that relies
   * on "earlier in this array = earlier on the page", like
   * findAddButton's section-proximity matching below). Closed shadow roots
   * (`attachShadow({mode:'closed'})`) are invisible to any extension by
   * design — there's no API around that, and it's rare for a form field to
   * sit inside one.
   * @param {Element | ShadowRoot | Document} root
   * @returns {Element[]}
   */
  function walkAllElements(root) {
    const out = [];
    function visit(node) {
      const children = node.children ? Array.from(node.children) : [];
      for (const child of children) {
        out.push(child);
        visit(child);
        if (child.shadowRoot) visit(child.shadowRoot);
      }
    }
    visit(root);
    return out;
  }

  /**
   * @param {Element | Document} [root]
   * @returns {Element[]}
   */
  function findFormFields(root = document) {
    return walkAllElements(root)
      .filter((el) => el.matches?.(FIELD_SELECTOR))
      .filter(isVisible);
  }

  /**
   * @param {Element} field
   * @returns {string | null}
   */
  function labelledByAttribute(field) {
    const ids = field.getAttribute("aria-labelledby");
    if (!ids) return null;
    const text = ids
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    return text || null;
  }

  /**
   * `<label for="field-id">` — the simple case. Checked across the whole
   * document AND the field's own root (covers a label living inside the
   * same shadow root as the field, which getElementById on `document`
   * alone would miss).
   * @param {Element} field
   */
  function explicitLabel(field) {
    if (!field.id) return null;
    const root = field.getRootNode();
    const label = (root.getElementById?.(field.id)) ?? document.getElementById(field.id);
    // getElementById finds the field itself if IDs collide with a <label
    // for> pointing elsewhere; querySelector scoped to label[for] is exact.
    const viaSelector = root.querySelector?.(`label[for="${CSS.escape(field.id)}"]`);
    return viaSelector?.textContent?.trim() || (label !== field ? label?.textContent?.trim() : null) || null;
  }

  /**
   * `<label>...<input>...</label>` — the field is a descendant of its own
   * label, no `for`/`id` needed.
   * @param {Element} field
   */
  function wrappingLabel(field) {
    const label = field.closest("label");
    if (!label) return null;
    // Exclude the field's own value if it's an <input> whose text somehow
    // leaks in (rare, but cheap to guard) — clone and strip form elements.
    const clone = label.cloneNode(true);
    clone.querySelectorAll("input, select, textarea").forEach((n) => n.remove());
    return clone.textContent?.trim() || null;
  }

  /**
   * The fallback: component-framework ATSs often render a field's visible
   * label in a sibling or cousin element, not a wrapping or `for`-linked
   * one. Walk up a few ancestor levels and take the nearest preceding
   * text-bearing element at each level — not exhaustive, but the
   * architecture research specifically names "structural proximity" as the
   * common real-world approach, not a more exact alternative.
   * @param {Element} field
   */
  function proximityLabel(field) {
    let node = field;
    for (let depth = 0; depth < 4 && node.parentElement; depth++) {
      const parent = node.parentElement;
      for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        if (sibling.matches(FIELD_SELECTOR)) break; // hit the previous field first — stop, wrong label
        const text = sibling.textContent?.trim();
        if (text && text.length < 120) return text;
      }
      node = parent;
    }
    return null;
  }

  /**
   * Tries every strategy in order and returns the first hit, or null if
   * none of them found anything — callers (field-map.js) treat a null
   * label as "can't classify this field", not as an empty-string label.
   * @param {Element} field
   * @returns {string | null}
   */
  function findLabelText(field) {
    return (
      labelledByAttribute(field) ||
      explicitLabel(field) ||
      wrappingLabel(field) ||
      field.getAttribute("aria-label")?.trim() ||
      field.getAttribute("placeholder")?.trim() ||
      proximityLabel(field) ||
      null
    );
  }

  const CLICKABLE_SELECTOR = 'button:not([type=submit]), [role="button"], a, input[type="button"]';
  const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, legend, [role="heading"]';
  // Some Workday forms give every repeated section's add control the exact
  // same bare "Add" (or "+") wording, with nothing in the button itself
  // saying which section it belongs to — the section name only appears
  // once, in that section's own heading above it.
  const GENERIC_ADD_PATTERN = /^\+?\s*add\b/i;

  /** @param {Element} el */
  function visibleText(el) {
    return (el.textContent || el.getAttribute("value") || el.getAttribute("aria-label") || "").trim();
  }

  /**
   * @returns {Element[]} Every visible, enabled clickable element. Submit
   *   buttons are excluded so a stray "add" in their label can never cause
   *   this to click Submit instead of an actual add control.
   */
  function clickableElements() {
    return walkAllElements(document).filter((el) => el.matches?.(CLICKABLE_SELECTOR) && isVisible(el) && !el.disabled);
  }

  /**
   * Finds, among `candidates`, the one nearest the section whose heading
   * matches `sectionPattern` — the smallest ancestor of that heading that
   * contains at least one candidate, preferring whichever candidate comes
   * after the heading in document order (so an ancestor broad enough to
   * also catch a different, earlier section's button doesn't win by
   * accident).
   * @param {Element[]} candidates
   * @param {RegExp} sectionPattern
   * @returns {Element | null}
   */
  function nearestToSectionHeading(candidates, sectionPattern) {
    const heading = walkAllElements(document).find(
      (el) =>
        el.matches?.(HEADING_SELECTOR) &&
        isVisible(el) &&
        sectionPattern.test(visibleText(el)) &&
        visibleText(el).length < 60, // a real heading is a label, not a paragraph that happens to mention the word
    );
    if (!heading) return null;

    for (let node = heading, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
      const inSection = candidates.filter((el) => node.contains(el));
      if (inSection.length === 0) continue;
      return (
        inSection.find((el) => heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) ?? inSection[0]
      );
    }
    return null;
  }

  /**
   * Finds a clickable "Add another X" control. Tries the button's own
   * wording first (`specificPattern` — e.g. "Add Another Education"); some
   * Workday forms instead give every section's add control identical bare
   * "Add" wording with no section name on the button itself, so this falls
   * back to every generic add-like control on the page, disambiguated by
   * which section heading (`sectionPattern`) it sits nearest to in the DOM
   * — or returned outright if it's the only generic add control on the
   * whole page, where there's nothing to disambiguate. A false-positive
   * match is possible but low-risk: the worst case is one extra visible UI
   * click the overlay's failure/success message makes obvious, not a
   * destructive action.
   * @param {RegExp} specificPattern Matched case-insensitively against the
   *   button's own text/value/aria-label — pass the `i` flag.
   * @param {RegExp} sectionPattern Matched against a heading's text to find
   *   this button's section when its own wording doesn't say — also pass
   *   the `i` flag.
   * @returns {Element | null}
   */
  function findAddButton(specificPattern, sectionPattern) {
    const clickable = clickableElements();

    const direct = clickable.find((el) => specificPattern.test(visibleText(el)));
    if (direct) return direct;

    const generic = clickable.filter((el) => GENERIC_ADD_PATTERN.test(visibleText(el)));
    if (generic.length === 0) return null;
    if (generic.length === 1) return generic[0]; // the only add-like control on the page — unambiguous regardless of its wording

    return nearestToSectionHeading(generic, sectionPattern);
  }

  /**
   * Polls `predicate` until it's true or `timeoutMs` elapses. For DOM
   * changes with no reliable completion event — here, a clicked "Add"
   * button's new block finishing its render. Same polling shape as
   * lib-fill.js's waitForOptions, generalized to any condition instead of
   * "got a non-empty list".
   * @param {() => boolean} predicate
   * @param {number} [timeoutMs]
   * @returns {Promise<boolean>} Whether predicate became true before timing out.
   */
  function waitUntil(predicate, timeoutMs = 2000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (predicate()) {
          resolve(true);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          resolve(false);
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  window.WIA.dom = { isVisible, walkAllElements, findFormFields, findLabelText, findAddButton, waitUntil };
})();
