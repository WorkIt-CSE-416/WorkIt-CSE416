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

export function formatExperience(level: ExperienceLevel, minYears?: number) {
  const label = EXPERIENCE_LABEL[level];
  return minYears ? `${label} · ${minYears}+ yrs` : label;
}

export function formatLocation(city: string | null, country: string | null) {
  if (!city || !country) return "Remote";
  try {
    return `${city}, ${countryName.of(country) ?? country}`;
  } catch {
    return `${city}, ${country}`;
  }
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
    maximumFractionDigits: 0,
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
