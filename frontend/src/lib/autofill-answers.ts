/**
 * The questions hiring systems repeat on every application (KAN-283), and the
 * shape the API keeps them in (GET and PATCH /applicants/{id}/autofill-answers,
 * the backend's schemas/autofill_answers.py, field for field). Onboarding's
 * Profile step asks them first; My Profile's Application Questions shows and
 * edits them (KAN-269). Both read this one list, so a new question is one
 * entry here and one key in the API's schema. Onboarding leaves out the
 * voluntary self-identification (SELF_ID_KEYS, KAN-387): the extension asks
 * it the first time a form does. Server actions:
 * ./autofill-answers-actions.
 *
 * Each value is the API's option key, never the label: the label is the words
 * real forms use, so a student recognises the answer they will be filling in,
 * and can change here without touching what is stored. Gender, Hispanic or
 * Latino, race, veteran and disability are voluntary self-identification, so
 * each has its own "decline" answer, which is an answer to fill in, unlike
 * null (not answered).
 *
 * THE APPLICATION ANSWERS (KAN-369) are the rest of the bank: the facts
 * screening questions ask (availability, the start window, relocation, the
 * street address, languages and the screener facts). My Profile's section of
 * that name shows them all; onboarding's Availability step asks the first
 * three groups' core and the screener facts. A list answer of [] is the
 * student's "none", unlike null. A screener fact is always the student's own
 * answer: nothing here pre-selects one, and None of These Apply
 * (noneOfTheseApply) answers only when the student presses it.
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
  hispanic_latino: "yes" | "no" | "declined" | null;
  race:
    | "american_indian_alaska_native"
    | "asian"
    | "black_african_american"
    | "native_hawaiian_pacific_islander"
    | "white"
    | "two_or_more"
    | "declined"
    | null;
  veteran_status: "protected_veteran" | "not_protected_veteran" | "not_veteran" | "declined" | null;
  disability_status: "yes" | "no" | "declined" | null;

  // The Application answers (KAN-369).
  onsite_ok: YesNo | null;
  full_time_40h: YesNo | null;
  /** "YYYY-MM-DD". */
  earliest_start: string | null;
  latest_end: string | null;
  /** "summer 2027", the API's spelling (termLabel shows it). */
  available_terms: string[] | null;
  willing_to_relocate: YesNo | null;
  /** Places, best first ("New York, NY"). */
  location_preferences: string[] | null;
  /** Where they will live during the internship, city and state. */
  internship_location: string | null;
  /** The city and state are the profile's location. */
  address_line1: string | null;
  postal_code: string | null;
  /** The languages they speak and write fluently. */
  languages: string[] | null;
  relatives_at: string[] | null;
  relative_public_official: YesNo | null;
  referred_at: string[] | null;
  prior_government_work: YesNo | null;
  non_compete: YesNo | null;
  pending_offers: string[] | null;
  age_18_or_over: YesNo | null;
  /** Dollars an hour, the student's own figure. */
  expected_hourly_pay: number | null;
  /** Whether a posting's stated pay range is fine. */
  accept_posted_pay: YesNo | null;
  sexual_orientation:
    "heterosexual" | "gay" | "lesbian" | "bisexual" | "asexual" | "queer" | "declined" | null;
  transgender: "yes" | "no" | "declined" | null;
  pronouns: "he_him" | "she_her" | "they_them" | "declined" | null;
  /** [] is "none of these", ["declined"] a decline. */
  communities: Community[] | null;
  role_interests: RoleInterest[] | null;
  x_url: string | null;
  /** Every country they are a citizen of ("India"); two make a dual citizen. */
  citizenship_countries: string[] | null;
};

export type Community =
  | "disability"
  | "neurodiverse"
  | "veteran"
  | "parent"
  | "refugee_immigrant"
  | "first_generation"
  | "lgbtq"
  | "declined";

export type RoleInterest =
  | "backend"
  | "frontend"
  | "full_stack"
  | "mobile"
  | "embedded"
  | "ml"
  | "data"
  | "infrastructure"
  | "security"
  | "robotics";

