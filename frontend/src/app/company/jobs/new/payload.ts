import type { JobPayload } from "@/lib/job-actions";
import type { CompanyJob } from "@/lib/job-queries";

import {
  DEPARTMENTS,
  formatCloseDateValue,
  parseCloseDate,
  type JobDraft,
  type SavedLocation,
} from "./data";

/**
 * The composer's display labels mapped to the values the API stores. The form
 * keeps its labels as values (see the top of ./data.ts), so this is the one
 * place the two vocabularies meet.
 *
 * "Experienced" maps to `other` because that is the stored enum value; renaming
 * it is a coordinated migration (backend/app/models/CLAUDE.md), not an edit.
 */
const JOB_TYPE = {
  "Full-time": "full_time",
  "Part-time": "part_time",
  Contract: "contract",
} as const satisfies Record<string, JobPayload["jobType"]>;

const EXPERIENCE_LEVEL = {
  Internship: "internship",
  "New Grad": "new_grad",
  Experienced: "other",
} as const satisfies Record<string, JobPayload["experienceLevel"]>;

const WORK_STYLE = {
  Remote: "remote",
  Hybrid: "hybrid",
  "On-site": "onsite",
} as const satisfies Record<string, JobPayload["workStyle"]>;

const SALARY_PERIOD = {
  Year: "year",
  Hour: "hour",
} as const satisfies Record<string, JobPayload["salaryPeriod"]>;

/** "" (and a lone "." typed on the way to "27.50") is no number at all.
 *  Number(".") is NaN, which JSON would send as null. */
function toNumber(value: string) {
  return value === "" || value === "." ? null : Number(value);
}

/**
 * The request body for a draft the composer already considers complete.
 *
 * Only the country of the picked location is sent: `job_postings` has no city
 * column, so the city a saved location carries is display-only for now.
 */
export function toJobPayload(
  draft: JobDraft,
  locations: SavedLocation[],
  status: JobPayload["status"],
): JobPayload {
  const location = locations.find((saved) => saved.id === draft.locationId);
  const isRange = draft.salaryType === "Range";
  const closeDate = parseCloseDate(draft.closesAt);

  return {
    status,
    title: draft.title.trim(),
    description: draft.description.trim(),
    jobType: JOB_TYPE[draft.jobType as keyof typeof JOB_TYPE],
    experienceLevel: EXPERIENCE_LEVEL[draft.experienceLevel as keyof typeof EXPERIENCE_LEVEL],
    minYearsExperience:
      draft.experienceLevel === "Experienced" ? toNumber(draft.minYearsExperience) : null,
    workStyle: WORK_STYLE[draft.workStyle as keyof typeof WORK_STYLE],
    locationCountry: location?.country ?? "",
    locationState: location?.state ?? null,
    salary: isRange ? null : toNumber(draft.salary),
    salaryMin: isRange ? toNumber(draft.salaryMin) : null,
    salaryMax: isRange ? toNumber(draft.salaryMax) : null,
    currency: draft.currency,
    salaryPeriod: SALARY_PERIOD[draft.salaryPeriod as keyof typeof SALARY_PERIOD],
    // Applications close at the end of the picked day in the recruiter's own
    // timezone. toISOString carries the offset the API requires.
    closesAt: closeDate
      ? new Date(
          closeDate.getFullYear(),
          closeDate.getMonth(),
          closeDate.getDate(),
          23,
          59,
          59,
        ).toISOString()
      : null,
  };
}

/** The label a stored enum value came from, for filling the form back in. */
function labelFor<T extends string>(map: Record<string, T>, value: T) {
  return Object.keys(map).find((label) => map[label] === value) ?? "";
}

/**
 * A saved job turned back into the composer's draft, for the edit page.
 *
 * Browser only: `closes_at` becomes a calendar day in the timezone this runs
 * in. On a UTC server that is the day after for anyone in the Americas, and
 * every save would push the closing date a day later.
 *
 * The location comes back as a country-only entry: no city was stored, so
 * guessing one from the company's saved locations could show the wrong
 * office. Department isn't stored either, so it reopens on the default.
 */
export function fromCompanyJob(job: CompanyJob): { draft: JobDraft; location: SavedLocation } {
  const location: SavedLocation = {
    id: `country-${job.location_country}`,
    city: "",
    country: job.location_country,
    // Kept so saving the form doesn't clear a state the picker can't show.
    state: job.location_state ?? undefined,
  };
  const isRange = job.salary === null;
  const closeDate = job.closes_at ? new Date(job.closes_at) : null;
  const toText = (value: number | null) => (value === null ? "" : String(value));

  return {
    location,
    draft: {
      title: job.title,
      department: DEPARTMENTS[0],
      workStyle: labelFor(WORK_STYLE, job.work_style),
      locationId: location.id,
      jobType: labelFor(JOB_TYPE, job.job_type),
      experienceLevel: labelFor(EXPERIENCE_LEVEL, job.experience_level),
      minYearsExperience: toText(job.min_years_experience),
      salaryType: isRange ? "Range" : "Exact figure",
      salary: toText(job.salary),
      salaryMin: toText(job.salary_min),
      salaryMax: toText(job.salary_max),
      currency: job.salary_currency,
      salaryPeriod: labelFor(SALARY_PERIOD, job.salary_period),
      description: job.description,
      closesAt: closeDate ? formatCloseDateValue(closeDate) : "",
    },
  };
}
