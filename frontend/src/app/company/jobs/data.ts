import type { BadgeTone } from "@/components/ui/badge";
import type { CompanyJobSummary } from "@/lib/job-queries";

import { formatCountry } from "./new/data";

/**
 * What /company/jobs lists. The rows come from GET /company/jobs through
 * `toPosting` below; `POSTINGS` is still the fixture the per-job detail
 * screen (src/components/job-detail/data.ts) reads until it is wired too.
 */

export type JobStatus = "Open" | "Paused" | "Closed" | "Draft";

export type Posting = {
  id: string;
  role: string;
  team: string;
  status: JobStatus;
  applicants: number;
  /** Applicants nobody has opened yet. */
  unreviewed: number;
  /** ISO date. Sorted and formatted as a date, never as a string. */
  posted: string;
  location: string;
};

export const STATUSES: JobStatus[] = ["Open", "Paused", "Closed", "Draft"];

/**
 * What each status is, rather than what each one is called.
 *
 * Open is running, Paused is stopped but recoverable and waiting on someone
 * here, Closed is over, and Draft has never been live at all — which is why it
 * is the one with no fill.
 *
 * It lives beside the data rather than in the table so that /design-kit can
 * render the real set from the same source. A copy over there would be right
 * on the day it was written and wrong the first time anyone retoned a status.
 */
export const STATUS_TONE: Record<JobStatus, BadgeTone> = {
  Open: "positive",
  Paused: "warning",
  Closed: "inert",
  Draft: "outline",
};

export const POSTINGS: Posting[] = [
  {
    id: "j1",
    role: "Frontend Engineer, New Grad",
    team: "Product",
    status: "Open",
    applicants: 86,
    unreviewed: 6,
    posted: "2026-08-04",
    location: "New York, NY",
  },
  {
    id: "j2",
    role: "Platform Engineer",
    team: "Infrastructure",
    status: "Open",
    applicants: 41,
    unreviewed: 12,
    posted: "2026-08-11",
    location: "Remote",
  },
  {
    id: "j3",
    role: "Data Analyst Intern",
    team: "Analytics",
    status: "Open",
    applicants: 63,
    unreviewed: 0,
    posted: "2026-07-22",
    location: "Stony Brook, NY",
  },
  {
    id: "j4",
    role: "Design Systems Engineer",
    team: "Product",
    status: "Paused",
    applicants: 18,
    unreviewed: 3,
    posted: "2026-06-30",
    location: "Remote",
  },
  {
    id: "j5",
    role: "Site Reliability Engineer",
    team: "Infrastructure",
    status: "Open",
    applicants: 27,
    unreviewed: 9,
    posted: "2026-08-19",
    location: "Austin, TX",
  },
  {
    id: "j6",
    role: "Technical Writer",
    team: "Product",
    status: "Draft",
    applicants: 0,
    unreviewed: 0,
    posted: "2026-08-26",
    location: "Remote",
  },
  {
    id: "j7",
    role: "Backend Engineer, Payments",
    team: "Payments",
    status: "Closed",
    applicants: 112,
    unreviewed: 0,
    posted: "2026-05-14",
    location: "New York, NY",
  },
  {
    id: "j8",
    role: "Machine Learning Engineer",
    team: "Analytics",
    status: "Open",
    applicants: 54,
    unreviewed: 4,
    posted: "2026-08-01",
    location: "Remote",
  },
];

/** "Open" is what a recruiter calls a published job. Paused has no stored
 *  status yet, so nothing maps to it. */
const STATUS_LABEL: Record<CompanyJobSummary["status"], JobStatus> = {
  draft: "Draft",
  published: "Open",
  closed: "Closed",
};

/**
 * A job from the API as a table row. Team and the applicant counts have no
 * source yet (no department column, no applications table), so they stay
 * empty and zero rather than invented.
 */
export function toPosting(job: CompanyJobSummary): Posting {
  // "US-NY" -> "NY". Only the US has states seeded. The country is spelled
  // out, the way the composer shows it.
  const place = [job.location_state?.split("-")[1], formatCountry(job.location_country)]
    .filter(Boolean)
    .join(", ");

  return {
    id: job.id,
    role: job.title,
    team: "",
    status: STATUS_LABEL[job.status],
    applicants: 0,
    unreviewed: 0,
    posted: job.created_at,
    location: job.work_style === "remote" ? `Remote, ${place}` : place,
  };
}