/** The questions the Profile step and Application Questions ask. */
export type QuestionKey =
  | "work_authorized_us"
  | "needs_sponsorship"
  | "work_authorization_status"
  | "security_clearance"
  | "gender"
  | "hispanic_latino"
  | "race"
  | "veteran_status"
  | "disability_status"
  | "sexual_orientation"
  | "transgender"
  | "pronouns";

export const NO_ANSWERS: AutofillAnswers = {
  work_authorized_us: null,
  needs_sponsorship: null,
  work_authorization_status: null,
  security_clearance: null,
  gender: null,
  hispanic_latino: null,
  race: null,
  veteran_status: null,
  disability_status: null,
  onsite_ok: null,
  full_time_40h: null,
  earliest_start: null,
  latest_end: null,
  available_terms: null,
  willing_to_relocate: null,
  location_preferences: null,
  internship_location: null,
  address_line1: null,
  postal_code: null,
  languages: null,
  relatives_at: null,
  relative_public_official: null,
  referred_at: null,
  prior_government_work: null,
  non_compete: null,
  pending_offers: null,
  age_18_or_over: null,
  expected_hourly_pay: null,
  accept_posted_pay: null,
  sexual_orientation: null,
  transgender: null,
  pronouns: null,
  communities: null,
  role_interests: null,
  x_url: null,
  citizenship_countries: null,
};

type Options<K extends QuestionKey> = {
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

/** The EEO self-identification's Hispanic or Latino question (KAN-299),
 *  asked before Race/Ethnicity as Greenhouse, Lever and Workday ask it. */
export const HISPANIC_LATINO_OPTIONS: Options<"hispanic_latino"> = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "declined", label: "I Don't Wish to Answer" },
];

/** The EEO-1 race categories (KAN-299), one answer, Two or More Races for a
 *  student of several. Hispanic or Latino is the question above, never one
 *  of these: the EEO's own split, which every U.S. form keeps. */
export const RACE_OPTIONS: Options<"race"> = [
  { value: "american_indian_alaska_native", label: "American Indian or Alaska Native" },
  { value: "asian", label: "Asian" },
  { value: "black_african_american", label: "Black or African American" },
  { value: "native_hawaiian_pacific_islander", label: "Native Hawaiian or Other Pacific Islander" },
  { value: "white", label: "White" },
  { value: "two_or_more", label: "Two or More Races" },
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
  { value: "not_veteran", label: "I am not a veteran" },
  { value: "declined", label: "I don't wish to answer" },
];

export const ORIENTATION_OPTIONS: Options<"sexual_orientation"> = [
  { value: "heterosexual", label: "Heterosexual" },
  { value: "gay", label: "Gay" },
  { value: "lesbian", label: "Lesbian" },
  { value: "bisexual", label: "Bisexual" },
  { value: "asexual", label: "Asexual" },
  { value: "queer", label: "Queer" },
  { value: "declined", label: "I Don't Wish to Answer" },
];

export const TRANSGENDER_OPTIONS: Options<"transgender"> = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "declined", label: "I Don't Wish to Answer" },
];

export const PRONOUN_OPTIONS: Options<"pronouns"> = [
  { value: "he_him", label: "He/Him" },
  { value: "she_her", label: "She/Her" },
  { value: "they_them", label: "They/Them" },
  { value: "declined", label: "I Don't Wish to Answer" },
];

/** The communities forms ask about (select all that apply). */
export const COMMUNITY_OPTIONS: { value: Community; label: string }[] = [
  { value: "disability", label: "Person With a Disability" },
  { value: "neurodiverse", label: "Neurodiverse" },
  { value: "veteran", label: "Veteran" },
  { value: "parent", label: "Parent" },
  { value: "refugee_immigrant", label: "Refugee or Immigrant" },
  { value: "first_generation", label: "First Generation" },
  { value: "lgbtq", label: "LGBTQ+" },
];

/** The kinds of work a form's "area of interest" lists. */
export const ROLE_INTEREST_OPTIONS: { value: RoleInterest; label: string }[] = [
  { value: "backend", label: "Backend" },
  { value: "frontend", label: "Frontend" },
  { value: "full_stack", label: "Full Stack" },
  { value: "mobile", label: "Mobile" },
  { value: "embedded", label: "Embedded" },
  { value: "ml", label: "Machine Learning" },
  { value: "data", label: "Data" },
  { value: "infrastructure", label: "Infrastructure" },
  { value: "security", label: "Security" },
  { value: "robotics", label: "Robotics" },
];

