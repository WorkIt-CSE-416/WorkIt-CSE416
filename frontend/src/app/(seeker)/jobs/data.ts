/**
 * The fixtures the Jobs screen renders against.
 *
 * Shaped after `backend/db/job_posting.md`'s `job_postings` table (plus
 * `job_role_tags`) rather than the original mockup-only fields. Two things the
 * schema has no column for, flagged rather than guessed at:
 *
 * - `jobType`: the schema enum is only `full_time` / `part_time` / `contract`.
 *   The original mock had "Contract to hire" for Verdant, which doesn't fit
 *   any of the three — mapped to `contract` here, losing that nuance.
 * - `experienceLevel`: the schema enum is `internship` / `new_grad` /
 *   `experienced` — there is no junior/mid/senior/staff ladder. Every posting
 *   below reads as `experienced`, which is a real gap (a Staff and a Mid-level
 *   role are indistinguishable at the enum), not an oversight in this fixture.
 *   `minYearsExperience` is the only thing left to tell them apart.
 *
 * Also dropped for not being a `job_postings` column at all:
 * - `Icon`/`tone` (company branding lives on `companies`, not the job)
 * - `flags` (the "N alumni here" pill has no backing table)
 * - `applicants` (a count from elsewhere, not stored on the job)
 *
 * `saved` stays — it is a real per-user action the card still needs, even
 * though it belongs to a seeker/job relation rather than `job_postings`
 * itself.
 *
 * `match`/`highlights` are back too, but deliberately kept separate from the
 * `job_postings`-shaped fields above: this is WorkIt's own matching layer,
 * analyzed against a seeker's profile rather than stored on the posting, so
 * it is the one part of `Recommendation` with no counterpart in
 * `job_posting.md` at all.
 *
 * Nothing reads or writes yet: the filters, the sort, the dismiss and save
 * actions, Ask WorkIt and Apply Now are all inert, as they are on search and on
 * the applications board.
 */

export type JobType = "full_time" | "part_time" | "contract";
export type ExperienceLevel = "internship" | "new_grad" | "experienced";
export type WorkStyle = "remote" | "hybrid" | "onsite";
export type SalaryPeriod = "year" | "hour";
export type JobPostStatus = "draft" | "published" | "closed";

export type Recommendation = {
  id: string;
  companyId: string;
  company: string;

  title: string;
  /** Markdown. Not rendered on the card — this is what the detail view needs. */
  description: string;

  jobType: JobType;
  experienceLevel: ExperienceLevel;
  minYearsExperience?: number;

  workStyle: WorkStyle;
  /** NULL/NULL for fully remote, same as `job_postings`. */
  locationCity: string | null;
  /** ISO 3166-1 alpha-2. */
  locationCountry: string | null;

  salary?: number;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency: string;
  salaryPeriod: SalaryPeriod;

  status: JobPostStatus;
  uploadedAt: string;
  closesAt?: string;

  /** Canonical `job_roles` names this posting is tagged with, via `job_role_tags`. */
  roles: string[];

  saved?: boolean;

  /** 0-100. WorkIt's own score — see the comment at the top of this file, and
   *  @/lib/match for the bands it is read in. */
  match: number;
  /** Why the score is what it is. Three fit a rail without scrolling. */
  highlights: Highlight[];
};

export type Highlight = {
  text: string;
  /** True is a reason to apply; false is a caveat to weigh before applying. */
  met: boolean;
};

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function daysAgo(days: number) {
  return hoursAgo(days * 24);
}

/**
 * The facets the filter row offers, and the options behind each one.
 *
 * Location and keyword are deliberately not here: the top bar's search field
 * already owns both, and a filter chip for "United States" or "Frontend
 * Engineer" would just be a second, disagreeing way to set the same query.
 * What's left is the set every job board narrows on — type, workplace,
 * level, and how fresh the posting is — plus the three that are common
 * enough to want but not frequent enough to earn permanent row space, kept
 * behind All Filters instead.
 */
export const JOB_TYPE_OPTIONS = [
  "Full-time",
  "Part-time",
  "Contract",
  "Contract to hire",
  "Internship",
];

export const WORKPLACE_OPTIONS = ["On-site", "Hybrid", "Remote"];

export const EXPERIENCE_OPTIONS = ["Entry", "Mid", "Senior", "Staff", "Lead"];

