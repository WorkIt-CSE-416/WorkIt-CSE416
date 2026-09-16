import { format, formatDistanceToNowStrict } from "date-fns";

import type { ExperienceLevel, JobType, Recommendation, WorkStyle } from "./data";

/**
 * Turns the schema-shaped fields on `Recommendation` back into the strings
 * the card used to carry pre-formatted. Keeping this separate from `data.ts`
 * is what stops the fixtures from re-hardcoding display text the way the
 * mockup-only version did.
 */

const JOB_TYPE_LABEL: Record<JobType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
};

const WORK_STYLE_LABEL: Record<WorkStyle, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

const EXPERIENCE_LABEL: Record<ExperienceLevel, string> = {
  internship: "Internship",
  new_grad: "New grad",
  experienced: "Experienced",
};

const countryName = new Intl.DisplayNames(["en"], { type: "region" });

export function formatJobType(jobType: JobType) {
  return JOB_TYPE_LABEL[jobType];
}

export function formatWorkStyle(workStyle: WorkStyle) {
  return WORK_STYLE_LABEL[workStyle];
}

export function formatExperienceLevel(level: ExperienceLevel) {
  return EXPERIENCE_LABEL[level];
}

/** Null when the role has no minimum, which is what tells the card to drop
 *  the fact rather than print an empty one. */
export function formatMinYearsExperience(minYears?: number) {
  return minYears ? `${minYears}+ yrs exp` : null;
}

export function formatLocation(city: string | null, country: string | null) {
  if (!city || !country) return "Remote";
  try {
    return `${city}, ${countryName.of(country) ?? country}`;
  } catch {
    return `${city}, ${country}`;
  }
}

/** "US" -> "United States", with no city — a Remote posting that names a
 *  country a candidate must be based in but, being remote, has no office
 *  city to go with it. Kept separate from `formatLocation` rather than
 *  folded into its `!city` branch: that branch is "Remote" full stop, used
 *  when there is no location information at all, and callers that do have a
 *  country need to tell the two states apart. */
export function formatCountry(country: string) {
  try {
    return countryName.of(country) ?? country;
  } catch {
    return country;
  }
}

/**
 * A posting's location as one string: city and country when it has a city,
 * the country alone when it doesn't (a Remote role restricted to, say, the
 * US), and null only when there is no location information at all.
 *
 * Shared by the feed card and the expanded view so the two cannot describe the
 * same posting's location differently.
 */
export function formatJobLocation(job: Pick<Recommendation, "locationCity" | "locationCountry">) {
  if (job.locationCity) return formatLocation(job.locationCity, job.locationCountry);
  return job.locationCountry ? formatCountry(job.locationCountry) : null;
}

export function formatSalary(
  job: Pick<
    Recommendation,
    "salary" | "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod"
  >,
) {
  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: job.salaryCurrency,
    /* 2, not 0: compact notation only abbreviates above four digits, so an
       hourly rate under $1,000 prints uncompacted — at 0 digits, cents like
       $27.50/hr would silently round to $28/hr. A whole-dollar Year salary
       never had a fractional part, so raising this changes nothing for it. */
    maximumFractionDigits: 2,
    notation: "compact",
  });

  const period = job.salaryPeriod === "year" ? "yr" : "hr";
  const range =
    job.salaryMin != null && job.salaryMax != null
      ? `${fmt.format(job.salaryMin)} - ${fmt.format(job.salaryMax)}`
      : fmt.format(job.salary ?? 0);

  return `${range}/${period}`;
}

export function formatPosted(uploadedAt: string) {
  return `Posted ${formatDistanceToNowStrict(new Date(uploadedAt))} ago`;
}

/** The 6th fact slot: a close date when the posting has one, else recency. */
export function formatTiming(uploadedAt: string, closesAt?: string) {
  return closesAt
    ? `Closes ${format(new Date(closesAt), "MMM d, yyyy")}`
    : formatPosted(uploadedAt);
}
