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
   * Two of the most common EEO/compliance custom questions a posting asks
   * (confirmed live on a real Greenhouse posting's "U.S. Standard Work
   * Authorization" section: "Are you legally authorized to work in the
   * United States?" and "Do you currently, or will you in the future,
   * require sponsorship for employment authorization?", both rendered as a
   * Yes/No/"I don't wish to answer" dropdown) — derived from the
   * onboarding "Visa Sponsorship" pick (`profile.visa`), the only
   * visa-adjacent fact WorkIt stores on an applicant. That pick answers
   * "which postings do I want to see", not "what is my status", so only
   * its two unambiguous values answer either question: "I Don't Need One"
   * (`null`) confidently means authorized and no sponsorship needed;
   * "Sponsors Visas" (`"sponsors"`) confidently means sponsorship will be
   * needed. "Hide Jobs That Rule Me Out" (`"not_ruled_out"`) is
   * deliberately too broad for either question — an applicant who picked
   * it might still hold work authorization (on OPT, say) or might not —
   * and resolves to `null` here, same as no saved preference at all: a
   * wrong Yes/No on a legal eligibility question is worse than leaving it
   * for the student to answer themselves.
   * @param {"sponsors" | "not_ruled_out" | null | undefined} visa
   */
  function sponsorshipRequiredAnswer(visa) {
    if (visa === "sponsors") return "Yes";
    if (visa === null || visa === undefined) return "No";
    return null;
  }

  /**
   * @param {"sponsors" | "not_ruled_out" | null | undefined} visa
   */
  function workAuthorizedAnswer(visa) {
    // Only "I Don't Need One" is unambiguous here — "Sponsors Visas" says
    // the student wants sponsorship, not whether they currently hold work
    // authorization while waiting on it, so it answers sponsorshipRequired
    // but not this one.
    return visa === null || visa === undefined ? "Yes" : null;
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
      // More specific than "authorized"/"sponsorship" alone could ever
      // need to be — both phrases are rare enough outside these exact
      // questions that a plain substring match is safe.
      {
        key: "work_authorized",
        synonyms: ["authorized to work", "eligible to work", "work authorization"],
        value: workAuthorizedAnswer(profile.visa),
      },
      {
        key: "visa_sponsorship_required",
        synonyms: ["require sponsorship", "need sponsorship", "visa sponsorship", "sponsorship for employment"],
        value: sponsorshipRequiredAnswer(profile.visa),
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
   * @returns {{ key: string, value: string | null } | null}
   */
  function matchLabel(labelText, profile, occurrences) {
    if (!labelText) return null;
    const normalized = labelText.toLowerCase();

    for (const rule of simpleFieldRules(profile)) {
      if (rule.synonyms.some((synonym) => normalized.includes(synonym))) {
        return { key: rule.key, value: rule.value };
      }
    }

    for (const template of repeatedFieldTemplates(profile)) {
      if (!template.synonyms.some((synonym) => normalized.includes(synonym))) continue;

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
