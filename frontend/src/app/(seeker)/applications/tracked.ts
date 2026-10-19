import "server-only";

import { listSentResumes, type SentResume } from "@/lib/sent-resume-actions";

import { getApplications, type Application as Stored } from "../auto-apply/applications";
import { formatPlaces, formatSalary, formatWorkStyle } from "../jobs/format";
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

/** Where the job is, as the Jobs page's card prints it: its place ("Bellevue,
 *  WA +2 more"), else its work style ("Remote"). */
function placeOf(job: JobListing) {
  return (
    formatPlaces(job.location_label ?? job.location) ??
    (job.work_style ? formatWorkStyle(job.work_style) : null)
  );
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
  {
    job,
    stage,
    added_at,
    applied_at,
    open,
    match,
    highlights,
    score_breakdown,
  }: Stored<"saved" | "applied">,
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
    pay: payOf(job),
    resume,
    // The Jobs page's own score for the job posting (KAN-256), so a card
    // never disagrees with the feed.
    match: match ?? null,
    highlights: highlights ?? [],
    breakdown: score_breakdown ?? null,
    savedOn: added_at,
    appliedOn: applied_at,
    events: [],
  } satisfies Application;
}
