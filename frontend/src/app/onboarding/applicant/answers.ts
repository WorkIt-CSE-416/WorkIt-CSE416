/**
 * The questions hiring systems repeat on every application (KAN-283), as
 * onboarding's Profile step asks them, and the shape the API keeps them in
 * (GET and PATCH /applicants/{id}/autofill-answers, the backend's
 * schemas/autofill_answers.py, field for field). Auto apply fills them in;
 * My Profile will show them (KAN-273).
 *
 * Each value is the API's option key, never the label: the label is the words
 * real forms use, so a student recognises the answer they will be filling in,
 * and can change here without touching what is stored. Gender, veteran and
 * disability are voluntary self-identification, so each has its own "decline" answer,
 * which is an answer to fill in, unlike null (not answered).
 */

export type YesNo = "yes" | "no";

export type AutofillAnswers = {
  work_authorized_us: YesNo | null;
  needs_sponsorship: YesNo | null;
  work_authorization_status:
    | "us_citizen"
    | "permanent_resident"
    | "f1_student"
    | "h1b"
    | "other_visa"
    | "asylee_refugee"
    | null;
  security_clearance:
    "none" | "public_trust" | "confidential" | "secret" | "top_secret" | "ts_sci" | null;
  gender: "male" | "female" | "non_binary" | "declined" | null;
  veteran_status: "protected_veteran" | "not_protected_veteran" | "declined" | null;
  disability_status: "yes" | "no" | "declined" | null;
};

export const NO_ANSWERS: AutofillAnswers = {
  work_authorized_us: null,
  needs_sponsorship: null,
  work_authorization_status: null,
  security_clearance: null,
  gender: null,
  veteran_status: null,
  disability_status: null,
};

type Options<K extends keyof AutofillAnswers> = {
  value: NonNullable<AutofillAnswers[K]>;
  label: string;
}[];

export const YES_NO: Options<"work_authorized_us"> = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export const STATUS_OPTIONS: Options<"work_authorization_status"> = [
  { value: "us_citizen", label: "U.S. Citizen" },
  { value: "permanent_resident", label: "U.S. Permanent Resident (Green Card)" },
  { value: "f1_student", label: "F-1 Student (CPT, OPT or STEM OPT)" },
  { value: "h1b", label: "H-1B" },
  { value: "other_visa", label: "Other Visa (TN, L-1, O-1, H-4 EAD…)" },
  { value: "asylee_refugee", label: "Asylee or Refugee" },
];

export const CLEARANCE_OPTIONS: Options<"security_clearance"> = [
  { value: "none", label: "None" },
  { value: "public_trust", label: "Public Trust" },
  { value: "confidential", label: "Confidential" },
  { value: "secret", label: "Secret" },
  { value: "top_secret", label: "Top Secret" },
  { value: "ts_sci", label: "Top Secret / SCI" },
];

/** The EEO self-identification's three, which every U.S. form offers, and
 *  Non-Binary, which many now add. Where a form lacks it, auto apply fills
 *  nothing in rather than pick another answer. */
export const GENDER_OPTIONS: Options<"gender"> = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "non_binary", label: "Non-Binary" },
  { value: "declined", label: "I Don't Wish to Answer" },
];

/** The three answers of the U.S. protected veteran self-identification, in
 *  the form's own words and case: a named exception to Title Case
 *  (frontend/CLAUDE.md), so a student recognises them on the employer's form. */
export const VETERAN_OPTIONS: Options<"veteran_status"> = [
  {
    value: "protected_veteran",
    label: "I identify as one or more of the classifications of protected veteran",
  },
  { value: "not_protected_veteran", label: "I am not a protected veteran" },
  { value: "declined", label: "I don't wish to answer" },
];

/** The three answers of the OFCCP's Form CC-305, in the form's own words and
 *  case, the same exception as the veteran answers above. */
export const DISABILITY_OPTIONS: Options<"disability_status"> = [
  { value: "yes", label: "Yes, I have a disability (or previously had a disability)" },
  { value: "no", label: "No, I do not have a disability and have not had one in the past" },
  { value: "declined", label: "I do not want to answer" },
];

/** One of the Profile step's questions: its key in the bank, the heading
 *  the step shows, and the question as forms ask it. */
export type ProfileQuestion = {
  key: keyof AutofillAnswers;
  label: string;
  /** The question as forms word it, shown under the heading. Only here: the
   *  bank stores the answer alone (backend models/CLAUDE.md, "No question
   *  text is stored"), and the key says which question it answers. */
  question: string;
  options: { value: string; label: string }[];
  /** How many answers sit in a row from sm up; long ones take a row each. */
  columns: 1 | 2 | 3;
};

/** The Profile step, in the order real forms ask: eligibility first, the
 *  voluntary self-identification last. A new question is one entry here
 *  and one key in the API's schema. */
export const PROFILE_QUESTIONS: ProfileQuestion[] = [
  {
    key: "work_authorized_us",
    label: "Authorization to Work",
    question: "Are you legally authorized to work in the United States?",
    options: YES_NO,
    columns: 2,
  },
  {
    key: "needs_sponsorship",
    label: "Visa Sponsorship",
    question:
      "Will you now or in the future require sponsorship for employment visa status (e.g., H-1B visa status)?",
    options: YES_NO,
    columns: 2,
  },
  {
    key: "work_authorization_status",
    label: "Citizenship and Visa Status",
    question: "What is your current U.S. citizenship or visa status?",
    options: STATUS_OPTIONS,
    columns: 2,
  },
  {
    key: "security_clearance",
    label: "Security Clearance",
    question: "Do you hold an active U.S. government security clearance? If so, at what level?",
    options: CLEARANCE_OPTIONS,
    columns: 3,
  },
  {
    key: "gender",
    label: "Gender",
    question: "Voluntary self-identification: what is your gender?",
    options: GENDER_OPTIONS,
    columns: 2,
  },
  {
    key: "veteran_status",
    label: "Veteran Status",
    question: "Voluntary self-identification: are you a protected veteran?",
    options: VETERAN_OPTIONS,
    columns: 1,
  },
  {
    key: "disability_status",
    label: "Disability",
    question:
      "Voluntary self-identification of disability (Form CC-305): do you have a disability, or have you had one in the past?",
    options: DISABILITY_OPTIONS,
    columns: 1,
  },
];
