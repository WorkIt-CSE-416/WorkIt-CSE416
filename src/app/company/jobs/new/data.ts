/**
 * The vocabularies the job composer offers and the example posting its preview
 * falls back to. Fixtures — swapping to real data touches this file and nothing
 * else.
 *
 * Every list here is display text used as its own value. That is honest for a
 * screen with no backend: inventing stable ids now would be inventing an API
 * nobody has agreed. When one lands, these become `{ id, label }` pairs and the
 * three <SelectField>s stop passing strings; nothing else on the screen reads
 * them.
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

export const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Internship"] as const;

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

/**
 * The three stages of posting a role. Only the first is built; see the note in
 * ./stepper.tsx about why the rail draws all three anyway.
 */
export const STEPS = ["Basic Details", "Screening", "Publish"] as const;

/** What the composer holds while it is being filled in.
 *
 *  Both salaries are strings, not numbers: an empty field has no number, and
 *  storing 0 for "not yet typed" would make the preview claim a $0 floor. The
 *  preview parses them, so digits are the only thing the inputs accept. */
export type JobDraft = {
  title: string;
  department: string;
  location: string;
  employmentType: string;
  salaryMin: string;
  salaryMax: string;
  description: string;
};

export const EMPTY_DRAFT: JobDraft = {
  title: "",
  department: DEPARTMENTS[0],
  location: "",
  employmentType: EMPLOYMENT_TYPES[0],
  salaryMin: "",
  salaryMax: "",
  description: "",
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
  location: "San Francisco, CA",
  salaryMin: 100000,
  salaryMax: 150000,
} as const;
