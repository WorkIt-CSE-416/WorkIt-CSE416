import "server-only";

import { connection } from "next/server";

import { apiGet } from "@/lib/api";
import { extractErrorMessage } from "@/lib/auth";
import { getAccessToken, getApplicantSession } from "@/lib/session";

import type { ExperienceLevel, Highlight, JobType, WorkStyle } from "./data";
import {
  feedQuery,
  filtersFromPreferences,
  NO_FILTERS,
  PAGE_SIZE,
  type FeedFilters,
  type SavedPreferences,
} from "./filter-query";

/**
 * The live feed: scraped roles from the API's `GET /jobs`, which reads the
 * imported job_postings rows (backend/app/routers/jobs.py). Mirrors
 * backend/app/schemas/jobs.py field for field. Read by /jobs, by /search (which
 * sends its words as `q`), by their Load More (./actions) a page at a time, and
 * by the Dashboard's New Matches.
 *
 * NOT IN ./data.ts, THOUGH THAT IS THE USUAL SEAM. Client components import
 * ./data's types (`filters.tsx`, `filter-query.ts`), and `apiGet` is
 * server-only — putting the fetch there would pull it into the client bundle
 * and fail the build. ./data keeps the fixtures, which still back the
 * expanded view at /jobs/[jobId]; the filter options are in ./filter-query.
 *
 * Its own type, not an optional-everything `Recommendation`: a scraped role has
 * no description or match score, and states its salary, job type and years
 * only sometimes — making those optional on the fixture type would push null
 * checks into every screen that reads it.
 */
export type JobListing = {
  id: string;
  title: string;
  company: string;
  apply_url: string;
  /** Who the job is for, the API's `Literal["student", "new_grad",
   *  "experienced"]` (KAN-233); every internship is a student job. */
  experience_level: ExperienceLevel;
  work_style: WorkStyle | null;
  location: string | null;
  /** The card's version, "San Francisco, CA", where the import placed a US
   *  city (job_postings.location_label); null leaves `location` to be tidied. */
  location_label: string | null;
  posted_at: string | null;
  logo_url: string | null;
  /** The rest of the card, named after `job_postings`' columns. Null when the
   *  posting never states it — the scraper reads the board's own fields, then
   *  the description, and infers only by measured rules (job type Full-Time
   *  for a silent new-grad role). Every internship is `internship`, whatever
   *  hours its posting states (KAN-233). */
  job_type: JobType | null;
  /** One amount, or `salary_min`/`salary_max` for a range; all null when the
   *  posting states no pay. */
  salary: number | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  /** Wider than `SalaryPeriod`: internships often pay by the month or week. */
  salary_period: ListingSalaryPeriod | null;
  min_years_experience: number | null;
  /** When an internship starts, as the posting names it: "Summer 2027",
   *  "January 2027", "2027". */
  start_term: string | null;
  /** The posting's text, plain, with its line breaks: only on the role's own
   *  page (`getJobListing`); the feed leaves it out. Ends " …" when the
   *  scraper cut it at its 8,000 characters. */
  description?: string | null;
  /** What the posting says about visas (KAN-168): it sponsors, it doesn't, or
   *  US citizens only. Null when it says nothing, which is most postings. */
  sponsorship: "sponsors" | "no_sponsorship" | "citizens_only" | null;
  /** Whether auto apply takes it: its apply_url is on a hiring system the
   *  extension fills (Greenhouse for now; the API's
   *  `app/auto_apply/hosts.py` decides). Auto Apply shows only where true. */
  auto_apply: boolean;
  /** WorkIt's score against the seeker's resume, 0-100, and why: only on
   *  the Recommended view (`getRecommendedPage`), whose API adds them. The
   *  card's match rail draws its placeholder without them. */
  match?: number;
  highlights?: Highlight[];
};

export type ListingSalaryPeriod = "hour" | "week" | "month" | "year";

/** One place the feed can be narrowed to, from `GET /jobs/locations`: a
 *  country ("US") or one of its states ("US-CA"), with the name people read.
 *  Only places that have a job are listed. */
export type JobLocationOption = {
  code: string;
  /** "United States", "California", "Other". A state's label is its name
   *  alone: the Location facet lists it under its country. */
  label: string;
  jobs: number;
};