/** A community chip pressed: a decline stands alone, so picking one clears
 *  the other; unpicking the last leaves it unanswered (null), never "none". */
export function toggleCommunity(list: Community[] | null, key: Community): Community[] | null {
  const picked = list ?? [];
  if (picked.includes(key)) {
    const next = picked.filter((k) => k !== key);
    return next.length ? next : null;
  }
  return key === "declined" ? ["declined"] : [...picked.filter((k) => k !== "declined"), key];
}

/** A typed hourly pay: null when cleared, undefined when it isn't a figure
 *  from $0 to $1,000 an hour (the API's range). */
export function parsePay(text: string): number | null | undefined {
  const t = text.trim().replace(/^\$/, "").trim();
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  const n = Number(t);
  return n > 0 && n < 1000 ? n : undefined;
}

/** The three answers of the OFCCP's Form CC-305, in the form's own words and
 *  case, the same exception as the veteran answers above. */
export const DISABILITY_OPTIONS: Options<"disability_status"> = [
  { value: "yes", label: "Yes, I have a disability (or previously had a disability)" },
  { value: "no", label: "No, I do not have a disability and have not had one in the past" },
  { value: "declined", label: "I do not want to answer" },
];

/** The voluntary self-identification (EEO) questions. Onboarding never asks
 *  them (KAN-387): the extension asks the first five the first time a form
 *  does, with the same options (autofiller_extension/src/background/self-id.js
 *  copies them: change both together), and saves them through the same PATCH.
 *  The extras (orientation, transgender, pronouns) are My Profile's alone. */
export const SELF_ID_KEYS: QuestionKey[] = [
  "gender",
  "hispanic_latino",
  "race",
  "veteran_status",
  "disability_status",
  "sexual_orientation",
  "transgender",
  "pronouns",
];

/** One of the Profile step's questions: its key in the bank, the heading
 *  the step shows, and the question as forms ask it. */
export type ProfileQuestion = {
  key: QuestionKey;
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
    key: "hispanic_latino",
    label: "Hispanic or Latino",
    question: "Voluntary self-identification: are you Hispanic or Latino?",
    options: HISPANIC_LATINO_OPTIONS,
    columns: 3,
  },
  {
    key: "race",
    // One name for the question, "Race/Ethnicity", in its label and its
    // wording alike; Hispanic or Latino stays the question above.
    label: "Race/Ethnicity",
    question: "Voluntary self-identification: what is your race or ethnicity?",
    options: RACE_OPTIONS,
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
  {
    key: "sexual_orientation",
    label: "Sexual Orientation",
    question: "Voluntary self-identification: how would you describe your sexual orientation?",
    options: ORIENTATION_OPTIONS,
    columns: 3,
  },
  {
    key: "transgender",
    label: "Transgender",
    question: "Voluntary self-identification: do you identify as transgender?",
    options: TRANSGENDER_OPTIONS,
    columns: 3,
  },
  {
    key: "pronouns",
    label: "Pronouns",
    question: "What are your pronouns?",
    options: PRONOUN_OPTIONS,
    columns: 3,
  },
];

/** Availability's two yes/no questions, as forms word them. */
export const AVAILABILITY: {
  key: "onsite_ok" | "full_time_40h";
  label: string;
  question: string;
}[] = [
  {
    key: "onsite_ok",
    label: "On-Site Work",
    question: "Can you work on-site as a posting asks?",
  },
  {
    key: "full_time_40h",
    label: "Full Time",
    question: "Can you work full time, 40 hours a week, during an internship?",
  },
];

/** The language My Profile lists until the student says otherwise: a
 *  suggestion they can remove, not a saved answer. */
export const SUGGESTED_LANGUAGES = ["English"];

export type ScreenerKey =
  | "relatives_at"
  | "relative_public_official"
  | "referred_at"
  | "prior_government_work"
  | "non_compete"
  | "pending_offers";

