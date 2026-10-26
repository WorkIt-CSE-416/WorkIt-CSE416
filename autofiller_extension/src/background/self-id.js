// The voluntary self-identification (EEO) questions, as WorkIt asks them on
// the first form that does (KAN-387): onboarding no longer asks them. Copied
// from frontend/src/lib/autofill-answers.ts (SELF_ID_KEYS and each one's
// options, in the same words): change both together. Each value is the
// API's option key (PATCH /applicants/{id}/autofill-answers checks it);
// "declined" is an answer the form is filled with, unlike leaving it blank.
// No chrome.* here: engine.js imports it, and the test imports engine.js.

/** @type {{ key: string, label: string, question: string, options: { value: string, label: string }[] }[]} */
export const SELF_ID = [
  {
    key: "gender",
    label: "Gender",
    question: "What is your gender?",
    options: [
      { value: "male", label: "Male" },
      { value: "female", label: "Female" },
      { value: "non_binary", label: "Non-Binary" },
      { value: "declined", label: "I Don't Wish to Answer" },
    ],
  },
  {
    key: "hispanic_latino",
    label: "Hispanic or Latino",
    question: "Are you Hispanic or Latino?",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
      { value: "declined", label: "I Don't Wish to Answer" },
    ],
  },
  {
    key: "race",
    label: "Race/Ethnicity",
    question: "What is your race or ethnicity?",
    options: [
      { value: "american_indian_alaska_native", label: "American Indian or Alaska Native" },
      { value: "asian", label: "Asian" },
      { value: "black_african_american", label: "Black or African American" },
      { value: "native_hawaiian_pacific_islander", label: "Native Hawaiian or Other Pacific Islander" },
      { value: "white", label: "White" },
      { value: "two_or_more", label: "Two or More Races" },
      { value: "declined", label: "I Don't Wish to Answer" },
    ],
  },
  {
    key: "veteran_status",
    label: "Veteran Status",
    question: "Are you a protected veteran?",
    // The form's own words and case, as frontend/CLAUDE.md's named exception keeps them.
    options: [
      { value: "protected_veteran", label: "I identify as one or more of the classifications of protected veteran" },
      { value: "not_protected_veteran", label: "I am not a protected veteran" },
      { value: "not_veteran", label: "I am not a veteran" },
      { value: "declined", label: "I don't wish to answer" },
    ],
  },
  {
    key: "disability_status",
    label: "Disability",
    question: "Do you have a disability, or have you had one in the past?",
    options: [
      { value: "yes", label: "Yes, I have a disability (or previously had a disability)" },
      { value: "no", label: "No, I do not have a disability and have not had one in the past" },
      { value: "declined", label: "I do not want to answer" },
    ],
  },
];

/** The self-identification answers the student hasn't given (null or missing in their autofill answers). */
export function unansweredSelfId(answers) {
  return SELF_ID.filter((q) => !answers?.[q.key]).map((q) => q.key);
}

/** Only known keys with one of their own options: what a save may send. Throws on anything else. */
export function checkedSelfId(answers) {
  const checked = {};
  for (const [key, value] of Object.entries(answers ?? {})) {
    const question = SELF_ID.find((q) => q.key === key);
    if (!question || !question.options.some((o) => o.value === value)) throw new Error(`Not a self-identification answer: ${key}`);
    checked[key] = value;
  }
  return checked;
}
