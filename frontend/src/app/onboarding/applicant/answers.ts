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
