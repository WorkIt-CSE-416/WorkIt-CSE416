// The orchestrator. Injected on demand (popup.js calls
// chrome.scripting.executeScript when the user clicks "Autofill this
// page" — never automatically on page load, same reasoning as the rest of
// this prototype: the user triggers it, nothing runs or submits on its
// own). Loaded last, after its sibling lib-*.js / field-map.js / overlay.js
// files, which is what populates window.WIA before this file runs — see
// popup.js's `files` array for the load order that makes that true.
(async function () {
  "use strict";

  const { dom, fill, fieldMap, status, overlay } = window.WIA;

  // Which "Add another X" control unlocks a group's 2nd+ DOM block, and
  // which synonyms identify ONE field that's always present exactly once
  // per block (institution for education, company for experience) — used
  // to count how many blocks currently exist on the page. buttonPattern
  // matches a button whose own wording names the section ("Add Another
  // Education"); sectionPattern instead matches a *heading's* wording, for
  // forms (some Workday ones) where the add button itself just says "Add"
  // with no section name on it at all — dom.findAddButton falls back to
  // sectionPattern only when buttonPattern finds nothing.
  const REPEATED_GROUPS = [
    {
      group: "education",
      primarySynonyms: ["school", "institution", "university"],
      buttonPattern: /add\s+(another\s+)?(education|school)/i,
      sectionPattern: /education/i,
    },
    {
      group: "experience",
      primarySynonyms: ["company", "employer"],
      buttonPattern: /add\s+(another\s+)?(experience|work\s+experience|job|position)/i,
      sectionPattern: /experience|employment/i,
    },
  ];

  /**
   * Clicks `group`'s "Add another" control until the page shows at least
   * `neededCount` blocks for it, or gives up and reports why. A form that
   * already shows enough blocks (the common case — one resume entry, one
   * default block) never calls dom.findAddButton at all.
   * @param {(typeof REPEATED_GROUPS)[number]} config
   * @param {number} neededCount
   */
  async function ensureRepeatedBlocks({ group, primarySynonyms, buttonPattern, sectionPattern }, neededCount) {
    if (neededCount === 0) return;

    const countBlocks = () =>
      dom.findFormFields(document).filter((field) => {
        const label = (dom.findLabelText(field) || "").toLowerCase();
        return primarySynonyms.some((synonym) => label.includes(synonym));
      }).length;

    let current = countBlocks();
    let clicks = 0;
    const maxClicks = neededCount + 2; // headroom for a form with an extra default block already — not unbounded retries on a stuck page

    while (current < neededCount && clicks < maxClicks) {
      const button = dom.findAddButton(buttonPattern, sectionPattern);
      if (!button) {
        status.register(`_add-${group}`, `Add another ${group} entry`, false);
        status.setStatus(
          `_add-${group}`,
          "failed",
          `Couldn't find an "Add ${group}" button — only the first ${current} entr${current === 1 ? "y" : "ies"} will be filled`,
        );
        return;
      }

      button.click();
      clicks++;
      const grew = await dom.waitUntil(() => countBlocks() > current, 2000);
      if (!grew) {
        status.register(`_add-${group}`, `Add another ${group} entry`, false);
        status.setStatus(`_add-${group}`, "failed", `Clicked "Add ${group}" but no new fields appeared`);
        return;
      }
      current = countBlocks();
    }
  }

  overlay.mount();
  status.reset();

  const response = await chrome.runtime.sendMessage({ type: "profile/get" });
  if (!response.ok) {
    status.register("_error", response.error || "Could not load your WorkIt profile", true);
    status.setStatus("_error", "failed", "Sign in from the extension popup first.");
    return;
  }

  const profile = response.profile;

  for (const config of REPEATED_GROUPS) {
    const neededCount = profile.resume?.[config.group]?.length ?? 0;
    await ensureRepeatedBlocks(config, neededCount);
  }

  // Re-queried fresh here, after any blocks ensureRepeatedBlocks added —
  // the snapshot taken before that would miss them entirely.
  const fields = dom.findFormFields(document);
  const occurrences = new Map();

  for (const field of fields) {
    const labelText = dom.findLabelText(field);
    const match = fieldMap.matchLabel(labelText, profile, occurrences);
    if (!match) continue; // not something WorkIt has an opinion about — leave it alone, don't clutter the overlay

    const required = fieldMap.isRequired(field);
    const key = `${match.key}#${fields.indexOf(field)}`; // unique per field even if the same key matches twice on one page
    status.register(key, labelText || match.key, required);

    if (!match.value) {
      status.setStatus(key, required ? "failed" : "skipped", required ? "No WorkIt profile data for this field" : undefined);
      continue;
    }

    try {
      const result = await fill.fillField(field, match.value);
      status.setStatus(key, result.ok ? "filled" : "failed", result.ok ? undefined : result.reason);
    } catch (error) {
      status.setStatus(key, "failed", error instanceof Error ? error.message : "Fill failed");
    }
  }
})();