/** A screener fact: a yes/no, or a list of companies whose Yes asks which
 *  (`companies`, the follow-up's label). */
export type Screener = {
  key: ScreenerKey;
  label: string;
  question: string;
  companies?: string;
};

/** The screener facts, in the order forms tend to ask them. */
export const SCREENERS: Screener[] = [
  {
    key: "relatives_at",
    label: "Relatives at a Company",
    question: "Does a relative of yours work at a company you might apply to?",
    companies: "Which companies?",
  },
  {
    key: "relative_public_official",
    label: "Relative in Public Office",
    question: "Is a close relative of yours a government or public official?",
  },
  {
    key: "referred_at",
    label: "Referrals",
    question: "Did an employee of a company refer you?",
    companies: "Which companies?",
  },
  {
    key: "prior_government_work",
    label: "Government Work",
    question: "Have you ever worked for a government or a government agency?",
  },
  {
    key: "non_compete",
    label: "Non-Compete",
    question: "Are you bound by a non-compete or a similar agreement?",
  },
  {
    key: "pending_offers",
    label: "Pending Offers",
    question: "Do you hold an offer from another employer that is still open?",
    companies: "Which employers?",
  },
];

/** A screener fact as yes, no or unanswered: a list reads as no when empty
 *  ([] is the student's "none") and yes when it names a company. */
export function screenerChoice(answers: AutofillAnswers, key: ScreenerKey): YesNo | null {
  const value = answers[key];
  if (value == null) return null;
  if (Array.isArray(value)) return value.length ? "yes" : "no";
  return value;
}

/** None of These Apply: every screener fact still unanswered set to no, or
 *  [] for a list. Only what the student pressed it for; an answered one
 *  keeps its answer. */
export function noneOfTheseApply(answers: AutofillAnswers): Partial<AutofillAnswers> {
  const change: Partial<AutofillAnswers> = {};
  for (const s of SCREENERS) {
    if (answers[s.key] != null) continue;
    Object.assign(change, { [s.key]: s.companies ? [] : "no" });
  }
  return change;
}

/** The answers that differ from `base`, lists compared by value: what a
 *  Save sends, since the API merges only the keys it is sent. */
export function changedAnswers(
  draft: AutofillAnswers,
  base: AutofillAnswers,
): Partial<AutofillAnswers> {
  return Object.fromEntries(
    Object.entries(draft).filter(
      ([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(base[key as keyof AutofillAnswers]),
    ),
  );
}

/** A typed list ("Acme, Globex") as its names: trimmed, blanks dropped, a
 *  name repeated in another case kept once. */
export function parseList(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => {
      const folded = part.toLowerCase();
      if (!part || seen.has(folded)) return false;
      seen.add(folded);
      return true;
    });
}

const SEASONS = ["winter", "spring", "summer", "fall"] as const;

/** The season a month (0-11) falls in: winter Jan-Feb, spring Mar-May,
 *  summer Jun-Aug, fall Sep-Dec. */
function seasonOf(month: number) {
  return month < 2 ? 0 : month < 5 ? 1 : month < 8 ? 2 : 3;
}

/** The next `count` terms after the one `today` is in, as the API spells
 *  them ("summer 2027"). */
export function upcomingTerms(today: Date, count: number): string[] {
  let season = seasonOf(today.getMonth());
  let year = today.getFullYear();
  const terms: string[] = [];
  while (terms.length < count) {
    season += 1;
    if (season === SEASONS.length) {
      season = 0;
      year += 1;
    }
    terms.push(`${SEASONS[season]} ${year}`);
  }
  return terms;
}

/** A term as a screen shows it: "summer 2027" as "Summer 2027". */
export function termLabel(term: string) {
  return term.charAt(0).toUpperCase() + term.slice(1);
}

/** The last day of a term, "YYYY-MM-DD", for working out what follows it. */
export function termEnd(term: string): string | null {
  const match = /^(winter|spring|summer|fall) (\d{4})$/.exec(term);
  if (!match) return null;
  const end = { winter: "02-28", spring: "05-31", summer: "08-31", fall: "12-31" }[
    match[1] as (typeof SEASONS)[number]
  ];
  return `${match[2]}-${end}`;
}
