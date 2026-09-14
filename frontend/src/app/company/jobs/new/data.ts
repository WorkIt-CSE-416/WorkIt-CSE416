/**
 * The vocabularies the job composer offers and the example posting its preview
 * falls back to. Fixtures — swapping to real data touches this file and nothing
 * else.
 *
 * Shaped after `backend/db/job_posting.md`'s `job_postings` table rather than
 * the original mockup-only fields:
 *
 * - `Department` stays its own free-standing select (Engineering, Design, …).
 *   It has no column in `job_postings` and is not shown on the job card a
 *   seeker sees — it exists so a company can organize and filter its own
 *   postings internally, the same job it did before this pass. A schema-backed
 *   role-tagging layer (`job_role_tags`/`job_roles`, for seeker-side role
 *   search) was tried here and pulled back out: this screen is company
 *   bookkeeping, not the applicant-facing categorization, and the two
 *   shouldn't be conflated in one field. If role tagging is wanted later it
 *   belongs on its own, separate from Department.
 * - `Location` used to be one free-text field mixing city, region and
 *   "is this remote" together. It is now a picker over the company's own
 *   saved locations (`SAVED_LOCATIONS`, standing in for a `company_locations`
 *   reference table `job_posting.md` doesn't define, the same way `JOB_ROLES`
 *   stands in for `job_roles`), each stored as structured city + ISO country
 *   rather than a string — with "is this remote" split out entirely into
 *   `workStyle`.
 * - `Employment Type`'s old four options conflated `job_type` and
 *   `experience_level` — "Internship" is not a job type in the schema, it is
 *   an experience level. Split into `jobType` and `experienceLevel` below.
 * - Salary gained a `salaryType` (exact figure vs. range), `currency`, and
 *   `salaryPeriod`, matching the schema's `salary`/`salary_min`/`salary_max` +
 *   `salary_currency` + `salary_period` rather than assuming a USD/year range.
 *
 * Every list here is still display text used as its own value, per the
 * original note: that is honest for a screen with no backend, and inventing
 * stable ids for these would be inventing an API nobody has agreed.
 * `SAVED_LOCATIONS` is the exception — it needs real ids because a posting
 * references exactly one, rather than copying it.
 */

export const DEPARTMENTS = [
  "Engineering",
  "Design",
  "Product",
  "Data",
  "Marketing",
  "Sales",
  "Operations",
  "People",
] as const;

export const JOB_TYPES = ["Full-time", "Part-time", "Contract"] as const;
export const EXPERIENCE_LEVELS = ["Internship", "New Grad", "Experienced"] as const;
export const WORK_STYLES = ["Remote", "Hybrid", "On-site"] as const;
export const SALARY_TYPES = ["Exact figure", "Range"] as const;
export const SALARY_PERIODS = ["Year", "Hour"] as const;
export const CURRENCIES = ["USD", "EUR", "GBP", "CAD"] as const;

/** What a screening answer is expected to look like, which is what decides the
 *  control an applicant is shown. */
export const QUESTION_TYPES = ["Short text", "Long text", "Number", "Yes / No"] as const;

export type ScreeningQuestion = {
  id: string;
  prompt: string;
  type: string;
  /** Whether an applicant can submit without answering. */
  required: boolean;
};

/**
 * The composer opens with one question already in the list rather than empty.
 *
 * An empty list makes screening look optional and gets skipped; one filled-in
 * row shows the shape of the thing and is cheaper to edit than to create. It is
 * deletable like any other.
 */
export const INITIAL_QUESTIONS: ScreeningQuestion[] = [
  {
    id: "q1",
    prompt: "How many years of experience do you have with React?",
    type: "Number",
    required: true,
  },
];

/** The three stages of posting a role. Only the first two are built — see the
 *  note in ./stepper.tsx about why the rail draws all three anyway. */
export const STEPS = ["Basic Details", "Screening", "Publish"] as const;

export const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" },
  { code: "DE", name: "Germany" },
  { code: "IN", name: "India" },
  { code: "AU", name: "Australia" },
] as const;

export type SavedLocation = {
  id: string;
  city: string;
  /** ISO 3166-1 alpha-2, matching `location_country`. */
  country: string;
};

/**
 * A company's previously-used locations, picked from rather than retyped.
 * Stands in for a `company_locations` table `job_posting.md` doesn't define —
 * the same bargain `JOB_ROLES` strikes for `job_roles`. New ones are added
 * from the composer itself; see ./fields.tsx's `LocationField`.
 */
export const SAVED_LOCATIONS: SavedLocation[] = [
  { id: "san-francisco", city: "San Francisco", country: "US" },
  { id: "new-york", city: "New York", country: "US" },
  { id: "austin", city: "Austin", country: "US" },
  { id: "toronto", city: "Toronto", country: "CA" },
];

/** "San Francisco, United States" from a city and an ISO country code. */
export function formatLocation(city: string, country: string) {
  const match = COUNTRIES.find((c) => c.code === country);
  return `${city}, ${match?.name ?? country}`;
}

/** What the composer holds while it is being filled in.
 *
 *  Salary and min-years-experience are strings, not numbers: an empty field
 *  has no number, and storing 0 for "not yet typed" would make the preview
 *  claim a $0 floor or a 0-year requirement. The preview parses them, so
 *  digits are the only thing the inputs accept. */
export type JobDraft = {
  title: string;
  /** Internal only — never rendered on the job card a seeker sees. */
  department: string;
  workStyle: string;
  /** Id into `SAVED_LOCATIONS` (or a location just added). Null for Remote,
   *  or before anything is picked. */
  locationId: string | null;

  jobType: string;
  experienceLevel: string;
  minYearsExperience: string;

  salaryType: string;
  salary: string;
  salaryMin: string;
  salaryMax: string;
  currency: string;
  salaryPeriod: string;

  description: string;

  /** yyyy-mm-dd from a native date input, or "" — asked only on Publish. */
  closesAt: string;
};

export const EMPTY_DRAFT: JobDraft = {
  title: "",
  department: DEPARTMENTS[0],
  workStyle: WORK_STYLES[0],
  locationId: null,
  jobType: JOB_TYPES[0],
  experienceLevel: EXPERIENCE_LEVELS[0],
  minYearsExperience: "",
  salaryType: SALARY_TYPES[0],
  salary: "",
  salaryMin: "",
  salaryMax: "",
  currency: CURRENCIES[0],
  salaryPeriod: SALARY_PERIODS[0],
  description: "",
  closesAt: "",
};

/**
 * What the preview shows in place of a field nobody has filled in yet.
 *
 * It is the same posting the inputs use as their placeholders, so the preview
 * reads as the example the form is already suggesting rather than as a second,
 * unrelated one. Deliberately rendered at full strength rather than greyed:
 * the panel's job is to show what the posting will look like, and a muted
 * preview would be showing something the applicant never sees.
 */
export const EXAMPLE = {
  title: "Senior Frontend Engineer",
  location: "San Francisco, United States",
  salaryMin: 100000,
  salaryMax: 150000,
} as const;
