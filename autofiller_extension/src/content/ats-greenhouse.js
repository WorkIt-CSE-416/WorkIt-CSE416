// Greenhouse-specific adapter. The generic engine (field-map.js/lib-dom.js)
// finds a field's label by DOM proximity/heading-matching and then
// synonym-matches that text — necessary for an unknown ATS, but Greenhouse
// doesn't need any of that guessing: every job-boards.greenhouse.io posting
// names its own fields with the exact same stable ids (first_name, email,
// school--0, degree--0, ...), confirmed by inspecting several live postings
// (see the "Greenhouse Application Mechanics" research doc). This file
// fills those fields directly by id instead of by label-matching, which is
// both simpler and immune to the one real way the generic engine would get
// Greenhouse wrong: its education section's "Education" caption is a plain
// styled `<p>`, not a real heading element (h1-h6/legend/[role=heading]),
// which is exactly what defeats lib-dom.js's findAddButton section-heading
// fallback (see that function's own docs). Scoping to Greenhouse's own,
// directly-observed class names sidesteps that gap entirely rather than
// trying to stretch the generic heuristic to cover it.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  /**
   * True on any Greenhouse-hosted job application page. Both of
   * Greenhouse's URL families resolve to the same app today — confirmed
   * live: boards.greenhouse.io 302-redirects to job-boards.greenhouse.io —
   * so a hostname suffix check covers both without depending on anything
   * about the page's internal implementation (Greenhouse's own embedded
   * React/Remix state was considered for detection instead, but a hostname
   * check is simpler and won't break if Greenhouse changes how that state
   * is shaped).
   */
  function detect() {
    return /(^|\.)greenhouse\.io$/.test(location.hostname);
  }

  /**
   * Greenhouse's "School" field is a live autocomplete searching real
   * school names — there's no option for "Southwestern University
   * Georgetown, TX" even when "Southwestern University" alone is a real,
   * matchable one. An experience bank education entry's `title` is the
   * school's own name (frontend/src/app/(seeker)/bank/sections.ts's
   * SECTIONS), but can still carry a trailing location if the student typed
   * one in. Greenhouse's combobox is pickier: strip a trailing
   * ", City, ST" / "  City, ST" so just the school's own name gets typed,
   * which is what an autocomplete option actually matches. Safe to run on
   * any title string — if there's no such trailing location, this is a
   * no-op.
   * @param {string | null} title
   */
  function institutionSearchTerm(title) {
    if (!title) return title;
    const stripped = title.replace(/[,\s]{2,}[^,]+,\s*[A-Z]{2}\.?\s*$/, "").trim();
    return stripped || title;
  }

  /**
   * Greenhouse's "Degree" field is a fixed dropdown, the same ten options
   * on every posting (confirmed live): Associate's Degree, Bachelor's
   * Degree, Doctor of Medicine (M.D.), Doctor of Philosophy (Ph.D.),
   * Engineer's Degree, High School, Juris Doctor (J.D.), Master of
   * Business Administration (M.B.A.), Master's Degree, Other — never an
   * abbreviation. A bank entry's `degree` is free text a student typed
   * ("B.S.", "Bachelors", "Bachelor of Science"), which fillCombobox's
   * exact/substring match can't connect to "Bachelor's Degree" on its
   * own — confirmed live as "No options appeared for 'B.S.'". Match by
   * degree family (a regex per family covering its common abbreviation
   * and long-form spellings) rather than exact wording, so whichever way
   * the bank's text is written resolves to the same option. Ordered most
   * specific first: "M.B.A."/"M.D." would otherwise also satisfy the
   * looser Master's pattern ("M" + one of A/S).
   */
  const DEGREE_FAMILIES = [
    { option: "Doctor of Philosophy (Ph.D.)", pattern: /\bph\.?\s?d\.?\b|doctorate|doctoral/i },
    { option: "Doctor of Medicine (M.D.)", pattern: /\bm\.?\s?d\.?\b|doctor of medicine/i },
    { option: "Juris Doctor (J.D.)", pattern: /\bj\.?\s?d\.?\b|juris doctor/i },
    { option: "Master of Business Administration (M.B.A.)", pattern: /\bm\.?\s?b\.?\s?a\.?\b/i },
    { option: "Master's Degree", pattern: /\bm\.?\s?[as]\.?\b|master'?s?/i },
    { option: "Bachelor's Degree", pattern: /\bb\.?\s?[as]\.?\b|bachelor'?s?/i },
    { option: "Associate's Degree", pattern: /\ba\.?\s?[as]\.?\b|associate'?s?/i },
    { option: "High School", pattern: /high school|\bged\b/i },
  ];

  /**
   * @param {string | null} degree
   */
  function normalizeDegree(degree) {
    if (!degree) return degree;
    const family = DEGREE_FAMILIES.find(({ pattern }) => pattern.test(degree));
    // Unrecognized (e.g. "Engineer's Degree", "Other"): left as typed, so
    // the generic exact/substring match in lib-fill.js still gets a shot
    // at it rather than this function guessing wrong.
    return family ? family.option : degree;
  }

  /**
   * Greenhouse's "Country" field next to Phone is the phone number's own
   * calling-code picker (confirmed live: a combobox listing "United States
   * +1", "Afghanistan +93", one option per country — not a location/
   * residence field, which is the separate "Location (City)" field further
   * down the form), a stable Greenhouse id like `phone`/`email`. A bank/
   * profile `phone_number` is free text with no enforced format
   * (`backend/app/models/profiles.py`'s column is a plain `String(30)`), so
   * a student who types a leading "+<code>" (e.g. "+91 98765 43210") gets
   * it read here and mapped to the country name — the exact name
   * Greenhouse's own option list uses, confirmed live as "<Country>
   * +<code>", so typing just the name is enough for fillCombobox's
   * substring match to find it (verified live: typing "United States"
   * filters the list to exactly "United States +1").
   *
   * Not exhaustive — covers calling codes WorkIt's own student population
   * is likeliest to use, not all ~240. An unrecognized explicit code is
   * left unfilled (honest, no guess) rather than picked at random. No
   * leading "+" at all, or "+1", resolves to "United States": this
   * product is explicitly US-only while it's young
   * (`backend/app/models/CLAUDE.md`'s "Locations" section), so a plain,
   * uncoded number is the common domestic case, not an unknown one — and
   * +1 itself is shared by the US, Canada and ~19 Caribbean nations, so
   * "United States" is the same kind of reasonable product-scoped default,
   * not a wild guess.
   */
  const CALLING_CODE_COUNTRIES = {
    1: "United States",
    7: "Russia",
    20: "Egypt",
    27: "South Africa",
    33: "France",
    34: "Spain",
    39: "Italy",
    44: "United Kingdom",
    49: "Germany",
    52: "Mexico",
    55: "Brazil",
    57: "Colombia",
    60: "Malaysia",
    61: "Australia",
    62: "Indonesia",
    63: "Philippines",
    65: "Singapore",
    66: "Thailand",
    81: "Japan",
    82: "South Korea",
    84: "Vietnam",
    86: "China",
    91: "India",
    92: "Pakistan",
    94: "Sri Lanka",
    234: "Nigeria",
    880: "Bangladesh",
    966: "Saudi Arabia",
    971: "United Arab Emirates",
  };

  /**
   * Splits a free-text phone number into the Country dropdown's value and
   * what the separate Phone text field should hold — the local number
   * alone, since the dropdown already carries the calling code and Phone
   * showing it twice ("+1" in the dropdown, "+1 555…" typed again next to
   * it) would read as a mistake on the filled form. `local` falls back to
   * the untouched original whenever the leading code isn't both present
   * and recognized, so a phone number this function can't confidently
   * parse is still filled in full rather than silently mangled.
   * @param {string | null} phoneNumber
   * @returns {{ country: string | null, local: string | null }}
   */
  function splitPhoneCountry(phoneNumber) {
    if (!phoneNumber) return { country: null, local: null };
    const trimmed = phoneNumber.trim();
    const match = /^\+(\d+)/.exec(trimmed);
    if (!match) return { country: "United States", local: trimmed }; // see this section's own doc comment

    // Longest prefix first: calling codes are prefix-free by design (no
    // valid code is a prefix of another), so trying 3, then 2, then 1
    // digit and taking the first hit can never misfire on a shorter code
    // that happens to also be in the table. `\d+` (not `\d{1,3}`) captures
    // the whole leading digit run, which matters when the student typed no
    // separator between the code and the local number at all ("+919876543210"):
    // slicing at the right length still finds "91" inside it.
    const digits = match[1];
    for (let len = Math.min(digits.length, 3); len >= 1; len--) {
      const country = CALLING_CODE_COUNTRIES[digits.slice(0, len)];
      if (country) {
        const rest = trimmed.slice(1 + len).replace(/^[\s.-]+/, "");
        return { country, local: rest || trimmed };
      }
    }
    return { country: null, local: trimmed }; // an explicit code we don't recognize — leave Country for the student, but still fill Phone in full
  }

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  /**
   * Greenhouse's start/end date is two separate fields per side — a month
   * combobox (react-select, full month names: "January", not "Jan" or
   * "01") and a plain year text input — never one combined date picker. A
   * bank entry's `start_month`/`end_month` is one "YYYY-MM" string
   * (`frontend/src/lib/bank-actions.ts`'s `EntryFields`), so each bank
   * field maps to two DOM fields below, split by these two transforms
   * rather than by a second bank field.
   * @param {string | null} yyyyMm
   */
  function monthName(yyyyMm) {
    if (!yyyyMm) return yyyyMm;
    return MONTH_NAMES[Number(yyyyMm.slice(5, 7)) - 1] ?? null;
  }

  /**
   * @param {string | null} yyyyMm
   */
  function yearOf(yyyyMm) {
    return yyyyMm ? yyyyMm.slice(0, 4) : yyyyMm;
  }

  // Greenhouse's own DOM ids for one education block, observed directly on
  // a real posting. `base` is the literal id prefix Greenhouse renders —
  // note it's "school", not "school_name": Greenhouse's internal config key
  // for this field (visible in its embedded schema) is "school_name", but
  // the DOM id it actually renders is "school--N". Keep these as the DOM's
  // own spelling, not the config key's — they're confirmed different.
  // `bankField` reads straight off a BankEntry (school = title, not
  // organization — see frontend/src/app/(seeker)/bank/sections.ts's
  // SECTIONS for the education row). start-month/start-year and
  // end-month/end-year deliberately repeat a `bankField` (`start_month`,
  // `end_month`) across two entries — see `run()`'s status key, which is
  // keyed on `base`, not `bankField`, for exactly this reason: two DOM
  // fields reading the same bank value still need two distinct status
  // rows. An entry with no `end_month` (`end_kind` "present") leaves both
  // end fields blank — Greenhouse has no separate "currently attending"
  // control to set instead.
  const EDUCATION_FIELDS = [
    { base: "school", bankField: "title", transform: institutionSearchTerm },
    { base: "degree", bankField: "degree", transform: normalizeDegree },
    { base: "discipline", bankField: "field_of_study" },
    { base: "start-month", bankField: "start_month", transform: monthName },
    { base: "start-year", bankField: "start_month", transform: yearOf },
    { base: "end-month", bankField: "end_month", transform: monthName },
    { base: "end-year", bankField: "end_month", transform: yearOf },
  ];

  /**
   * How many education blocks the page currently has. Scoped to the real
   * combobox input specifically (`input[role=combobox]`) — a selector that
   * only matched `[id^="school--"]` was also catching each block's
   * `id="school--N-label"` label element, silently double-counting every
   * block and making this think the page already had enough before it ever
   * clicked anything.
   */
  function blockCount() {
    return document.querySelectorAll('input[role="combobox"][id^="school--"]').length;
  }

  /**
   * Greenhouse's "Add another" control for education. Not matched by
   * wording — the button's own text is just "Add another", with no
   * "education" in it anywhere — and not matched by a nearby heading
   * either, since Greenhouse's section caption isn't a real heading
   * element (see this file's top comment). Scoped instead by Greenhouse's
   * own class name, disambiguated (when more than one repeatable section
   * exists on the page) by document-order proximity to the last known
   * education block.
   * @returns {HTMLElement | null}
   */
  function findEducationAddButton() {
    const buttons = Array.from(document.querySelectorAll("button.add-another-button"));
    if (buttons.length <= 1) return buttons[0] ?? null; // nothing to disambiguate

    const lastBlock = document.getElementById(`school--${blockCount() - 1}`);
    if (!lastBlock) return buttons[0];
    return buttons.find((b) => lastBlock.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ?? buttons[0];
  }

  /**
   * Clicks "Add another" until the page has `neededCount` education
   * blocks, or reports why it couldn't — same shape as content-script.js's
   * own ensureRepeatedBlocks, Greenhouse-specific only in how it counts
   * blocks and finds the button.
   * @param {number} neededCount
   * @param {{ status: typeof window.WIA.status, dom: typeof window.WIA.dom }} engine
   */
  async function ensureEducationBlocks(neededCount, { status, dom }) {
    if (neededCount === 0) return;

    let current = blockCount();
    if (current === 0) return; // this posting doesn't collect education at all — nothing to expand, nothing wrong

    const maxClicks = neededCount + 2; // headroom for a default block already present — not unbounded retries on a stuck page
    for (let clicks = 0; current < neededCount && clicks < maxClicks; clicks++) {
      const button = findEducationAddButton();
      if (!button) {
        status.register("_add-education", "Add another education entry", false);
        status.setStatus(
          "_add-education",
          "failed",
          `Couldn't find Greenhouse's "Add another" button for education — only the first ${current} entr${current === 1 ? "y" : "ies"} will be filled`,
        );
        return;
      }

      button.click();
      const grew = await dom.waitUntil(() => blockCount() > current, 2000);
      if (!grew) {
        status.register("_add-education", "Add another education entry", false);
        status.setStatus("_add-education", "failed", 'Clicked "Add another" but no new education block appeared');
        return;
      }
      current = blockCount();
    }
  }

  /**
   * Fills Greenhouse's identity fields and education block directly by
   * Greenhouse's own stable ids — never by label-synonym matching, since
   * Greenhouse already names every field exactly and the same way on every
   * posting. Returns the set of field ids this handled, so
   * content-script.js's generic pass can skip them rather than
   * re-classifying (and risking a different outcome for) the same field.
   * @param {import("../shared/types.js").AutofillProfile} profile
   * @param {{ status: typeof window.WIA.status, fill: typeof window.WIA.fill, dom: typeof window.WIA.dom, fieldMap: typeof window.WIA.fieldMap }} engine
   * @returns {Promise<Set<string>>}
   */
  async function run(profile, { status, fill, dom, fieldMap }) {
    const handled = new Set();

    const [firstName, ...rest] = (profile.full_name || "").trim().split(/\s+/);
    const lastName = rest.at(-1) ?? "";

    const phone = splitPhoneCountry(profile.phone_number);
    const identity = [
      { id: "first_name", label: "First Name", value: firstName || null },
      { id: "last_name", label: "Last Name", value: lastName || null },
      { id: "email", label: "Email", value: profile.email },
      { id: "country", label: "Country", value: phone.country },
      { id: "phone", label: "Phone", value: phone.local },
    ];

    for (const { id, label, value } of identity) {
      const field = document.getElementById(id);
      if (!field) continue;
      handled.add(id);

      const required = fieldMap.isRequired(field);
      status.register(id, label, required);

      if (!value) {
        status.setStatus(id, required ? "failed" : "skipped", required ? "No WorkIt profile data for this field" : undefined);
        continue;
      }
      const result = await fill.fillField(field, value);
      status.setStatus(id, result.ok ? "filled" : "failed", result.ok ? undefined : result.reason);
    }

    // Greenhouse's "Resume/CV" field is a stable `input#resume` — confirmed
    // live (The Trade Desk's posting): `type="file"`,
    // `accept=".pdf,.doc,.docx,.txt,.rtf"`, sitting behind styled
    // "Attach"/"Enter manually" buttons but the real, directly-targetable
    // file input underneath both. `profile.resume` is already resolved to
    // file bytes by background/api.js's resolveResumeFile (whichever
    // resume My Profile calls the student's default), so filling it here
    // is one fillFile call, no network request from the content script.
    const resumeField = document.getElementById("resume");
    if (resumeField) {
      handled.add("resume");
      const required = fieldMap.isRequired(resumeField);
      status.register("resume", "Resume/CV", required);

      if (!profile.resume) {
        status.setStatus("resume", required ? "failed" : "skipped", required ? "No resume saved to your WorkIt account" : undefined);
      } else {
        const result = fill.fillFile(resumeField, profile.resume);
        status.setStatus("resume", result.ok ? "filled" : "failed", result.ok ? undefined : result.reason);
      }
    }

    const education = (profile.bank?.entries ?? []).filter((e) => e.section === "education");
    await ensureEducationBlocks(education.length, { status, dom });

    for (let i = 0; i < education.length; i++) {
      if (!document.getElementById(`school--${i}`)) break; // no more blocks than this — ensureEducationBlocks already reported why, if it tried and failed

      for (const { base, bankField, transform } of EDUCATION_FIELDS) {
        const id = `${base}--${i}`;
        const field = document.getElementById(id);
        if (!field) continue;
        handled.add(id);

        const raw = education[i][bankField] ?? null;
        const value = raw && transform ? transform(raw) : raw;
        const required = fieldMap.isRequired(field);
        // Keyed on `base`, not `bankField`: start-month and start-year both
        // read `start_month` (same for end-month/end-year), and a shared
        // key here would make the second status.register silently
        // overwrite the first field's row.
        const key = `education[${i}].${base}`;
        status.register(key, dom.findLabelText(field) || id, required);

        if (!value) {
          status.setStatus(key, required ? "failed" : "skipped", required ? "No WorkIt profile data for this field" : undefined);
          continue;
        }
        const result = await fill.fillField(field, value);
        status.setStatus(key, result.ok ? "filled" : "failed", result.ok ? undefined : result.reason);
      }
    }

    return handled;
  }

  window.WIA.greenhouse = { detect, run };
})();
