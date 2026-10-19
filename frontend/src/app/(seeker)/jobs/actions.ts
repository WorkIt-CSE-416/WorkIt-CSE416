"use server";

import { apiGet } from "@/lib/api";
import { apiFetch, extractErrorMessage } from "@/lib/auth";

import type { ApplicationStage } from "../auto-apply/actions";
import { feedQuery, readFilters, readQuery } from "./filter-query";
import { getFeedPage, getRecommendedPage, viewerToken, type FeedPage } from "./listings";

const SIGNED_OUT = "You're signed out. Sign in again to continue.";
const UNREACHABLE = "Could not reach the server.";

/** A query string as the record a page's searchParams would be. */
function paramsOf(query: string): Record<string, string[]> {
  const params: Record<string, string[]> = {};
  for (const [key, value] of new URLSearchParams(query)) (params[key] ??= []).push(value);
  return params;
}

/**
 * How many jobs these filters keep: the All Filters panel's "Show 128 Jobs",
 * counted as the picks change, before anything is applied. Takes the query
 * string the panel would write (./filter-query), with /search's `q` when it
 * is open there, and reads it back the same way a page does, so a value the
 * API would refuse never reaches it. A public endpoint like every server
 * action, over public data. Null when the API can't answer: the button then
 * just says "Show Jobs".
 */
export async function countJobs(query: string): Promise<number | null> {
  const params = paramsOf(query);
  try {
    const res = await apiGet(
      `/jobs/count${feedQuery(readFilters(params), readQuery(params))}`,
      (await viewerToken()) ?? undefined,
    );
    if (!res.ok) return null;
    return ((await res.json()) as { jobs: number }).jobs;
  } catch {
    return null;
  }
}

/** The furthest Load More goes, the API's own cap on `offset`. */
const MAX_OFFSET = 100_000;

/**
 * The page of the feed after the `offset` roles a list already shows, for its
 * Load More (./feed-list). `query` is the one the page was drawn with
 * (feedQuery: its filters and /search's words), read back the same way, so a
 * hand-made call can only ask for what a page could.
 */
export async function loadMoreJobs(query: string, offset: number): Promise<FeedPage> {
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
    return { jobs: null, more: false, error: "That page of jobs doesn't exist." };
  }
  const params = paramsOf(query);
  return getFeedPage(feedQuery(readFilters(params), readQuery(params)), offset);
}

/**
 * Marks a job as applied for the signed-in applicant (`POST
 * /jobs/{id}/applied`), from the Applied button on its page. Answers when,
 * as the API stored it: the first click's date, if it was marked before. The
 * API checks the token and the account type; this only forwards it.
 */
export async function markApplied(
  jobId: string,
): Promise<{ appliedAt: string; error: null } | { appliedAt: null; error: string }> {
  const token = await viewerToken();
  if (!token) return { appliedAt: null, error: SIGNED_OUT };
  try {
    const res = await apiFetch(
      `/jobs/${encodeURIComponent(jobId)}/applied`,
      { method: "POST" },
      token,
    );
    if (!res.ok) return { appliedAt: null, error: await extractErrorMessage(res) };
    return { appliedAt: ((await res.json()) as { applied_at: string }).applied_at, error: null };
  } catch {
    return { appliedAt: null, error: UNREACHABLE };
  }
}

/**
 * A job's Save button (./save-job-button): keeps the job as saved for the
 * signed-in applicant (`POST /jobs/{id}/saved`, KAN-261), so it shows in the
 * Saved column on My Applications. Answers its stage: saved, or the stage it
 * already had (queued, applied...), which saving never moves back.
 */
export async function saveJob(
  jobId: string,
): Promise<{ stage: ApplicationStage; error: null } | { stage: null; error: string }> {
  const token = await viewerToken();
  if (!token) return { stage: null, error: SIGNED_OUT };
  try {
    const res = await apiFetch(
      `/jobs/${encodeURIComponent(jobId)}/saved`,
      { method: "POST" },
      token,
    );
    if (!res.ok) return { stage: null, error: await extractErrorMessage(res) };
    return { stage: ((await res.json()) as { stage: ApplicationStage }).stage, error: null };
  } catch {
    return { stage: null, error: UNREACHABLE };
  }
}

/** Takes a job back out of saved (`DELETE /jobs/{id}/saved`). One already
 *  queued or applied stays, and the API's 409 says why. */
export async function unsaveJob(jobId: string): Promise<{ error: string | null }> {
  const token = await viewerToken();
  if (!token) return { error: SIGNED_OUT };
  try {
    const res = await apiFetch(
      `/jobs/${encodeURIComponent(jobId)}/saved`,
      { method: "DELETE" },
      token,
    );
    return { error: res.ok ? null : await extractErrorMessage(res) };
  } catch {
    return { error: UNREACHABLE };
  }
}

/**
 * The Recommended view's Load More (./feed-list, `source="recommended"`):
 * the next page of the seeker's scored jobs under the same filters. The
 * seeker comes from the session in getRecommendedPage, never an argument. A
 * seeker whose experience bank emptied between pages gets an error, and the
 * page they reload shows the plain feed.
 */
export async function loadMoreRecommended(query: string, offset: number): Promise<FeedPage> {
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
    return { jobs: null, more: false, error: "That page of jobs doesn't exist." };
  }
  const page = await getRecommendedPage(feedQuery(readFilters(paramsOf(query))), offset);
  return (
    page ?? { jobs: null, more: false, error: "Fill your experience bank to see your matches." }
  );
}
