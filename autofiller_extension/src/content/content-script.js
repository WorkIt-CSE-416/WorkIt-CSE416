// The orchestrator. Injected on demand (popup.js calls
// chrome.scripting.executeScript when the user clicks "Autofill this
// page" — never automatically on page load, same reasoning as the rest of
// this prototype: the user triggers it, nothing runs or submits on its
// own). Loaded last, after its sibling lib-*.js / field-map.js / overlay.js
// files, which is what populates window.WIA before this file runs — see
// popup.js's `files` array for the load order that makes that true.
(async function () {
  "use strict";

  const { dom, fill, fieldMap, status, overlay, greenhouse } = window.WIA;

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
   * already shows enough blocks (the common case — one bank entry, one
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

  /**
   * Company name and job title for the essay-answer prompt, read once from
   * the page's own title. Greenhouse's confirmed live format is exactly
   * "Job Application for {title} at {company}" (seen on a real posting
   * while building this) — untested against any other ATS, which just means
   * a more generic generated answer, never a failure: the model still has
   * the bank and the question's own text either way.
   * @returns {{ companyName: string | null, jobTitle: string | null }}
   */
  function pageContext() {
    const match = /^Job Application for (.+) at (.+)$/i.exec(document.title.trim());
    return match ? { jobTitle: match[1].trim(), companyName: match[2].trim() } : { jobTitle: null, companyName: null };
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

  // Greenhouse gets handled by its own adapter first: it names every field
  // with the same stable ids on every posting, so filling by id is both
  // simpler and more accurate than the generic label-matching path below —
  // and for education specifically, Greenhouse's section caption isn't a
  // real heading element, which would defeat the generic findAddButton's
  // section-heading fallback (see ats-greenhouse.js's top comment).
  const isGreenhouse = greenhouse?.detect() ?? false;
  const handledIds = isGreenhouse ? await greenhouse.run(profile, { status, fill, dom, fieldMap }) : new Set();

  // Skipped entirely on Greenhouse, not just for "education": none of the
  // Greenhouse postings looked at expose a structured, generically-
  // discoverable experience/employment section at all, and a page with
  // exactly one generic "Add another" button (Greenhouse's education one)
  // and nothing else to disambiguate against will have this click that one
  // button for "experience" too — it's the only candidate, so
  // findAddButton's "only one, unambiguous" shortcut returns it regardless
  // of which group asked. Confirmed live: this silently added a second,
  // wrongly-indexed education block. Greenhouse's own education block is
  // already fully handled above, by exact field id, so there's nothing
  // left here for Greenhouse to legitimately need.
  if (!isGreenhouse) {
    for (const config of REPEATED_GROUPS) {
      const neededCount = (profile.bank?.entries ?? []).filter((e) => e.section === config.group).length;
      await ensureRepeatedBlocks(config, neededCount);
    }
  }

  // Re-queried fresh here, after any blocks ensureRepeatedBlocks added —
  // the snapshot taken before that would miss them entirely.
  const fields = dom.findFormFields(document);
  const occurrences = new Map();
  // Open-ended questions ("Why do you want to work here?") WorkIt can
  // offer to draft but never fills on its own — collected here, acted on
  // once the student opts in via the overlay's one batch prompt below.
  const essayCandidates = [];

  for (const field of fields) {
    if (field.id && handledIds.has(field.id)) continue; // already filled precisely by the Greenhouse adapter above

    const labelText = dom.findLabelText(field);
    const match = fieldMap.matchLabel(labelText, profile, occurrences);
    if (!match) {
      // An essay question is a textarea no rule above claims — there's no
      // fixed vocabulary for "why this company" to ever match. Previously
      // this just fell through silently (the line this comment replaces);
      // now it's tracked (needs_generation) so the overlay at least says
      // it exists, same honesty rule as every other field here.
      if (field.tagName === "TEXTAREA" && labelText) {
        const key = `essay#${fields.indexOf(field)}`;
        status.register(key, labelText, fieldMap.isRequired(field));
        status.setStatus(key, "needs_generation");
        essayCandidates.push({ key, field, question: labelText, maxLength: field.maxLength > 0 ? field.maxLength : null });
      }
      continue; // not something WorkIt has an opinion about — leave it alone, don't clutter the overlay
    }

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

  if (essayCandidates.length === 0) return;

  const { companyName, jobTitle } = pageContext();

  overlay.promptForEssays({
    count: essayCandidates.length,
    onDismiss() {
      for (const { key } of essayCandidates) {
        status.setStatus(key, "skipped", "You chose to answer this yourself");
      }
    },
    async onGenerate() {
      // Sequential, not parallel: each call is its own counted AI use, and
      // this way the overlay shows real one-at-a-time progress instead of
      // every row flipping at once at the end.
      for (const candidate of essayCandidates) {
        const result = await chrome.runtime.sendMessage({
          type: "essay/generate",
          applicantId: profile.id,
          question: candidate.question,
          companyName,
          jobTitle,
          maxLength: candidate.maxLength,
        });
        if (!result.ok) {
          status.setStatus(candidate.key, "failed", result.error);
          continue;
        }
        try {
          const filled = await fill.fillField(candidate.field, result.answer);
          status.setStatus(candidate.key, filled.ok ? "filled" : "failed", filled.ok ? undefined : filled.reason);
        } catch (error) {
          status.setStatus(candidate.key, "failed", error instanceof Error ? error.message : "Fill failed");
        }
      }
    },
  });
})();
