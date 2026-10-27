import "server-only";

import { connection } from "next/server";

import { apiGet } from "@/lib/api";
import { extractErrorMessage } from "@/lib/auth";
import type { SentResume } from "@/lib/sent-resume-actions";
import { getApplicantSession } from "@/lib/session";

import type { AfterApplied } from "../auto-apply/actions";
import { getApplications, type Application as Stored } from "../auto-apply/applications";
import { formatJobType, formatPlaces, formatSalary, formatWorkStyle } from "../jobs/format";
import type { JobListing, ListingSalaryPeriod } from "../jobs/listings";
import type { Application, ApplicationEvent } from "../tracker";

/** The stages the tracker lists: saved, applied and every stage after it
 *  (KAN-413). Queued, needs-you and skipped are auto apply's, on its page. */
const TRACKED = ["saved", "applied", "interviewing", "offer", "rejected"] as const;
type Tracked = "saved" | "applied" | AfterApplied;

/**
 * The seeker's saved and applied jobs, live (KAN-261): a job's Save button
 * and its Applied button (or auto apply's Submitted) write them, and the
 * API's application list reads them back (GET .../applications
 * ?stage=saved&stage=applied&...&scored=true, backend/app/routers/auto_apply.py),
 * each with the Jobs page's match score. Interviewing, Offer and Rejected
 * (KAN-413) come from the stage menu and from events added on the
 * application's page; the events themselves are one more read (GET
 * .../events, `getEvents`), joined here by job id. Server-only,
 * as every read forwards the session's token. ./data.ts caches it per
 * request.
 *
 * A failed read is an error, never stand-in cards (backend/CLAUDE.md): the
 * page says they aren't loading.
 *
 * The resume each one went out with is the application's own
 * (`sent_resume`, KAN-267): "Did You Apply?" and auto apply name it, so it
 * is the one the student said they sent, not just the last sent to the
 * posting. Null when none was sent or it was deleted since.
 */
export async function getTracked(): Promise<
  { applications: Application[]; error: null } | { applications: null; error: string }
> {
  const [{ applications, error }, events] = await Promise.all([
    getApplications(TRACKED, { scored: true }),
    getEvents(),
  ]);
  if (applications == null) return { applications: null, error };
  // Never the applications without their events: an interview missing from
  // the page would read as no interview.
  if (events.error != null) return { applications: null, error: events.error };
  return {
    applications: applications.map((stored) =>
      toApplication(stored, stored.sent_resume ?? null, events.byJob.get(stored.job.id) ?? []),
    ),
    error: null,
  };
}

/** One event as the API sends it (backend `schemas/tracker.py`). */
type StoredEvent = {
  id: string;
  job_id: string | null;
  kind: "confirmation" | "assessment" | "interview" | "offer" | "rejection" | "other";
  title: string;
  at: string | null;
  on_day: string | null;
  note: string | null;
  meeting_url: string | null;
  source: "manual" | "gmail";
  created_at: string;
};

/** The tracker's kind for each of the API's: an assessment is a deadline
 *  (its due date), and anything else a follow-up, Applied's violet. */
const KIND: Record<StoredEvent["kind"], ApplicationEvent["kind"]> = {
  interview: "interview",
  offer: "offer",
  rejection: "rejection",
  assessment: "deadline",
  other: "follow-up",
  confirmation: "follow-up",
};

/** The seeker's events in one status (GET .../events?status=), as the API
 *  orders them; null with the reason when the read failed. */
async function readEvents(
  status: "accepted" | "proposed",
): Promise<{ events: StoredEvent[]; error: null } | { events: null; error: string }> {
  await connection();
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiGet(`/applicants/${id}/events?status=${status}`, token);
    if (!res.ok) return { events: null, error: await extractErrorMessage(res) };
    return { events: (await res.json()) as StoredEvent[], error: null };
  } catch {
    return { events: null, error: "Could not reach the server." };
  }
}

/** One event as the tracker draws it. Exactly one of `at` and `on_day` is
 *  set: an instant, or a bare date the tracker draws as a whole day. */
function toEvent(event: StoredEvent): ApplicationEvent {
  return {
    id: event.id,
    kind: KIND[event.kind],
    title: event.title,
    at: event.at ?? event.on_day ?? "",
    note: event.note,
    meetingUrl: event.meeting_url,
    source: event.source,
    emailKind: event.kind,
    receivedAt: event.created_at,
  };
}

/** The seeker's accepted events (soonest first), by job id. */
async function getEvents(): Promise<
  { byJob: Map<string, ApplicationEvent[]>; error: null } | { byJob: null; error: string }
> {
  const { events, error } = await readEvents("accepted");
  if (events == null) return { byJob: null, error };
  const byJob = new Map<string, ApplicationEvent[]>();
  for (const event of events) {
    if (!event.job_id) continue;
    byJob.set(event.job_id, [...(byJob.get(event.job_id) ?? []), toEvent(event)]);
  }
  return { byJob, error: null };
}

/** An update: an event the email tracker proposed from one email, waiting
 *  for the student (docs/email_tracker.md, the Updates table). `jobId` is
 *  null for one that matched no application; `emailKind` names the email. */
export type Update = ApplicationEvent & {
  id: string;
  jobId: string | null;
  emailKind: StoredEvent["kind"];
};

/** The seeker's updates, newest first (GET .../events?status=proposed). A
 *  failed read is null: the Updates table and an application's Emails then
 *  show none waiting, since an update is news, not the tracker's record. */
export async function getUpdates(): Promise<Update[] | null> {
  const { events } = await readEvents("proposed");
  return (
    events?.map((event) => ({
      ...toEvent(event),
      id: event.id,
      jobId: event.job_id,
      emailKind: event.kind,
    })) ?? null
  );
}

/** Where the job is, as the Jobs page's card prints it ("Bellevue, WA +2
 *  more"). The work style is a column of its own (KAN-256), so it is no
 *  longer the fallback here. */
function placeOf(job: JobListing) {
  return formatPlaces(job.location_label ?? job.location);
}

/** Each hiring system's name, by a piece of its hosts. The scraper reads
 *  these (scraper/workit_scraper/providers/); Workday's company job boards
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

/** Pay periods in a year, to put an hourly and a yearly pay on one scale. */
const PER_YEAR: Record<ListingSalaryPeriod, number> = { hour: 2080, week: 52, month: 12, year: 1 };

/** The top of its pay as a yearly figure, for the list's Pay Range sort
 *  (KAN-282); null when `payOf` prints nothing. The currency is ignored:
 *  nearly every posting is in USD. */
function payPerYearOf(job: JobListing) {
  const top = job.salary_max ?? job.salary ?? job.salary_min;
  if (top == null || !job.salary_currency || !job.salary_period) return null;
  return top * PER_YEAR[job.salary_period];
}

/** One stored application as a tracker card, with the resume it sent. */
function toApplication(
  { job, stage, added_at, applied_at, open, match, highlights }: Stored<Tracked>,
  sent: SentResume | null,
  events: ApplicationEvent[],
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
    payPerYear: payPerYearOf(job),
    resume: sent?.name ?? null,
    sentResume: sent && { id: sent.id, name: sent.name, format: sent.format },
    // The Jobs page's own score for the job posting (KAN-256), so a card
    // never disagrees with the feed.
    match: match ?? null,
    highlights: highlights ?? [],
    savedOn: added_at,
    appliedOn: applied_at,
    events,
  } satisfies Application;
}