/** Public, but sent with the viewer's token when they are signed in: the API
 *  then leaves out the jobs an applicant marked as applied (KAN-232). An
 *  error is a message to print, never fixture jobs in its place — made-up
 *  postings shown silently would read as real ones. `filters` narrows it on
 *  the server, the filter row's picks as the URL holds them (./filter-query). */
export type FeedPage =
  { jobs: JobListing[]; more: boolean; error: null } | { jobs: null; more: false; error: string };

/** The signed-in viewer's token, or null: signed out, or no Supabase env vars
 *  (a fresh clone, where the feed still loads, public). Never pass it with
 *  `revalidate`: a cached answer would be one applicant's, served to all. */
export async function viewerToken(): Promise<string | null> {
  try {
    return await getAccessToken();
  } catch {
    return null;
  }
}

/** The first page of the feed under these filters and /search's words, for a
 *  page to render. */
export async function getJobListings(filters: FeedFilters = NO_FILTERS, q = ""): Promise<FeedPage> {
  // Request time, not build time: without this `next build` prerenders the
  // feed once — with no API running in CI, that bakes the error in for good.
  await connection();
  return getFeedPage(feedQuery(filters, q), 0);
}

/** One page of the feed, `offset` roles in, for a query feedQuery wrote: the
 *  first render's and each Load More's (./actions). It asks for one role past
 *  the page, so `more` says whether a Load More would find anything, without
 *  a count. */
export async function getFeedPage(query: string, offset: number): Promise<FeedPage> {
  const params = new URLSearchParams(query);
  params.set("limit", String(PAGE_SIZE + 1));
  if (offset > 0) params.set("offset", String(offset));
  try {
    const res = await apiGet(`/jobs?${params}`, (await viewerToken()) ?? undefined);
    if (!res.ok) return { jobs: null, more: false, error: await extractErrorMessage(res) };
    const jobs = (await res.json()) as JobListing[];
    return { jobs: jobs.slice(0, PAGE_SIZE), more: jobs.length > PAGE_SIZE, error: null };
  } catch {
    return { jobs: null, more: false, error: "Could not reach the server." };
  }
}

/**
 * One page of the Recommended view (KAN-231): the jobs these filters keep,
 * scored against the seeker's experience bank and best first, from GET
 * /jobs/recommended/{id}, which takes the same filters as GET /jobs.
 * `query` is feedQuery's. Null when the bank is empty (the API's 404) or
 * the account is not an applicant's (403, a company account): the page then
 * shows the plain feed under the same filters, below BankPrompt.
 */
export async function getRecommendedPage(query: string, offset: number): Promise<FeedPage | null> {
  await connection();
  const params = new URLSearchParams(query);
  params.set("limit", String(PAGE_SIZE + 1));
  if (offset > 0) params.set("offset", String(offset));
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiGet(`/jobs/recommended/${id}?${params}`, token);
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) return { jobs: null, more: false, error: await extractErrorMessage(res) };
    const jobs = (await res.json()) as JobListing[];
    return { jobs: jobs.slice(0, PAGE_SIZE), more: jobs.length > PAGE_SIZE, error: null };
  } catch {
    return { jobs: null, more: false, error: "Could not reach the server." };
  }
}

/** The seeker's saved preferences as the feed's filters, or null when they
 *  have saved none or the API can't say: the Recommended view's starting
 *  filters (./page). */
export async function getSavedFilters(): Promise<FeedFilters | null> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiGet(`/applicants/${id}/preferences`, token);
    if (!res.ok) return null;
    return filtersFromPreferences((await res.json()) as SavedPreferences);
  } catch {
    return null;
  }
}

/** How many roles these filters and words keep, every page together: /search's
 *  "128 Roles". Null when the API can't say. With the token, as the feed, so
 *  the count leaves out the same applied jobs the list does. */
export async function getJobCount(filters: FeedFilters, q = ""): Promise<number | null> {
  try {
    const res = await apiGet(
      `/jobs/count${feedQuery(filters, q)}`,
      (await viewerToken()) ?? undefined,
    );
    if (!res.ok) return null;
    return ((await res.json()) as { jobs: number }).jobs;
  } catch {
    return null;
  }
}

/** How long the filter row's places and counts are reused before asking the API
 *  again. They change only when an import runs (every few hours), and each ask
 *  costs the API a database connection and six counting queries, which every
 *  filter change used to pay again. */
const COUNTS_TTL = 300;