export const DATE_POSTED_OPTIONS = ["Past 24 hours", "Past week", "Past month", "Any time"];

export const LOCATION_OPTIONS = ["Remote (US)", "New York, NY", "Seattle, WA", "Austin, TX"];

export const SALARY_OPTIONS = ["$80k+", "$120k+", "$160k+", "$200k+"];

export const INDUSTRY_OPTIONS = [
  "B2B SaaS",
  "Data Infrastructure",
  "Fintech",
  "Healthcare",
  "Logistics",
];

export const RECOMMENDATIONS: Recommendation[] = [
  {
    id: "northwind-staff-frontend-engineer",
    companyId: "northwind-analytics",
    company: "Northwind Analytics",
    title: "Staff Frontend Engineer",
    description:
      "Northwind is looking for a Staff Frontend Engineer to own the architecture of our analytics dashboard.",
    jobType: "full_time",
    experienceLevel: "experienced",
    minYearsExperience: 8,
    workStyle: "hybrid",
    locationCity: "Seattle",
    locationCountry: "US",
    salaryMin: 165_000,
    salaryMax: 210_000,
    salaryCurrency: "USD",
    salaryPeriod: "year",
    status: "published",
    uploadedAt: hoursAgo(3),
    roles: ["Frontend Engineer", "Software Engineer"],
    saved: true,
    match: 94,
    highlights: [
      { text: "React and TypeScript depth", met: true },
      { text: "Pays above your $150k floor", met: true },
      { text: "Two days on-site each week", met: false },
    ],
  },
  {
    id: "lumen-product-engineer-design-systems",
    companyId: "lumen-labs",
    company: "Lumen Labs",
    title: "Product Engineer, Design Systems",
    description:
      "Lumen is hiring a Product Engineer to build and maintain the design system behind our developer tools.",
    jobType: "full_time",
    experienceLevel: "experienced",
    minYearsExperience: 4,
    workStyle: "remote",
    locationCity: null,
    locationCountry: null,
    salaryMin: 150_000,
    salaryMax: 185_000,
    salaryCurrency: "USD",
    salaryPeriod: "year",
    status: "published",
    uploadedAt: hoursAgo(9),
    roles: ["Frontend Engineer", "Design Systems Engineer"],
    match: 88,
    highlights: [
      { text: "Design-systems work you saved twice", met: true },
      { text: "Sponsors H1B", met: true },
      { text: "Team of 12, smaller than you filtered for", met: false },
    ],
  },
  {
    id: "atlas-senior-software-engineer-web",
    companyId: "atlas-freight",
    company: "Atlas Freight",
    title: "Senior Software Engineer, Web",
    description:
      "Atlas Freight is hiring a Senior Software Engineer to build the web tools our logistics team runs on.",
    jobType: "full_time",
    experienceLevel: "experienced",
    minYearsExperience: 6,
    workStyle: "onsite",
    locationCity: "Austin",
    locationCountry: "US",
    salaryMin: 140_000,
    salaryMax: 175_000,
    salaryCurrency: "USD",
    salaryPeriod: "year",
    status: "published",
    uploadedAt: daysAgo(2),
    roles: ["Software Engineer"],
    match: 76,
    highlights: [
      { text: "Matches your Node and GraphQL work", met: true },
      { text: "On-site five days a week", met: false },
      { text: "No relocation package", met: false },
    ],
  },
  {
    id: "verdant-frontend-engineer-ii",
    companyId: "verdant-health",
    company: "Verdant Health",
    title: "Frontend Engineer II",
    description:
      "Verdant Health is hiring a Frontend Engineer II to build accessible patient-facing tools.",
    jobType: "contract",
    experienceLevel: "experienced",
    minYearsExperience: 3,
    workStyle: "hybrid",
    locationCity: "Boston",
    locationCountry: "US",
    salaryMin: 120_000,
    salaryMax: 145_000,
    salaryCurrency: "USD",
    salaryPeriod: "year",
    status: "published",
    uploadedAt: daysAgo(4),
    closesAt: daysAgo(-14),
    roles: ["Frontend Engineer"],
    match: 58,
    highlights: [
      { text: "Accessibility work you list as a strength", met: true },
      { text: "Contract for the first six months", met: false },
      { text: "Below your salary floor", met: false },
    ],
  },
];
