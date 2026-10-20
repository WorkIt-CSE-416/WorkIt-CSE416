import "server-only";

import { listSentResumes, type SentResume } from "@/lib/sent-resume-actions";

import { getApplications, type Application as Stored } from "../auto-apply/applications";
import { formatJobType, formatPlaces, formatSalary, formatWorkStyle } from "../jobs/format";
import type { JobListing } from "../jobs/listings";
import type { Application } from "../tracker";

/**
 * The seeker's saved and applied jobs, live (KAN-261): a job's Save button
 * and its Applied button (or auto apply's Submitted) write them, and the
 * API's application list reads them back (GET .../applications
 * ?stage=saved&stage=applied&scored=true, backend/app/routers/auto_apply.py),
 * each with the Jobs page's match score. Server-only,
 * as every read forwards the session's token. ./data.ts caches it per
 * request.
 *
 * A failed read is an error, never stand-in cards (backend/CLAUDE.md): the
 * page says they aren't loading.
 *
 * The resume each one sent comes from the sent resumes list (KAN-256): Apply
 * and auto apply keep the resume they attach as a sent resume linked to the
 * job posting. That read failing only empties the Resume column; it never
 * fails the page.
 */
export async function getTracked(): Promise<
  { applications: Application[]; error: null } | { applications: null; error: string }
> {
  const [{ applications, error }, sent] = await Promise.all([
    getApplications(["saved", "applied"] as const, { scored: true }),
    listSentResumes(),
  ]);
  if (applications == null) return { applications: null, error };
  const resumes = lastSentByJob(sent.data ?? []);
  return {
    applications: applications.map((stored) =>
      toApplication(stored, resumes.get(stored.job.id) ?? null),
    ),
    error: null,
  };
}

/** Each job posting's last sent resume, by its name. The list comes newest
 *  first, so the first one per posting is the last sent there, as the job
 *  posting's own page reads it. */
function lastSentByJob(sent: SentResume[]) {
  const byJob = new Map<string, string>();
  for (const resume of sent) {
    if (resume.job_posting_id && !byJob.has(resume.job_posting_id)) {
      byJob.set(resume.job_posting_id, resume.name);
    }
  }
  return byJob;
}

/** Where the job is, as the Jobs page's card prints it ("Bellevue, WA +2
 *  more"). The work style is a column of its own (KAN-256), so it is no
 *  longer the fallback here. */
function placeOf(job: JobListing) {
  return formatPlaces(job.location_label ?? job.location);
}

/** Each hiring system's name, by a piece of its hosts. The scraper reads
 *  these (scraper/workit_scraper/providers.py); Workday's company job boards
 *  sit on myworkdayjobs.com. */
const HIRING_SYSTEMS: [string, string][] = [
  ["greenhouse.io", "Greenhouse"],
  ["lever.co", "Lever"],
  ["ashbyhq.com", "Ashby"],
  ["myworkdayjobs.com", "Workday"],
  ["workable.com", "Workable"],
  ["smartrecruiters.com", "SmartRecruiters"],
];

/** The hiring system a posting's apply link is on, else "Company Site". */
function sourceOf(applyUrl: string) {
  let host: string;
  try {
    host = new URL(applyUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  return HIRING_SYSTEMS.find(([piece]) => host.includes(piece))?.[1] ?? "Company Site";
}

/** Its pay, as the Jobs page's card prints it ("$40 - $50/hr"); null when the
 *  posting states none. */
function payOf(job: JobListing) {
  if (!job.salary_currency || !job.salary_period) return null;
  return formatSalary({
    salary: job.salary ?? undefined,
    salaryMin: job.salary_min ?? undefined,
    salaryMax: job.salary_max ?? undefined,
    salaryCurrency: job.salary_currency,
    salaryPeriod: job.salary_period,
  });
}

/** One stored application as a tracker card, with the resume it sent. */
function toApplication(
  { job, stage, added_at, applied_at, open, match, highlights }: Stored<"saved" | "applied">,
  resume: string | null,
) {
  return {
    id: job.id,
    role: job.title,
    company: job.company,
    logoUrl: job.logo_url,
    // A closed posting's page is gone, so its card links nowhere.
    jobHref: open ? `/jobs/${encodeURIComponent(job.id)}` : undefined,
    stage,
    status: open ? undefined : "Posting Closed",
    open,
    location: placeOf(job),
    workModel: job.work_style ? formatWorkStyle(job.work_style) : null,
    track: job.job_type ? formatJobType(job.job_type) : null,
    source: sourceOf(job.apply_url),
    pay: payOf(job),
    resume,
    // The Jobs page's own score for the job posting (KAN-256), so a card
    // never disagrees with the feed.
    match: match ?? null,
    highlights: highlights ?? [],
    savedOn: added_at,
    appliedOn: applied_at,
    events: [],
  } satisfies Application;
}