/** The Location filter's options. Empty when the API can't be reached: the
 *  facet then shows disabled, and the feed below reports the error itself. */
export async function getJobLocations(): Promise<JobLocationOption[]> {
  await connection();
  try {
    const res = await apiGet("/jobs/locations", undefined, { revalidate: COUNTS_TTL });
    return res.ok ? ((await res.json()) as JobLocationOption[]) : [];
  } catch {
    return [];
  }
}

/** One filter option's job count, from `GET /jobs/facets`: `value` as GET /jobs
 *  takes it ("remote", "full_time", "7", "summer-2027"). */
export type FacetCount = { value: string; jobs: number };

/** A `job_roles` role as the Role filter offers it (KAN-155): `value` its
 *  slug, as GET /jobs?role= takes it, and `label` its name. */
export type JobRoleOption = FacetCount & { label: string };

/** Every filter option's count across the whole feed (not narrowed by the
 *  other filters), and the start terms postings name, in calendar order.
 *  `role` is also the Role filter's options: the roles that tag a job, in
 *  the database's order, with their names. `auto_apply` has one option,
 *  "true": the job postings auto apply can fill. */
export type JobFacets = Record<
  "work_style" | "experience" | "job_type" | "posted_within" | "visa" | "start_term" | "auto_apply",
  FacetCount[]
> & { role: JobRoleOption[] };

const NO_FACETS: JobFacets = {
  work_style: [],
  role: [],
  experience: [],
  job_type: [],
  posted_within: [],
  visa: [],
  start_term: [],
  auto_apply: [],
};

/** The filter row's counts and Start Date options. Empty when the API can't be
 *  reached: the counts stay off and Start Date shows disabled, and the feed
 *  below reports the error itself. */
export async function getJobFacets(): Promise<JobFacets> {
  await connection();
  try {
    const res = await apiGet("/jobs/facets", undefined, { revalidate: COUNTS_TTL });
    // Over the empty groups, so an API that doesn't send a group yet (one
    // deployed before Role existed) leaves that facet empty rather than
    // crashing the filters.
    return res.ok ? { ...NO_FACETS, ...((await res.json()) as Partial<JobFacets>) } : NO_FACETS;
  } catch {
    return NO_FACETS;
  }
}

/**
 * How many open jobs were posted in the last `days` days: the Dashboard's
 * New Roles. Cached like the facets above, since the figure only moves when
 * the scheduled import lands. Null when the API can't answer.
 */
export async function countJobsPostedWithin(days: number): Promise<number | null> {
  try {
    const res = await apiGet(`/jobs/count?posted_within=${days}`, undefined, {
      revalidate: COUNTS_TTL,
    });
    if (!res.ok) return null;
    return ((await res.json()) as { jobs: number }).jobs;
  } catch {
    return null;
  }
}

/** One open scraped job with its description, for its own page, from
 *  `GET /jobs/{id}`. `null` when the API says it isn't open (closed, a
 *  company's own, or no such job): the page shows its not-found. */
/** A job posting's id: the row's UUID, all a card ever links to. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getJobListing(
  id: string,
): Promise<{ job: JobListing | null; error: null } | { job: null; error: string }> {
  await connection();
  // Anything else is no job posting. It is not asked for: /jobs/count and the
  // API's other named routes answer 200 with something that isn't one.
  if (!UUID.test(id)) return { job: null, error: null };
  try {
    const res = await apiGet(`/jobs/${encodeURIComponent(id)}`);
    if (res.status === 404) return { job: null, error: null };
    if (!res.ok) return { job: null, error: await extractErrorMessage(res) };
    return { job: (await res.json()) as JobListing, error: null };
  } catch {
    return { job: null, error: "Could not reach the server." };
  }
}

/** Whether the viewer marked this job as applied (`GET /jobs/{id}/applied`),
 *  for the Applied button on its page: `appliedAt` is when, or null when they
 *  haven't. `null` overall when there is no button to show: signed out, a
 *  company account, or the API unreachable. */
export async function getApplied(id: string): Promise<{ appliedAt: string | null } | null> {
  const token = await viewerToken();
  if (!token) return null;
  try {
    const res = await apiGet(`/jobs/${encodeURIComponent(id)}/applied`, token);
    if (!res.ok) return null;
    return { appliedAt: ((await res.json()) as { applied_at: string | null }).applied_at };
  } catch {
    return null;
  }
}
