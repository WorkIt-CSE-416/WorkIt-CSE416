// Turns (a label string, the AutofillProfile) into "which value, if any,
// goes in this field" — the generic, no-ATS-specific-adapter classifier
// the build plan doc calls for as the v1 starting point, with per-platform
// adapters layered on top later rather than hand-built blind right now.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  /**
   * True when the field itself says it's required — never assumed. This is
   * the direct fix for JobRight's Minor(s)-flagged-red bug: an unfilled
   * field only counts as a failure if this returns true for it.
   * @param {Element} field
   */
  function isRequired(field) {
    if (field.hasAttribute("required")) return true;
    if (field.getAttribute("aria-required") === "true") return true;
    // A visible asterisk right after the label text is the other common
    // signal, for forms that mark required fields visually without a
    // matching ARIA/HTML attribute.
    const label = field.labels?.[0]?.textContent ?? "";
    return /\*\s*$/.test(label.trim());
  }

  /**
   * The nine questions hiring systems repeat on every application (KAN-283,
   * `backend/app/schemas/autofill_answers.py`), answered directly from the
   * student's own saved answers (`GET /applicants/{id}/autofill-answers`,
   * merged onto `profile.answers` by background/api.js) rather than
   * inferred from anything else. Each map's keys are the API's option
   * values; each map's values are the exact label text
   * `frontend/src/lib/autofill-answers.ts` shows the student —
   * copied here on purpose, not reworded, since that screen's own labels
   * are already written to match what real hiring-system forms say
   * ("in the form's own words and case", that file's own comments). A
   * `null`/unanswered value resolves to `null` here too, same as every
   * other field: content-script.js reports it as a specific skip or
   * failure, never a guess.
   */
  const YES_NO_LABELS = { yes: "Yes", no: "No" };
  const WORK_STATUS_LABELS = {
    us_citizen: "U.S. Citizen",
    permanent_resident: "U.S. Permanent Resident (Green Card)",
    f1_student: "F-1 Student (CPT, OPT or STEM OPT)",
    h1b: "H-1B",
    other_visa: "Other Visa (TN, L-1, O-1, H-4 EAD…)",
    asylee_refugee: "Asylee or Refugee",
  };
  const CLEARANCE_LABELS = {
    none: "None",
    public_trust: "Public Trust",
    confidential: "Confidential",
    secret: "Secret",
    top_secret: "Top Secret",
    ts_sci: "Top Secret / SCI",
  };
  // A company's own "decline to answer" option is worded however it
  // likes — found live (2026-10-22, the Allen Institute's posting):
  // WorkIt's stored "I Don't Wish to Answer" (frontend/src/lib/
  // autofill-answers.ts's own wording) has no substring in common with
  // this posting's actual option, "Decline To Self Identify". Same shape
  // as `normalizeDegree`'s problem (the bank's wording vs. the ATS's own
  // fixed option text), but for an EEOC opt-out value instead of a
  // degree — so it gets the same fix `referral_source` already uses:
  // an ordered candidate list, tried in turn by `lib-fill.js`'s
  // `fillField`, first confirmed-live match wins. Appended to every
  // `declined` entry below rather than only here, since all five
  // self-identification questions share this exact risk.
  const DECLINE_SYNONYMS = ["Decline To Self Identify", "Prefer not to answer"];
  const GENDER_LABELS = {
    male: "Male",
    female: "Female",
    non_binary: "Non-Binary",
    declined: ["I Don't Wish to Answer", ...DECLINE_SYNONYMS],
  };
  const VETERAN_LABELS = {
    protected_veteran: "I identify as one or more of the classifications of protected veteran",
    not_protected_veteran: "I am not a protected veteran",
    declined: ["I don't wish to answer", ...DECLINE_SYNONYMS],
  };
  const DISABILITY_LABELS = {
    yes: "Yes, I have a disability (or previously had a disability)",
    no: "No, I do not have a disability and have not had one in the past",
    declined: ["I do not want to answer", ...DECLINE_SYNONYMS],
  };
  // The EEO self-identification's two race/ethnicity questions, kept apart
  // the way Greenhouse, Lever and Workday actually ask them (KAN-299):
  // Hispanic or Latino is its own yes/no/decline question, never a race
  // category; race takes one of the EEO-1 categories. Labels copied
  // verbatim from frontend/src/lib/autofill-answers.ts's
  // HISPANIC_LATINO_OPTIONS/RACE_OPTIONS, same convention as every other
  // map here.
  const HISPANIC_LATINO_LABELS = {
    yes: "Yes",
    no: "No",
    declined: ["I Don't Wish to Answer", ...DECLINE_SYNONYMS],
  };
  const RACE_LABELS = {
    american_indian_alaska_native: "American Indian or Alaska Native",
    asian: "Asian",
    black_african_american: "Black or African American",
    native_hawaiian_pacific_islander: "Native Hawaiian or Other Pacific Islander",
    white: "White",
    two_or_more: "Two or More Races",
    declined: ["I Don't Wish to Answer", ...DECLINE_SYNONYMS],
  };

  /**
   * @param {Record<string, string> | undefined} answers profile.answers
   * @param {string} key
   * @param {Record<string, string | string[]>} labels A `declined`-style
   *   entry may be an ordered candidate list instead of one string — see
   *   `DECLINE_SYNONYMS`.
   */
  function answerLabel(answers, key, labels) {
    const value = answers?.[key];
    return value != null ? (labels[value] ?? null) : null;
  }

  // Each entry: a stable key, the synonyms a label is matched against
  // (checked as "label includes synonym", case-insensitive, in order —
  // first match wins, so put more specific synonyms before general ones),
  // and how to read the value out of the profile. Promote a synonym here
  // the day a real form's wording doesn't match, rather than guessing more
  // up front — this list is expected to grow.
  function simpleFieldRules(profile) {
    const [firstName, ...rest] = (profile.full_name || "").trim().split(/\s+/);
    const lastName = rest.at(-1) ?? "";

    return [
      { key: "email", synonyms: ["email"], value: profile.email },
      { key: "first_name", synonyms: ["first name", "given name"], value: firstName },
      { key: "last_name", synonyms: ["last name", "family name", "surname"], value: lastName },
      { key: "full_name", synonyms: ["full name", "your name", "applicant name"], value: profile.full_name },
      { key: "phone", synonyms: ["phone", "mobile", "telephone"], value: profile.phone_number },
      { key: "linkedin", synonyms: ["linkedin"], value: profile.linkedin_url },
      { key: "github", synonyms: ["github"], value: profile.github_url },
      {
        key: "portfolio",
        synonyms: ["portfolio", "website", "personal site"],
        value: profile.portfolio_url,
      },
      // Deliberately not "title" alone: that substring also matches "Job
      // Title"/"Position" inside a repeated experience block, and this
      // rule runs before repeatedFieldTemplates ever gets a look — a bare
      // "title" synonym here meant every per-entry job title field was
      // silently getting the profile's one headline value stamped into it
      // instead, on every entry, every time. Found by inspecting Greenhouse's
      // field conventions for KAN-164, but it's an ATS-agnostic bug, not a
      // Greenhouse-specific one.
      { key: "headline", synonyms: ["headline", "professional headline", "current role"], value: profile.headline },
      // Real profile data (KAN-312) in place of the Greenhouse-specific
      // posting override this used to need, since no part of WorkIt
      // tracked a student's own city until now. "city" alone is
      // intentionally broad — nothing else in this list claims that word,
      // and WorkIt collects no street address for it to collide with.
      // "where are you located" confirmed live on GoFundMe's posting
      // (2026-10-22): a plain free-text field asking the same real
      // question as "Location (City)" in different words, matching none
      // of the other three synonyms.
      { key: "location", synonyms: ["location (city)", "current location", "city", "where are you located"], value: profile.location },
      // Confirmed live on a real Greenhouse posting's "U.S. Standard Work
      // Authorization" section, both a Yes/No/"I don't wish to answer"
      // dropdown. Deliberately "authorized to work"/"eligible to work",
      // never the bare "work authorization": that phrase also appears
      // inside "work authorization status" below, and checking this rule
      // first would have claimed that field's dropdown as a Yes/No one.
      {
        key: "work_authorized_us",
        synonyms: ["authorized to work", "eligible to work"],
        value: answerLabel(profile.answers, "work_authorized_us", YES_NO_LABELS),
      },
      {
        // Confirmed live on Olsson's posting (2026-10-22): "Would
        // employment at Olsson now or any time in the future require you
        // to obtain sponsorship for an immigration case (... sometimes
        // called "sponsorship" for an employment-based **visa status**)?"
        // matches none of the four specific phrases below ("require you
        // to obtain sponsorship" isn't "require sponsorship"; the
        // parenthetical's own "visa status" isn't "visa sponsorship") —
        // and since this rule is checked before `work_authorization_status`
        // below, the label fell through to THAT rule's "visa status"
        // synonym instead and answered "U.S. Citizen" to a sponsorship
        // question. Plain "sponsorship" added as a catch-all: distinctive
        // enough a word that it isn't at real risk of matching an
        // unrelated question the way a common word like "city" was
        // (matchesSynonym's own fix, above in this file's history) —
        // every real sponsorship question seen so far contains it, worded
        // however the rest of the sentence goes.
        key: "needs_sponsorship",
        synonyms: ["require sponsorship", "need sponsorship", "visa sponsorship", "sponsorship for employment", "sponsorship"],
        value: answerLabel(profile.answers, "needs_sponsorship", YES_NO_LABELS),
      },
      // The remaining seven are built the same principled way but, unlike
      // the two above, not yet confirmed against a live posting that asks
      // them — promote a synonym here the day a real form's wording
      // doesn't match, same as every other rule in this list.
      {
        key: "work_authorization_status",
        synonyms: ["citizenship", "visa status", "work authorization status"],
        value: answerLabel(profile.answers, "work_authorization_status", WORK_STATUS_LABELS),
      },
      {
        key: "security_clearance",
        synonyms: ["security clearance", "government clearance"],
        value: answerLabel(profile.answers, "security_clearance", CLEARANCE_LABELS),
      },
      {
        key: "gender",
        synonyms: ["gender"],
        value: answerLabel(profile.answers, "gender", GENDER_LABELS),
      },
      {
        key: "veteran_status",
        synonyms: ["protected veteran", "veteran status"],
        value: answerLabel(profile.answers, "veteran_status", VETERAN_LABELS),
      },
      {
        // "cc-305" confirmed live on The Trade Desk's Greenhouse posting:
        // its disability question's own label never says "disability" at
        // all ("Please review Form CC-305 at the link above before
        // checking one of the boxes below.") — CC-305 is the OFCCP's own
        // form number for this exact question, so a label that cites the
        // form instead of the word is common enough to cover directly.
        key: "disability_status",
        synonyms: ["disability", "cc-305"],
        value: answerLabel(profile.answers, "disability_status", DISABILITY_LABELS),
      },
      {
        // Checked before "hispanic_latino" below: a combined single field
        // some ATS might word as "Race/Ethnicity" (WorkIt's own screens
        // call it that) matches "race" here first and gets filled with a
        // race category — closer to right for a combined field than a
        // bare yes/no would be. Confirmed live as its own separate
        // dropdown too (The Trade Desk's "Indicate your Race:").
        key: "race",
        synonyms: ["race"],
        value: answerLabel(profile.answers, "race", RACE_LABELS),
      },
      {
        // "ethnic" covers "Indicate Ethnic group" — The Trade Desk's own
        // wording for this exact question, confirmed live: a separate
        // dropdown from "Indicate your Race:" above, which is the EEO's
        // own split (KAN-299) — Hispanic or Latino is never a race
        // category, it is its own yes/no/decline question. "ethnicity" is
        // listed explicitly, not left to "ethnic" matching inside it as a
        // substring: matchesSynonym (below) requires a word boundary on
        // both sides now, which a plain "ethnic" no longer crosses into
        // "ethnicity" by accident — the same boundary check that stops
        // "city" wrongly matching inside "capacity" elsewhere.
        key: "hispanic_latino",
        synonyms: ["hispanic", "latino", "ethnic", "ethnicity"],
        value: answerLabel(profile.answers, "hispanic_latino", HISPANIC_LATINO_LABELS),
      },
      {
        // "Where did you find this job?" / "How did you hear about us?" —
        // confirmed live on Braze's Greenhouse posting ("How did you
        // initially hear about this job?"), a required field with no
        // WorkIt profile data to answer it from honestly, unlike every
        // other rule here. The honest answer is WorkIt itself, so this
        // names it directly rather than reporting a failure for a field
        // nothing in the profile could ever fill. Two candidates, tried in
        // order (lib-fill.js's fillField): "WorkIt" first, for a free-text
        // field that can hold any string; "Job Board" second, the generic
        // option nearly every such dropdown's own list already offers,
        // for a select or combobox where "WorkIt" itself is never a real
        // option.
        key: "referral_source",
        synonyms: ["hear about", "hear of", "find this job", "find this posting", "find out about"],
        value: ["WorkIt", "Job Board"],
      },
      {
        // Relocation willingness — no WorkIt profile field tracks this yet
        // (there's no location/preference data behind it at all). Hardcoded
        // "Yes" for now, the same honest-stand-in approach as
        // referral_source above; revisit once WorkIt has real preference
        // data to answer from instead of a fixed guess.
        key: "willing_to_relocate",
        synonyms: ["willing to relocate", "able to relocate", "open to relocating"],
        value: "Yes",
      },
    ];
  }

  // One template per repeated sub-field, holding every entry's value
  // (not just the first) — which education[i]/experience[i] a given
  // template resolves to is decided in matchLabel below, by counting how
  // many times that exact template has already matched on this page.
  // content-script.js is responsible for getting enough DOM blocks on the
  // page in the first place (clicking a form's own "Add another" control)
  // before these can be of any use — see its ensureRepeatedBlocks.
  function repeatedFieldTemplates(profile) {
    const entries = profile.bank?.entries ?? [];
    // Section order (GLOSSARY.md), oldest convention first — no resume read
    // here at all: the bank is the one source of truth for what the
    // student has done (KAN-212), same rule the recommender and Scout
    // follow. "institution" below means the school, "company" the
    // employer — bank's own naming is title/organization per section
    // (frontend/src/app/(seeker)/bank/sections.ts's SECTIONS), not these.
    const education = entries.filter((e) => e.section === "education");
    const experience = entries.filter((e) => e.section === "experience");

    return [
      {
        group: "education",
        field: "institution",
        synonyms: ["school", "institution", "university"],
        values: education.map((e) => e.title),
      },
      { group: "education", field: "degree", synonyms: ["degree"], values: education.map((e) => e.degree) },
      {
        group: "education",
        field: "field_of_study",
        synonyms: ["field of study", "major"],
        values: education.map((e) => e.field_of_study),
      },
      {
        group: "education",
        field: "gpa",
        synonyms: ["gpa"],
        values: education.map((e) => (e.gpa != null ? String(e.gpa) : null)),
      },
      {
        group: "experience",
        field: "company",
        synonyms: ["company", "employer"],
        values: experience.map((e) => e.organization),
      },
      { group: "experience", field: "title", synonyms: ["job title", "position"], values: experience.map((e) => e.title) },
    ];
  }

  /**
   * Whether `synonym` appears in `normalized` as a whole word/phrase, not
   * embedded inside a longer unrelated word on either side. Found live on
   * Coinbase's Greenhouse posting (2026-10-22): a plain `.includes()` let
   * "city" match inside "...in any **capa-city**?" (a "have you worked
   * here before" question) and "institution" match inside "...an
   * **institution-al** client..." (a referral-conflict question) — each
   * sent "Seattle, WA" / "Stony Brook University" at a field that was
   * never about location or school at all. Neither side needs to be a
   * strict word boundary in the regex sense (a label can start or end
   * mid-punctuation), only "not a letter" — `(?<![a-z])`/`(?![a-z])`
   * catches both false matches above (each has a letter directly against
   * the synonym on the side that made it wrong) while still matching a
   * synonym followed by punctuation, digits, or the label's own end.
   * @param {string} normalized Already lower-cased label text.
   * @param {string} synonym Already lower-cased.
   * @returns {boolean}
   */
  function matchesSynonym(normalized, synonym) {
    const escaped = synonym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![a-z])${escaped}(?![a-z])`).test(normalized);
  }

  /**
   * Returns a match whenever the label is about something WorkIt tracks,
   * even when `value` comes back null/empty — content-script.js is the
   * one that decides what an empty value means (skipped if optional,
   * failed if required), not this classifier.
   * @param {string} labelText
   * @param {import("../shared/types.js").AutofillProfile} profile
   * @param {Map<string, number>} occurrences Mutable, owned by the caller
   *   (content-script.js), not this function — tracks how many times each
   *   repeated template ("education.institution", "experience.company", ...)
   *   has already matched a field on this page so far. The *n*th field
   *   matching a template gets bank entry *n*: the first "School" field
   *   found in DOM order is education[0], the second is education[1], and
   *   so on. Left untouched (and unused) for non-repeated fields.
   * @returns {{ key: string, value: string | string[] | null } | null}
   */
  function matchLabel(labelText, profile, occurrences) {
    if (!labelText) return null;
    const normalized = labelText.toLowerCase();

    for (const rule of simpleFieldRules(profile)) {
      if (rule.synonyms.some((synonym) => matchesSynonym(normalized, synonym))) {
        return { key: rule.key, value: rule.value };
      }
    }

    // A repeated sub-field's own label is always short in practice — real
    // examples seen live are "Company name", "School", "Degree", "Title",
    // never a sentence. Long compliance paragraphs are not: found live on
    // Coinbase's posting (2026-10-22), a government-conflict-of-interest
    // question mentioning "a government owned/controlled **company**" (a
    // true whole-word match, not the matchesSynonym boundary bug above)
    // tried filling "Acme Corp" into what was really a Yes/No question.
    // 40 is comfortably above every genuine label seen and comfortably
    // below every false one (shortest false positive so far: 66 chars) —
    // same "a real label isn't a paragraph" reasoning lib-dom.js's own
    // heading-length guard already uses (`visibleText(el).length < 60`
    // in `nearestToSectionHeading`), just a tighter number for a shorter
    // kind of label. Scoped to repeated templates only: `simpleFieldRules`
    // keeps matching full sentences on purpose — a real sponsorship/
    // citizenship question ("Will you now, or in the future, require visa
    // sponsorship for employment at Ai2?") is legitimately that long.
    if (normalized.length > 40) return null;

    for (const template of repeatedFieldTemplates(profile)) {
      if (!template.synonyms.some((synonym) => matchesSynonym(normalized, synonym))) continue;

      const templateKey = `${template.group}.${template.field}`;
      const occurrence = occurrences.get(templateKey) ?? 0;
      occurrences.set(templateKey, occurrence + 1);

      // More blocks on the page than bank entries to fill them with —
      // not this classifier's field, leave it alone rather than repeat
      // the last entry into it.
      if (occurrence >= template.values.length) return null;

      return { key: `${template.group}[${occurrence}].${template.field}`, value: template.values[occurrence] };
    }

    return null;
  }

  window.WIA.fieldMap = { matchLabel, isRequired };
})();
